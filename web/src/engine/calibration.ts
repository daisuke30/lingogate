// Word-knowledge model (LINGO-010). The learner triages band1's 1000 words into
// known / unknown; that map then (a) seeds "already-mastered" FSRS review states
// for the sentences that teach a known word, and (b) drives which new sentences
// are eligible to be introduced (only those with few unknown words). Review
// results feed back into the map. All logic here is pure (no IndexedDB, no
// browser) so it is unit-testable; state/calibration.ts wires it to storage.

import { CardState, Rating } from "./fsrs";
import type { FSRS, ReviewState } from "./fsrs";
import type { DeckWord, Sentence } from "./content";

const DAY_MS = 86_400_000;

export type KnowledgeStatus = "known" | "unknown" | "unset";
/** "placement" = LINGO-016 adaptive test (both directly-swiped words and the
 * band-extrapolated assumed known/unknown ones). */
export type KnowledgeSource = "calibration" | "review" | "placement";

/** Persisted per-lemma judgement. `status` "unset" means never judged (rows are
 * normally only written for known/unknown, so absence == unset too). */
export interface WordKnowledge {
  lemma: string;
  status: KnowledgeStatus;
  updatedAt: number;
  source: KnowledgeSource;
}

/** Runtime lookup: lemma -> current status. Absent key == "unset". */
export type KnowledgeMap = Map<string, KnowledgeStatus>;

// --- Tunables (fixed here so tests can pin them) -----------------------------

/** Below this many judged words the new-card order falls back to the plain
 * frequency ordering — a handful of judgements isn't a reliable known-map yet. */
export const CALIBRATION_FALLBACK_THRESHOLD = 100;

/** A sentence is eligible as a *new* card only if its unknown-word score is at
 * most this. Keeps every new card to ~one genuinely new element. */
export const MAX_UNKNOWN_FOR_NEW = 2;

/** An un-judged word counts as a half unknown: probably new, but less certain
 * than an explicitly-unknown one, so it doesn't block a card as hard. */
export const UNSET_WEIGHT = 0.5;

/** A RU content word that never resolved to a band1 deck word (band1 lemma not
 * found, or the sentence's source data simply has a low lemma-link rate — this
 * is common for handwritten lessons/notes, vs. the LINGO-011 core deck where
 * lemmas are exhaustively tagged). Weighted higher than "unset": an unlinked
 * word can't be judged at all, so treat it as *more* likely unknown than a
 * linked-but-unjudged word, not less — otherwise long, low-link-rate sentences
 * slip past the new-card filter with an artificially low score (bug report
 * 2026-08-26: lesson/note sentences appearing as an early new card). */
export const UNLINKED_WEIGHT = 0.75;

/** Seeded stability (days) for a sentence whose target word the learner already
 * knows: long interval, so it only resurfaces as an occasional forgetting check.
 * interval(S)==S at 0.9 retention, so this is ~60 days out. */
export const KNOWN_SEED_STABILITY_DAYS = 60;

/** Neutral-ish difficulty for a seeded known card (== initialDifficulty(Good)). */
function seedDifficulty(fsrs: FSRS): number {
  return fsrs.initialDifficulty(Rating.Good);
}

/** Build a "already mastered" FSRS review state for one sentence: Review state,
 * long stability, due far out. Deterministic given `now`. `stabilityDays`
 * defaults to the fixed 60-day seed (regular calibration/review flow);
 * LINGO-016's placement write-out passes a per-lemma 30–120d dispersed value
 * for its assumed-known words instead (see engine/placement.ts). */
export function seedKnownReviewState(
  sentenceId: string,
  now: number,
  fsrs: FSRS,
  direction = "en2ru",
  stabilityDays: number = KNOWN_SEED_STABILITY_DAYS,
): ReviewState {
  const stability = stabilityDays;
  const ivlDays = fsrs.interval(stability); // == stability at requestRetention 0.9
  return {
    sentenceId,
    direction,
    stability,
    difficulty: seedDifficulty(fsrs),
    due: now + ivlDays * DAY_MS,
    reps: 1,
    lapses: 0,
    lastReview: now,
    state: CardState.Review,
  };
}

/** Seed review states for every target sentence teaching one of `lemmas`,
 * skipping sentences that already have a state (`existingIds`). A lemma not
 * present in `stabilityDaysByLemma` (or when the map is omitted entirely)
 * falls back to the fixed 60-day seed — unchanged default behaviour for the
 * pre-LINGO-016 calibration/review callers. */
export function seedKnownReviewStatesForLemmas(
  sentences: Sentence[],
  lemmas: Iterable<string>,
  now: number,
  existingIds: Set<string>,
  fsrs: FSRS,
  stabilityDaysByLemma?: Map<string, number>,
): ReviewState[] {
  const wanted = new Set(lemmas);
  const out: ReviewState[] = [];
  for (const s of sentences) {
    if (!s.targetLemma || !wanted.has(s.targetLemma)) continue;
    if (existingIds.has(s.id)) continue;
    const stabilityDays = stabilityDaysByLemma?.get(s.targetLemma) ?? KNOWN_SEED_STABILITY_DAYS;
    out.push(seedKnownReviewState(s.id, now, fsrs, "en2ru", stabilityDays));
  }
  return out;
}

// --- New-card scoring --------------------------------------------------------

export interface SentenceScore {
  /** unknown-word count + UNSET_WEIGHT * unset-word count + UNLINKED_WEIGHT *
   * unlinked-word count (RU tokens that never resolved to a wordId). */
  unknownScore: number;
  /** Ordering key within an unknown-score tier: target lemma rank if the target
   * is known, else the lowest rank among the sentence's not-yet-known words. */
  sortRank: number;
}

function rankOf(w: DeckWord): number {
  return w.rank ?? Number.MAX_SAFE_INTEGER;
}

/** Score a sentence against the current knowledge map for new-card selection.
 * `s.wordIds` only contains lemmas that successfully linked to a band1 deck
 * word — a sentence can have real RU words that never linked (band1-external
 * vocab, or a low-link-rate source like handwritten lessons/notes). Those
 * unlinked words are unjudgeable by definition, so they count *against*
 * eligibility via UNLINKED_WEIGHT, computed from `s.tokenCount` (the real RU
 * content-word count) minus the linked count. */
export function scoreSentence(
  s: Sentence,
  knowledge: KnowledgeMap,
  wordById: Map<number, DeckWord>,
): SentenceScore {
  let unknown = 0;
  let unset = 0;
  let minNotKnownRank = Number.POSITIVE_INFINITY;
  let targetRank: number | null = null;
  for (const wid of s.wordIds) {
    const w = wordById.get(wid);
    if (!w) continue;
    if (s.targetLemma && w.lemma === s.targetLemma) targetRank = rankOf(w);
    const st = knowledge.get(w.lemma) ?? "unset";
    if (st === "unknown") {
      unknown += 1;
      if (rankOf(w) < minNotKnownRank) minNotKnownRank = rankOf(w);
    } else if (st === "unset") {
      unset += 1;
      if (rankOf(w) < minNotKnownRank) minNotKnownRank = rankOf(w);
    }
  }
  const linkedCount = s.wordIds.length;
  const unlinked = s.tokenCount != null ? Math.max(0, s.tokenCount - linkedCount) : 0;
  const unknownScore = unknown + UNSET_WEIGHT * unset + UNLINKED_WEIGHT * unlinked;
  let sortRank = targetRank ?? (Number.isFinite(minNotKnownRank) ? minNotKnownRank : null);
  if (sortRank == null) sortRank = s.minRank ?? Number.MAX_SAFE_INTEGER;
  return { unknownScore, sortRank };
}

// --- Review -> knowledge feedback -------------------------------------------

export interface CardOutcome {
  sentence: Sentence;
  /** True if the card was rated Again at any point this session. */
  again: boolean;
}

/** Derive knowledge updates from a finished session: Again -> mark the
 * sentence's target lemma unknown; clean Good pass -> mark it known. Unknown
 * wins collisions (if the same lemma appears as both a clean pass and an
 * Again in one batch — e.g. two different target sentences for the same
 * word — the Again is the more cautious/conservative signal).
 *
 * A sentence with NO target lemma (imported notes/lessons — design: a
 * "sentence" row counts as "notes" exactly when it has no target_lemma, see
 * scripts/build-content.mjs) produces NO update at all, for EITHER rating.
 * This was NOT always true: before the LINGO-055 fix (2026-10-17), an Again
 * on a targetless sentence used to fall back to "demote the lowest-rank
 * NOT-YET-known word in the sentence" — and critically, when EVERY word in
 * the sentence was already known (the fallback's "best" candidate search
 * finds nothing, since it explicitly skips known words), it fell through to
 * demoting the lowest-rank word regardless of status, silently flipping an
 * already-known basic word (rank 1-ish — "я"/"ты"/"здесь"-class) back to
 * unknown. Katsuta's 2026-10-17 report ("覚えた語が280→240に漸減、超基礎文が
 * 再出題される", explicitly NOT a forgetting-check self-correction — he never
 * marked those words unknown) traced to exactly this: every honest Again on
 * a hard IMPORTED note sentence (which never carries a target_lemma) was
 * collateral-demoting whichever basic word in it happened to have the lowest
 * rank, both shrinking the known count and reopening that word's sentences
 * as "new" cards. The fix: a word's status may ONLY be touched by a session
 * outcome on THAT WORD'S OWN target sentence — symmetric with the Good/known
 * branch, which already required this. No fallback, no collateral unset- or
 * known-word demotion. See engine/calibration.test.ts's "LINGO-055" suite for
 * the reproduction + regression coverage. */
export function knowledgeUpdatesFromOutcomes(outcomes: CardOutcome[], now: number): WordKnowledge[] {
  const byLemma = new Map<string, WordKnowledge>();
  for (const { sentence, again } of outcomes) {
    if (!sentence.targetLemma) continue;
    const lemma = sentence.targetLemma;
    const status: KnowledgeStatus = again ? "unknown" : "known";
    const prev = byLemma.get(lemma);
    if (prev && prev.status === "unknown") continue; // unknown takes precedence
    byLemma.set(lemma, { lemma, status, updatedAt: now, source: "review" });
  }
  return [...byLemma.values()];
}

/** Count of words the learner has explicitly judged (known or unknown). */
export function judgedCount(knowledge: KnowledgeMap): number {
  let n = 0;
  for (const st of knowledge.values()) if (st !== "unset") n += 1;
  return n;
}

// --- LINGO-055 repair: collateral known→unknown demotions from the removed
// "no target lemma -> demote the lowest-rank word" fallback -----------------

/** 直近1ヶ月 — only recently-touched rows are repair candidates (the
 * coordinator's scoping: older corruption is harder to attribute confidently
 * either way, and the bug was presumably always present, so "recent" isn't
 * about when the bug shipped — it's about keeping the repair conservative). */
export const REPAIR_RECENCY_MS = 30 * DAY_MS;
/** "rank上位" — basic/common vocabulary. The fallback bug could only ever
 * demote the LOWEST-rank word in whatever sentence was rated Again, which is
 * — almost by construction — a common/basic word, not an obscure one. */
export const REPAIR_RANK_THRESHOLD = 1000;

/** Find wordKnowledge rows that are LIKELY collateral damage from the
 * pre-LINGO-055 fallback (see knowledgeUpdatesFromOutcomes's doc comment)
 * rather than a genuine Again on the word's own target sentence. A lemma is
 * flagged when ALL of:
 *  - its row has status "unknown" and source "review" (the only path the
 *    fallback could have taken — calibration/placement judgements, and
 *    anything already "known", are untouched);
 *  - that row was updated within REPAIR_RECENCY_MS (直近1ヶ月);
 *  - the word is "rank上位" (rank <= REPAIR_RANK_THRESHOLD);
 *  - NO ReviewState for any of the word's OWN target sentences shows
 *    lapses > 0 — i.e. there is no confirmable record of the learner ever
 *    actually failing THIS word's own target card. (GateSession rows carry
 *    only session-level aggregates — total questions/correct, no per-card or
 *    per-lemma detail — so they cannot help confirm or rule out any specific
 *    lemma; ReviewState.lapses, incremented on every Again, is the FSRS
 *    engine's only per-sentence signal, and via targetLemma the only
 *    per-lemma one.)
 * Returns ONLY the lemma to flag — downgrading it is the caller's job
 * (state/service.ts), and only ever to "unset", never back to "known": this
 * function has no basis to conclude the word IS known, only that the
 * "unknown" we currently have on file is unconfirmed. "unset" just means
 * "re-judge me next time" (placement or a future review) — the safe default. */
export function findCollateralDemotions(
  knowledgeRows: WordKnowledge[],
  reviewStates: ReviewState[],
  sentences: Sentence[],
  wordByLemma: Map<string, DeckWord>,
  now: number,
): string[] {
  const targetLemmaBySentenceId = new Map<string, string>();
  for (const s of sentences) {
    if (s.targetLemma) targetLemmaBySentenceId.set(s.id, s.targetLemma);
  }

  const confirmedLemmas = new Set<string>();
  for (const rs of reviewStates) {
    if (rs.lapses <= 0) continue;
    const lemma = targetLemmaBySentenceId.get(rs.sentenceId);
    if (lemma) confirmedLemmas.add(lemma);
  }

  const out: string[] = [];
  for (const row of knowledgeRows) {
    if (row.status !== "unknown" || row.source !== "review") continue;
    if (now - row.updatedAt > REPAIR_RECENCY_MS) continue;
    const rank = wordByLemma.get(row.lemma)?.rank;
    if (rank == null || rank > REPAIR_RANK_THRESHOLD) continue;
    if (confirmedLemmas.has(row.lemma)) continue; // a real Again IS on file — leave it
    out.push(row.lemma);
  }
  return out;
}
