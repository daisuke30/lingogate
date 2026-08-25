// Gate session assembly + runtime, ported from the Swift GateSessionBuilder /
// GateSessionRunner. This is the flashcard (self-rating) path only — the web
// build ships flashcard mode; 4-choice "strict" mode is out of scope here (see
// task LINGO-008). So there is no QuestionBuilder / distractor logic; a card is
// just its Sentence + ReviewState.
//
// Grading rule (identical to Swift): a card is graded through FSRS exactly once,
// on first resolution. `.again` re-queues it to the end for another look;
// anything else finalises it. A re-shown (already-graded) card is never
// re-graded — only Again-or-not decides whether it goes around again. Grades are
// buffered in memory and committed once at session end (makes undo a pure
// in-memory revert, no compensating write).

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
  pendingAppended: boolean;
}

export class GateSessionRunner {
  private queue: RuntimeCard[];
  /** Every card, in a list that persists regardless of queue mutations — grading
   * mutates the same object references, so this reflects final per-card outcome. */
  private allCards: RuntimeCard[];
  readonly totalCards: number;
  private fsrs: FSRS;

  firstTryCorrect = 0;
  totalAnswers = 0;

  private pendingRatingUpserts: ReviewState[] = [];
  private lastRatingUndo: RatingUndoRecord | null = null;

  constructor(plan: GateSessionPlan, fsrs: FSRS) {
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
    let pendingAppended = false;

    this.totalAnswers += 1;
    const isAgain = rating === Rating.Again;

    if (!card.graded) {
      const graded = this.fsrs.review(card.reviewState, rating, now);
      card.reviewState = graded;
      this.pendingRatingUpserts.push(graded);
      pendingAppended = true;
      card.graded = true;
      if (isAgain) {
        card.everWrong = true;
        this.requeue(card);
      } else {
        this.firstTryCorrect += 1;
        this.queue.shift();
      }
    } else {
      if (isAgain) this.requeue(card);
      else this.queue.shift();
    }

    this.lastRatingUndo = {
      queueSnapshot: priorQueue,
      card,
      priorGraded,
      priorEverWrong,
      priorReviewState,
      priorFirstTryCorrect,
      priorTotalAnswers,
      pendingAppended,
    };

    return { rating, requeued: isAgain, sessionComplete: this.queue.length === 0 };
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
