// "会話頻出3000語マスター" metric (LINGO-013). Pure aggregation over the deck +
// the learner's word-knowledge map and FSRS review states, plus the frequency→
// conversation-coverage interpolation. No IndexedDB / browser access here so it
// is unit-testable; ContentStore.masteryStats wires it to the runtime store.
//
// Design ref: ai-org/Ideas/20260827-lingogate-multilang-design.md §3.
//   - mastered word = a lemma the learner "knows": either judged `known`
//     (calibration / assumed-known incl. review-promoted) OR the target lemma of
//     a sentence whose FSRS stability has reached the mastery threshold (learned
//     durably enough to resurface only rarely).
//   - estimated conversation coverage = piecewise-linear interpolation of the
//     research coverage curve (1000→85%, 2000→90%, 3000→95%) at the mastered
//     word count.

import type { ReviewState } from "./fsrs";
import type { KnowledgeMap } from "./calibration";
import type { Sentence } from "./content";

/** FSRS stability (days) at/above which a studied target word is counted as
 * mastered. §3: "対象文のFSRS安定度が閾値≧21日でマスター認定". */
export const MASTERY_STABILITY_DAYS = 21;

/** The frame is a fixed 3000-word target regardless of how many words the deck
 * currently ships (band2/3 generation can yield slightly fewer than 1000 each). */
export const MASTERY_TARGET_WORDS = 3000;

/**
 * LINGO-046: the home screen's headline word count, rounded DOWN to a round
 * ten — 275 becomes 270, shown as "約270語".
 *
 * Katsuta's point: a precise 275 invites the reader to ask what the 5 means,
 * and the honest answer is "not much" — the figure blends a self-declared
 * level check with FSRS stability crossing a threshold, and it moves whenever
 * a card matures. A number that precise implies a measurement it isn't.
 * Rounding down also keeps the claim conservative: never say the learner knows
 * more than they do.
 *
 * Below ten there is nothing to round — "約0語" would be absurd for someone
 * with 7 words — so small counts are returned exactly, and the caller drops
 * the "約". `isApproximate` tells it which case it is.
 */
export const APPROX_WORDS_FLOOR = 10;

export function approximateWordCount(n: number): { value: number; isApproximate: boolean } {
  const safe = Math.max(0, Math.floor(n));
  if (safe < APPROX_WORDS_FLOOR) return { value: safe, isApproximate: false };
  return { value: Math.floor(safe / 10) * 10, isApproximate: true };
}

/** Research coverage curve control points (mastered-word count → % of everyday
 * conversation understood). Interpolated linearly between points; clamped to the
 * last point above 3000 (scope is capped at 3000, §3). */
const COVERAGE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1000, 85],
  [2000, 90],
  [3000, 95],
];

/** Estimated conversation coverage (%) for a mastered-word count, 1 decimal.
 * Piecewise-linear over COVERAGE_POINTS; flat at 95 above 3000. */
export function estimatedCoveragePct(masteredCount: number): number {
  const n = Math.max(0, masteredCount);
  const last = COVERAGE_POINTS[COVERAGE_POINTS.length - 1];
  let pct: number;
  if (n >= last[0]) {
    pct = last[1];
  } else {
    pct = 0;
    for (let i = 1; i < COVERAGE_POINTS.length; i++) {
      const [x0, y0] = COVERAGE_POINTS[i - 1];
      const [x1, y1] = COVERAGE_POINTS[i];
      if (n <= x1) {
        pct = y0 + ((y1 - y0) * (n - x0)) / (x1 - x0);
        break;
      }
    }
  }
  return Math.round(pct * 10) / 10;
}

/** Level ladder (§3): 完全初心者 / 500 / 1000 / 1500 / 2000 / 2500 / 3000, by the
 * highest threshold the mastered-word count has reached. */
const LEVEL_THRESHOLDS = [3000, 2500, 2000, 1500, 1000, 500] as const;

export function masteryLevelLabel(masteredCount: number): string {
  for (const t of LEVEL_THRESHOLDS) {
    if (masteredCount >= t) return `${t}マスター`;
  }
  return "完全初心者";
}

/** Language-neutral form of the level for the UI to localise (LINGO-014): the
 * highest reached threshold, or null for the "absolute beginner" band. */
export function masteryLevelThreshold(masteredCount: number): number | null {
  for (const t of LEVEL_THRESHOLDS) {
    if (masteredCount >= t) return t;
  }
  return null;
}

/** The set of deck lemmas the learner has mastered:
 *  (a) judged `known` (calibration/assumed, incl. review-promoted), plus
 *  (b) the target lemma of any sentence whose review state has stability ≥ the
 *      mastery threshold.
 * Restricted to `deckLemmas` so the count stays within the 3000-word universe
 * (a stray knowledge/state row for a non-deck lemma never inflates it). */
export function masteredLemmaSet(
  sentences: Sentence[],
  knowledge: KnowledgeMap,
  states: Iterable<ReviewState>,
  deckLemmas: Set<string>,
  stabilityThresholdDays: number = MASTERY_STABILITY_DAYS,
): Set<string> {
  const out = new Set<string>();

  for (const [lemma, status] of knowledge) {
    if (status === "known" && deckLemmas.has(lemma)) out.add(lemma);
  }

  const targetById = new Map<string, string>();
  for (const s of sentences) {
    if (s.targetLemma) targetById.set(s.id, s.targetLemma);
  }
  for (const st of states) {
    if (st.stability == null || st.stability < stabilityThresholdDays) continue;
    const lemma = targetById.get(st.sentenceId);
    if (lemma && deckLemmas.has(lemma)) out.add(lemma);
  }

  return out;
}

export interface MasteryStats {
  /** Distinct mastered deck lemmas. */
  masteredCount: number;
  /** LINGO-040 (QA-7): of `masteredCount`, how many come from the learner's
   * own level-check declaration (judged/assumed `known`) rather than from
   * study. The two are shown separately in the details sheet — a single
   * blended number let a 1–3 minute level check read as "800 words mastered",
   * which the learner knows is not true and which cost the whole screen its
   * credibility. `declaredCount + learnedCount === masteredCount`. */
  declaredCount: number;
  /** Of `masteredCount`, lemmas earned purely through study (review stability
   * reached the threshold) and NOT already declared known. */
  learnedCount: number;
  /** The 3000-word frame target (scope figure — no longer a bar denominator). */
  targetWords: number;
  /** Estimated conversation coverage %, 1 decimal. */
  coveragePct: number;
  /** Level label (完全初心者 … 3000マスター). Kept for back-compat; UI should
   * prefer `levelThreshold` + i18n. */
  level: string;
  /** Language-neutral level: highest reached threshold, or null for beginner. */
  levelThreshold: number | null;
}

/** Compute the full home-screen mastery card figures from raw store data. */
export function masteryStats(
  sentences: Sentence[],
  knowledge: KnowledgeMap,
  states: Iterable<ReviewState>,
  deckLemmas: Set<string>,
  stabilityThresholdDays: number = MASTERY_STABILITY_DAYS,
): MasteryStats {
  const mastered = masteredLemmaSet(
    sentences,
    knowledge,
    states,
    deckLemmas,
    stabilityThresholdDays,
  );
  const masteredCount = mastered.size;
  // LINGO-040: split the same set into "the learner told us" vs "the app saw
  // it stick". Declared is the (a) branch of masteredLemmaSet; learned is
  // whatever the (b) branch contributed on top, so the two always sum to
  // masteredCount and neither can double-count a lemma earned both ways.
  let declaredCount = 0;
  for (const lemma of mastered) {
    if (knowledge.get(lemma) === "known") declaredCount++;
  }
  return {
    masteredCount,
    declaredCount,
    learnedCount: masteredCount - declaredCount,
    targetWords: MASTERY_TARGET_WORDS,
    coveragePct: estimatedCoveragePct(masteredCount),
    level: masteryLevelLabel(masteredCount),
    levelThreshold: masteryLevelThreshold(masteredCount),
  };
}
