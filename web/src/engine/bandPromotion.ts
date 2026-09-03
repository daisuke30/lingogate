// Band promotion (LINGO-024): decides when the next 1000-word band unlocks —
// vocab coverage ≥ 90% AND retention ≥ 80% of the CURRENTLY unlocked band
// (design doc §5.1's "3000語フレーム" — bands progress 1 -> 2 -> 3). Ported
// 1:1 from the iOS implementation (ios/QuizEngine/Sources/QuizEngine/
// Promotion/BandPromotion.swift, LINGO-004) — that engine was built but never
// actually wired to anything (iOS's `currentBand` was hardcoded to 1); this
// port is what state/service.ts finally connects to real data.
//
// Pure threshold evaluation only — no IndexedDB/course knowledge here, so the
// boundary behaviour is unit-testable without a database. state/service.ts
// supplies the coverage/retention inputs from ContentStore.bandVocabStats /
// bandRetention (band-EXACT queries — see content.ts, unaffected by the
// pool-ceiling change to dueReviews/newSentences/upcomingReviews).

export interface BandProgress {
  band: number;
  /** 0..1 — seenWords / coverableWords. */
  coverage: number;
  /** 0..1 — reps / (reps + lapses). */
  retention: number;
  seenWords: number;
  coverageDenominator: number;
  reviewCards: number;
  promoted: boolean;
}

export const DEFAULT_COVERAGE_THRESHOLD = 0.9;
export const DEFAULT_RETENTION_THRESHOLD = 0.8;
/** Ignore retention until at least this many cards are in the Review state,
 * so a lucky 1/1 doesn't trip an 80% gate on a nearly-empty band. */
export const DEFAULT_MIN_REVIEW_CARDS = 5;

export interface BandPromotionInput {
  band: number;
  seenWords: number;
  totalWords: number;
  /** Only band words that appear in >=1 sentence (the learnable vocab) — the
   * coverage denominator. Matches iOS's default `.coverableWords` basis (the
   * web build has no `.allBandWords` alternative — that option was never
   * exercised by anything real, so it wasn't ported; `totalWords` is kept on
   * the input/output shape purely for parity with ContentStore.bandVocabStats
   * and BandProgress display, not used in the coverage ratio). */
  coverableWords: number;
  reps: number;
  lapses: number;
  reviewCards: number;
}

export interface BandPromotionThresholds {
  coverageThreshold?: number;
  retentionThreshold?: number;
  minReviewCards?: number;
}

/** Pure threshold evaluation from already-computed components — see
 * BandPromotionTests.swift for the reference behaviour this mirrors exactly. */
export function evaluateBandPromotion(
  input: BandPromotionInput,
  thresholds: BandPromotionThresholds = {},
): BandProgress {
  const coverageThreshold = thresholds.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD;
  const retentionThreshold = thresholds.retentionThreshold ?? DEFAULT_RETENTION_THRESHOLD;
  const minReviewCards = thresholds.minReviewCards ?? DEFAULT_MIN_REVIEW_CARDS;

  const denom = input.coverableWords;
  const coverage = denom > 0 ? input.seenWords / denom : 0;
  const attempts = input.reps + input.lapses;
  const retention = attempts > 0 ? input.reps / attempts : 0;

  const coverageOK = coverage >= coverageThreshold;
  const retentionOK = input.reviewCards >= minReviewCards && retention >= retentionThreshold;

  return {
    band: input.band,
    coverage,
    retention,
    seenWords: input.seenWords,
    coverageDenominator: denom,
    reviewCards: input.reviewCards,
    promoted: coverageOK && retentionOK,
  };
}
