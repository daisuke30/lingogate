// Gate session assembly + runtime, ported from the Swift GateSessionBuilder /
// GateSessionRunner. This is the flashcard (self-rating) path only — the web
// build ships flashcard mode; 4-choice "strict" mode is out of scope here (see
// task LINGO-008). So there is no QuestionBuilder / distractor logic; a card is
// just its Sentence + ReviewState.
//
// Grading rule: a card is graded through FSRS exactly once, on first
// resolution — never re-graded on a re-show, only Again-or-not decides
// whether it goes around again. Grades are buffered in memory and committed
// once at session end (makes undo a pure in-memory revert, no compensating
// write).
//
// Two requeue modes (LINGO-010 follow-up, 2026-08-26 — Katsuta feedback: "10
// correct required before the next card" made continuous practice feel stuck):
//   - Gate (`requeueAgain: true`, default): identical to the original Swift
//     behaviour and to /gate's "toll" design — an Again re-queues the card to
//     the end of *this* batch, so the batch only completes once every card has
//     a non-Again grade. This is the point of the gate: it's a forcing
//     function, not a quiz.
//   - Continuous practice (`requeueAgain: false`): every card — Again
//     included — resolves and advances after exactly one grade. The batch
//     completes once `size` cards have been graded, full stop. An Again'd
//     card comes back via FSRS's own due-date scheduling instead (see
//     fsrs.ts's AGAIN_STEP_MS): it lands ~5 minutes out, so it naturally
//     surfaces again at the front of the *next* batch's dueReviews queue —
//     Anki-style short relearning steps, not an in-session hostage situation.

import { FSRS, Rating, newReviewState } from "./fsrs";
import type { ReviewState } from "./fsrs";
import type { ContentStore, Sentence } from "./content";
import type { CardOutcome } from "./calibration";
import { SeededRNG } from "./rng";

export interface PlannedCard {
  sentence: Sentence;
  reviewState: ReviewState;
  isReview: boolean;
}

export interface GateSessionPlan {
  cards: PlannedCard[];
  band: number;
  direction: string;
}

/** Assemble a gate session: 1) due reviews (most overdue first), 2) new-card
 * fill (frequency priority), 3) top up with soonest upcoming reviews. The RNG
 * lightly shuffles within the new-card fill so equal-priority cards vary between
 * seeds while a fixed seed stays reproducible. */
export function buildGateSession(
  store: ContentStore,
  opts: { band: number; now: number; size?: number; direction?: string; rng: SeededRNG },
): GateSessionPlan {
  const size = opts.size ?? 10;
  const direction = opts.direction ?? "en2ru";
  const cards: PlannedCard[] = [];
  const used = new Set<string>();

  const push = (sentence: Sentence, reviewState: ReviewState, isReview: boolean) => {
    cards.push({ sentence, reviewState, isReview });
    used.add(sentence.id);
  };

  // 1. Due reviews.
  for (const { state, sentence } of store.dueReviews(opts.band, opts.now, size)) {
    if (cards.length >= size) break;
    push(sentence, state, true);
  }

  // 2. New-card fill (frequency priority). Pull a slightly larger pool so the
  //    RNG can vary the tail among equal-rank sentences, then take what's needed.
  if (cards.length < size) {
    const need = size - cards.length;
    const pool = store.newSentences(opts.band, used, need * 3);
    // Keep the frequency ordering stable for the head, shuffle only the pool tail
    // beyond `need` to introduce seedable variety without breaking priority.
    if (pool.length > need) {
      const head = pool.slice(0, need);
      const tail = pool.slice(need);
      opts.rng.shuffle(tail);
      const merged = head.concat(tail);
      // Re-mix head+first-of-tail lightly so repeated sessions aren't identical.
      opts.rng.shuffle(merged);
      merged.sort((a, b) => (a.minRank ?? 1e9) - (b.minRank ?? 1e9));
      for (const s of merged) {
        if (cards.length >= size) break;
        if (used.has(s.id)) continue;
        push(s, newReviewState(s.id, direction), false);
      }
    } else {
      for (const s of pool) {
        if (cards.length >= size) break;
        push(s, newReviewState(s.id, direction), false);
      }
    }
  }

  // 3. Top up with upcoming (not-yet-due) reviews if the deck is small.
  if (cards.length < size) {
    for (const { state, sentence } of store.upcomingReviews(opts.band, used, size - cards.length)) {
      if (cards.length >= size) break;
      push(sentence, state, true);
    }
  }

  return { cards, band: opts.band, direction };
}

// MARK: - Runner

export interface RatingSubmitResult {
  rating: Rating;
  requeued: boolean;
  sessionComplete: boolean;
}

interface RuntimeCard {
  sentenceId: string;
  sentence: Sentence;
  reviewState: ReviewState;
  graded: boolean;
  everWrong: boolean;
}

interface RatingUndoRecord {
  queueSnapshot: RuntimeCard[];
  card: RuntimeCard;
  priorGraded: boolean;
  priorEverWrong: boolean;
  priorReviewState: ReviewState;
  priorFirstTryCorrect: number;
  priorTotalAnswers: number;
  priorRatingCounts: RatingCounts;
  pendingAppended: boolean;
}

/** Count of cards by their *first* grading rating — the basis for the
 * "覚えていた/曖昧/覚えていない" summary breakdown (LINGO-010 follow-up). A
 * card that's Again'd then later re-shown and passed (gate mode) still counts
 * once under Again here — this reflects what actually happened on first look,
 * not just the eventual outcome. */
export type RatingCounts = Record<Rating, number>;

function zeroRatingCounts(): RatingCounts {
  return { [Rating.Again]: 0, [Rating.Hard]: 0, [Rating.Good]: 0, [Rating.Easy]: 0 };
}

export interface RatingSummary {
  again: number;
  hard: number;
  /** Good + Easy folded together — the flashcard UI only ever sends Again/Hard/Good. */
  good: number;
  total: number;
}

export class GateSessionRunner {
  private queue: RuntimeCard[];
  /** Every card, in a list that persists regardless of queue mutations — grading
   * mutates the same object references, so this reflects final per-card outcome. */
  private allCards: RuntimeCard[];
  readonly totalCards: number;
  private fsrs: FSRS;
  /** true (default) = gate's requeue-until-clear toll; false = continuous
   * practice, where every card resolves after exactly one grade. */
  private requeueAgain: boolean;

  firstTryCorrect = 0;
  totalAnswers = 0;
  private ratingCounts: RatingCounts = zeroRatingCounts();

  private pendingRatingUpserts: ReviewState[] = [];
  private lastRatingUndo: RatingUndoRecord | null = null;

  constructor(plan: GateSessionPlan, fsrs: FSRS, opts: { requeueAgain?: boolean } = {}) {
    this.queue = plan.cards.map((c) => ({
      sentenceId: c.sentence.id,
      sentence: c.sentence,
      reviewState: c.reviewState,
      graded: false,
      everWrong: false,
    }));
    this.allCards = this.queue.slice();
    this.totalCards = plan.cards.length;
    this.fsrs = fsrs;
    this.requeueAgain = opts.requeueAgain ?? true;
  }

  /** "10枚中 覚えていた n / 曖昧 m / 覚えていない k" — first-grading tally. */
  get ratingSummary(): RatingSummary {
    return {
      again: this.ratingCounts[Rating.Again],
      hard: this.ratingCounts[Rating.Hard],
      good: this.ratingCounts[Rating.Good] + this.ratingCounts[Rating.Easy],
      total: this.totalCards,
    };
  }

  /** Per-card outcomes for knowledge feedback: every graded card with whether it
   * was ever rated Again this session (used to update the word-knowledge map). */
  knowledgeOutcomes(): CardOutcome[] {
    return this.allCards
      .filter((c) => c.graded)
      .map((c) => ({ sentence: c.sentence, again: c.everWrong }));
  }

  /** The sentence currently facing the learner, or null when done. */
  get currentSentence(): Sentence | null {
    return this.queue[0]?.sentence ?? null;
  }

  /** Stable id of the head card — used as the React key for flip/timer state. */
  get currentCardID(): string | null {
    return this.queue[0]?.sentenceId ?? null;
  }

  get isComplete(): boolean {
    return this.queue.length === 0;
  }

  /** Distinct cards already finally resolved. */
  get resolvedCount(): number {
    const remaining = new Set(this.queue.map((c) => c.sentenceId)).size;
    return this.totalCards - remaining;
  }

  get canUndo(): boolean {
    return this.lastRatingUndo != null;
  }

  get pendingRatingUpsertCount(): number {
    return this.pendingRatingUpserts.length;
  }

  /** Submit a self-assessed FSRS rating for the current (head) card. */
  submitRating(rating: Rating, now: number): RatingSubmitResult {
    const card = this.queue[0];
    if (!card) return { rating, requeued: false, sessionComplete: true };

    const priorQueue = this.queue.slice();
    const priorGraded = card.graded;
    const priorEverWrong = card.everWrong;
    const priorReviewState = card.reviewState;
    const priorFirstTryCorrect = this.firstTryCorrect;
    const priorTotalAnswers = this.totalAnswers;
    const priorRatingCounts = { ...this.ratingCounts };
    let pendingAppended = false;

    this.totalAnswers += 1;
    const isAgain = rating === Rating.Again;
    let requeued = false;

    if (!card.graded) {
      const graded = this.fsrs.review(card.reviewState, rating, now);
      card.reviewState = graded;
      this.pendingRatingUpserts.push(graded);
      pendingAppended = true;
      card.graded = true;
      this.ratingCounts[rating] += 1; // first-grading tally, regardless of mode
      if (isAgain) {
        card.everWrong = true;
        if (this.requeueAgain) {
          this.requeue(card);
          requeued = true;
        } else {
          // Continuous mode: resolve now — FSRS's own ~5min due (AGAIN_STEP_MS)
          // is what brings this card back, at the front of a *future* batch's
          // dueReviews, not immediately in this one.
          this.queue.shift();
        }
      } else {
        this.firstTryCorrect += 1;
        this.queue.shift();
      }
    } else {
      // Only reachable when requeueAgain is true — continuous mode never
      // re-shows a card, so it never re-grades or re-queues one either.
      if (isAgain) {
        this.requeue(card);
        requeued = true;
      } else {
        this.queue.shift();
      }
    }

    this.lastRatingUndo = {
      queueSnapshot: priorQueue,
      card,
      priorGraded,
      priorEverWrong,
      priorReviewState,
      priorFirstTryCorrect,
      priorTotalAnswers,
      priorRatingCounts,
      pendingAppended,
    };

    return { rating, requeued, sessionComplete: this.queue.length === 0 };
  }

  private requeue(card: RuntimeCard): void {
    this.queue.shift();
    this.queue.push(card);
  }

  /** Revert the immediately preceding submitRating call (one level deep). */
  undoLastRating(): boolean {
    const u = this.lastRatingUndo;
    if (!u) return false;
    this.queue = u.queueSnapshot;
    u.card.graded = u.priorGraded;
    u.card.everWrong = u.priorEverWrong;
    u.card.reviewState = u.priorReviewState;
    this.firstTryCorrect = u.priorFirstTryCorrect;
    this.totalAnswers = u.priorTotalAnswers;
    this.ratingCounts = u.priorRatingCounts;
    if (u.pendingAppended && this.pendingRatingUpserts.length > 0) {
      this.pendingRatingUpserts.pop();
    }
    this.lastRatingUndo = null;
    return true;
  }

  /** The buffered grades to commit at session end (UI writes them to IndexedDB). */
  drainPendingUpserts(): ReviewState[] {
    const out = this.pendingRatingUpserts;
    this.pendingRatingUpserts = [];
    this.lastRatingUndo = null;
    return out;
  }
}
