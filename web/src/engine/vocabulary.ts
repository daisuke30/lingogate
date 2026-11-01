// LINGO-067 — the vocabulary list: every word in the course, in frequency
// order, with what the app currently believes about each one.
//
// It started as "can I see which words the level check just added?", but a
// one-off list would answer that question once and then rot. This is the
// standing answer: the learner can always see the whole 3000-word frame, what
// state each word is in, and what changed recently.
//
// Pure: no React, no IndexedDB. The screen is a renderer over these rows, and
// the status rules — the part that must agree with the numbers shown
// elsewhere — are unit-testable on their own.

import type { KnowledgeMap } from "./calibration";
import type { ReviewState } from "./fsrs";
import { CardState } from "./fsrs";

/**
 * What the app believes about one word. Disjoint by construction — every
 * word lands in exactly one.
 *
 * "Mastered" is NOT recomputed here. It is read from the set mastery.ts
 * already derives (masteredLemmaSet), because that function has three branches
 * — declared known, the lemma's own target sentence matured, AND enough
 * incidental exposure in other durably-retained sentences — and a second
 * definition that only knew about the first two would quietly disagree with
 * the number on the home screen one tap away. So:
 *
 *   declared + mastered === masteryStats.masteredCount
 *
 * (`declared` is mastery's `declaredCount`, `mastered` its `learnedCount`),
 * and vocabulary.test.ts asserts it against the real masteryStats.
 */
export type VocabStatus =
  /** Judged known by the learner — a level-check declaration. */
  | "declared"
  /** Earned through study: the target sentence's review stability matured. */
  | "mastered"
  /** In the review queue, not yet matured. */
  | "learning"
  /** Judged NOT known. */
  | "unknown"
  /** No verdict and no study history — what a level check can still decide. */
  | "unjudged";

export interface VocabWordInput {
  lemma: string;
  rank: number;
  band: number;
  pos: string;
  enGloss?: string | null;
  jaGloss?: string | null;
  ruGloss?: string | null;
}

export interface VocabRow {
  lemma: string;
  rank: number;
  band: number;
  pos: string;
  /** Pre-resolved for the current front/UI language pair. */
  gloss: string;
  status: VocabStatus;
  /**
   * When this word was last touched, or null if never.
   *
   * Exact for judgements (`wordKnowledge.updatedAt` is written by the level
   * check and by review feedback). For study it is the last review, which is
   * "touched" rather than strictly "changed state" — the app stores no
   * transition log, so a card that was reviewed without crossing the maturity
   * threshold also appears here. That is the honest limit of what the data
   * can support, and it still answers the question that prompted this screen:
   * a level check stamps every word it decides, so "changed in the last 7
   * days" shows exactly what the check added.
   */
  changedAt: number | null;
}

export interface BuildVocabInput {
  words: VocabWordInput[];
  knowledge: KnowledgeMap;
  /** lemma -> the best review state among that lemma's target sentences. */
  reviewByLemma: Map<string, ReviewState>;
  /** lemma -> wordKnowledge.updatedAt. */
  judgedAtByLemma: Map<string, number>;
  /** mastery.ts's masteredLemmaSet — the single definition of "覚えた". */
  masteredLemmas: Set<string>;
  /** Resolves the gloss for the learner's language preference. */
  gloss: (w: VocabWordInput) => string;
}

export function vocabStatus(
  lemma: string,
  knowledge: KnowledgeMap,
  masteredLemmas: Set<string>,
  review: ReviewState | undefined,
): VocabStatus {
  const judged = knowledge.get(lemma);
  // A declaration wins over everything else, including a card of the same
  // lemma sitting in the queue — otherwise a word the learner said they knew
  // would demote itself to 学習中 the first time it came up, and the two
  // halves of the home screen's breakdown would stop summing.
  if (judged === "known") return "declared";
  if (masteredLemmas.has(lemma)) return "mastered";
  if (review && review.state !== CardState.New) return "learning";
  if (judged === "unknown") return "unknown";
  return "unjudged";
}

/** Build the whole list, in frequency order. */
export function buildVocabList(input: BuildVocabInput): VocabRow[] {
  const rows: VocabRow[] = [];
  for (const w of input.words) {
    const review = input.reviewByLemma.get(w.lemma);
    const judgedAt = input.judgedAtByLemma.get(w.lemma) ?? null;
    const reviewedAt = review?.lastReview ?? null;
    rows.push({
      lemma: w.lemma,
      rank: w.rank,
      band: w.band,
      pos: w.pos,
      gloss: input.gloss(w),
      status: vocabStatus(w.lemma, input.knowledge, input.masteredLemmas, review),
      changedAt:
        judgedAt == null && reviewedAt == null ? null : Math.max(judgedAt ?? 0, reviewedAt ?? 0),
    });
  }
  rows.sort((a, b) => a.rank - b.rank || (a.lemma < b.lemma ? -1 : 1));
  return rows;
}

/** Seven days, the window the "recently changed" filter uses. */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface VocabFilter {
  status?: VocabStatus | "all";
  band?: number | "all";
  /** Matches lemma or gloss, case-insensitive. */
  query?: string;
  recentOnly?: boolean;
  now?: number;
}

export function filterVocab(rows: VocabRow[], f: VocabFilter): VocabRow[] {
  const now = f.now ?? Date.now();
  const q = (f.query ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.status && f.status !== "all" && r.status !== f.status) return false;
    if (f.band && f.band !== "all" && r.band !== f.band) return false;
    if (f.recentOnly && (r.changedAt == null || now - r.changedAt > RECENT_WINDOW_MS)) return false;
    if (q && !r.lemma.toLowerCase().includes(q) && !r.gloss.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Per-status totals for the filter chips. */
export function countByStatus(rows: VocabRow[]): Record<VocabStatus, number> {
  const out: Record<VocabStatus, number> = {
    declared: 0,
    mastered: 0,
    learning: 0,
    unknown: 0,
    unjudged: 0,
  };
  for (const r of rows) out[r.status]++;
  return out;
}
