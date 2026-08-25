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
export type KnowledgeSource = "calibration" | "review";

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
 * long stability, due far out. Deterministic given `now`. */
export function seedKnownReviewState(
  sentenceId: string,
  now: number,
  fsrs: FSRS,
  direction = "en2ru",
): ReviewState {
  const stability = KNOWN_SEED_STABILITY_DAYS;
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
 * skipping sentences that already have a state (`existingIds`). */
export function seedKnownReviewStatesForLemmas(
  sentences: Sentence[],
  lemmas: Iterable<string>,
  now: number,
  existingIds: Set<string>,
  fsrs: FSRS,
): ReviewState[] {
  const wanted = new Set(lemmas);
  const out: ReviewState[] = [];
  for (const s of sentences) {
    if (!s.targetLemma || !wanted.has(s.targetLemma)) continue;
    if (existingIds.has(s.id)) continue;
    out.push(seedKnownReviewState(s.id, now, fsrs));
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

function lowestNotKnownLemma(
  s: Sentence,
  wordById: Map<number, DeckWord>,
  knowledge: KnowledgeMap,
): string | null {
  let best: DeckWord | null = null;
  let fallback: DeckWord | null = null;
  for (const wid of s.wordIds) {
    const w = wordById.get(wid);
    if (!w) continue;
    if (fallback == null || rankOf(w) < rankOf(fallback)) fallback = w;
    const st = knowledge.get(w.lemma) ?? "unset";
    if (st !== "known" && (best == null || rankOf(w) < rankOf(best))) best = w;
  }
  return (best ?? fallback)?.lemma ?? null;
}

export interface CardOutcome {
  sentence: Sentence;
  /** True if the card was rated Again at any point this session. */
  again: boolean;
}

/** Derive knowledge updates from a finished session. Again -> mark the sentence's
 * target lemma (or, lacking one, its lowest-rank not-known word) unknown;
 * clean Good pass -> mark the target lemma known. Unknown wins collisions. */
export function knowledgeUpdatesFromOutcomes(
  outcomes: CardOutcome[],
  wordById: Map<number, DeckWord>,
  knowledge: KnowledgeMap,
  now: number,
): WordKnowledge[] {
  const byLemma = new Map<string, WordKnowledge>();
  for (const { sentence, again } of outcomes) {
    let lemma: string | null;
    let status: KnowledgeStatus;
    if (again) {
      status = "unknown";
      lemma = sentence.targetLemma ?? lowestNotKnownLemma(sentence, wordById, knowledge);
    } else {
      if (!sentence.targetLemma) continue;
      lemma = sentence.targetLemma;
      status = "known";
    }
    if (!lemma) continue;
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
