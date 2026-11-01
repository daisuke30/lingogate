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
import type { DeckWord, Sentence } from "./content";

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
/** LINGO-065: minimum number of DISTINCT durably-retained (stability >=
 * threshold) sentences containing a word that must be found before the
 * "incidental exposure" path (see masteredLemmaSet below) credits it as
 * mastered. One durable sentence containing the word isn't enough evidence on
 * its own — a learner can reliably recall a whole sentence from its OTHER,
 * more salient word and barely register a secondary one riding along in the
 * same sentence (a short function word especially). Two independent
 * durably-retained sentences containing the same word is a materially
 * stronger, still-conservative signal: it's no longer one sentence's specific
 * phrasing being memorized, it's the word itself recurring and holding up
 * across different contexts. This is deliberately NOT applied to a sentence's
 * OWN designated target lemma (that path, below, still only needs ONE pass —
 * unchanged) — it only widens how a word can ALSO be credited when it is
 * merely a covered (non-target) word of sentences actually being studied. */
export const MASTERY_MIN_INCIDENTAL_EXPOSURES = 2;

/**
 * The set of deck lemmas the learner has mastered:
 *  (a) judged `known` (calibration/assumed, incl. review-promoted), plus
 *  (b) the target lemma of any sentence whose review state has stability >=
 *      the mastery threshold, plus
 *  (c) LINGO-065 — any OTHER word a durably-retained sentence happens to
 *      cover (via `wordIds`, not `targetLemma`), provided at least
 *      `MASTERY_MIN_INCIDENTAL_EXPOSURES` distinct such sentences corroborate
 *      it (see that constant's doc comment for why one sentence isn't enough
 *      but two independently is).
 *
 * Why (c) exists: mastery.ts's original design assumed every lemma's
 * designated target sentence would, eventually, actually get studied. In
 * practice (LINGO-065, 2026-11-01) buildGateSession's due-review backlog can
 * structurally crowd out new-card introduction for months at a time (see
 * session.ts's "LINGO-065" doc comment + engine/session.test.ts's simulation
 * suite) — so a word whose own target sentence never got a turn could sit at
 * "unset" forever even after the learner has plainly internalized it through
 * dozens of OTHER sentences that happen to contain it. (c) recovers exactly
 * that case, without weakening (a)/(b) at all: it is a pure UNION addition —
 * every lemma (a)/(b) already counted is still counted (those branches are
 * untouched), so this can only ever ADD lemmas to the mastered set, never
 * remove one. That additive-only property is deliberate (Katsuta, LINGO-065
 * follow-up instruction): existing known/mastered data must never be
 * destructively rewritten or have words fall OUT of mastery under a
 * definition change — recomputing this pure function against the learner's
 * existing wordKnowledge + ReviewState rows is automatically a safe,
 * non-destructive "retroactive" application on next load — no migration, no
 * write, nothing to repair, since the set is derived fresh every time rather
 * than stored.
 *
 * `wordById` is optional (defaults to skipping (c) entirely) purely so every
 * pre-existing caller/test of this function keeps compiling unchanged; real
 * callers (ContentStore.masteryStats) always pass it.
 */
export function masteredLemmaSet(
  sentences: Sentence[],
  knowledge: KnowledgeMap,
  states: Iterable<ReviewState>,
  deckLemmas: Set<string>,
  stabilityThresholdDays: number = MASTERY_STABILITY_DAYS,
  wordById?: Map<number, DeckWord>,
): Set<string> {
  const out = new Set<string>();

  for (const [lemma, status] of knowledge) {
    if (status === "known" && deckLemmas.has(lemma)) out.add(lemma);
  }

  const targetById = new Map<string, string>();
  const wordIdsById = new Map<string, number[]>();
  for (const s of sentences) {
    if (s.targetLemma) targetById.set(s.id, s.targetLemma);
    if (wordById) wordIdsById.set(s.id, s.wordIds);
  }

  // (c) tally: lemma -> count of distinct durably-retained sentences that
  // cover it incidentally (i.e. as a non-target wordId).
  const incidentalSentenceCountByLemma = new Map<string, number>();

  for (const st of states) {
    if (st.stability == null || st.stability < stabilityThresholdDays) continue;

    // (b) the sentence's own designated target — unchanged, one pass suffices.
    const targetLemma = targetById.get(st.sentenceId);
    if (targetLemma && deckLemmas.has(targetLemma)) out.add(targetLemma);

    // (c) every OTHER word this durably-retained sentence happens to cover.
    if (!wordById) continue;
    const wordIds = wordIdsById.get(st.sentenceId);
    if (!wordIds) continue;
    for (const wid of wordIds) {
      const w = wordById.get(wid);
      if (!w || !deckLemmas.has(w.lemma) || w.lemma === targetLemma) continue;
      incidentalSentenceCountByLemma.set(w.lemma, (incidentalSentenceCountByLemma.get(w.lemma) ?? 0) + 1);
    }
  }

  for (const [lemma, count] of incidentalSentenceCountByLemma) {
    if (count >= MASTERY_MIN_INCIDENTAL_EXPOSURES) out.add(lemma);
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
  wordById?: Map<number, DeckWord>,
): MasteryStats {
  const mastered = masteredLemmaSet(
    sentences,
    knowledge,
    states,
    deckLemmas,
    stabilityThresholdDays,
    wordById,
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
