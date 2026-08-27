import { describe, it, expect } from "vitest";
import {
  BEGINNER_MAX_KNOWN_IN_BLOCK1,
  BLOCK_SIZE,
  MAX_QUESTIONS,
  SEED_STABILITY_MAX_DAYS,
  SEED_STABILITY_MIN_DAYS,
  adaptiveTargetRanks,
  block1TargetRanks,
  dispersedSeedStabilityDays,
  estimatedMasteredCount,
  finalizePlacement,
  fitPlacement,
  isBeginnerAfterBlock1,
  selectWordsForRanks,
} from "./placement";
import type { PlacementResponse, RankedWord } from "./placement";

const MAX_RANK = 3000;

function resp(rank: number, known: boolean, lemma = `w${rank}`): PlacementResponse {
  return { lemma, rank, known };
}

// --- fitPlacement -------------------------------------------------------------

describe("fitPlacement (logistic MLE via deterministic grid search)", () => {
  it("is fully deterministic: identical input -> byte-identical output, twice", () => {
    const data = [resp(50, true), resp(300, true), resp(900, false), resp(2000, false)];
    const a = fitPlacement(data, MAX_RANK);
    const b = fitPlacement(data, MAX_RANK);
    expect(a).toEqual(b);
  });

  it("recovers a boundary near rank 500 from a clean known-below/unknown-above split", () => {
    const data = [
      resp(20, true),
      resp(60, true),
      resp(150, true),
      resp(300, true),
      resp(450, true),
      resp(600, false),
      resp(900, false),
      resp(1500, false),
      resp(2200, false),
      resp(2900, false),
    ];
    const fit = fitPlacement(data, MAX_RANK);
    expect(fit.theta).toBeGreaterThan(400);
    expect(fit.theta).toBeLessThan(700);
    expect(fit.degenerate).toBe(false);
  });

  it("all-known responses push theta to the top of the range and flag degenerate", () => {
    const data = [resp(10, true), resp(100, true), resp(1000, true), resp(2900, true)];
    const fit = fitPlacement(data, MAX_RANK);
    expect(fit.theta).toBeGreaterThan(2000);
    expect(fit.degenerate).toBe(true);
  });

  it("all-unknown responses push theta to the bottom of the range and flag degenerate", () => {
    const data = [resp(10, false), resp(100, false), resp(1000, false), resp(2900, false)];
    const fit = fitPlacement(data, MAX_RANK);
    expect(fit.theta).toBeLessThan(200);
    expect(fit.degenerate).toBe(true);
  });

  it("no responses yet -> midpoint theta with a full-range CI (never called in practice, but must not throw)", () => {
    const fit = fitPlacement([], MAX_RANK);
    expect(fit.theta).toBeGreaterThan(1);
    expect(fit.theta).toBeLessThan(MAX_RANK);
    expect(fit.ciLowRank).toBe(1);
    expect(fit.ciHighRank).toBe(MAX_RANK);
  });

  it("more consistent evidence narrows the CI relative to a single ambiguous block", () => {
    const sparse = [resp(20, true), resp(2000, false)];
    const dense = [
      resp(20, true),
      resp(60, true),
      resp(150, true),
      resp(300, true),
      resp(450, true),
      resp(600, false),
      resp(900, false),
      resp(1500, false),
      resp(2200, false),
      resp(2900, false),
    ];
    const sparseFit = fitPlacement(sparse, MAX_RANK);
    const denseFit = fitPlacement(dense, MAX_RANK);
    expect(denseFit.ciHalfWidthWords).toBeLessThan(sparseFit.ciHalfWidthWords);
  });
});

describe("estimatedMasteredCount", () => {
  it("rounds theta to a whole word count", () => {
    expect(estimatedMasteredCount({ theta: 512.4, slope: 1, ciLowRank: 1, ciHighRank: 1, ciHalfWidthWords: 0, degenerate: false })).toBe(512);
    expect(estimatedMasteredCount({ theta: 512.6, slope: 1, ciLowRank: 1, ciHighRank: 1, ciHalfWidthWords: 0, degenerate: false })).toBe(513);
  });
});

// --- block ranks ---------------------------------------------------------------

describe("block1TargetRanks", () => {
  it("returns BLOCK_SIZE ascending, log-spaced ranks spanning ~1 to maxRank", () => {
    const ranks = block1TargetRanks(MAX_RANK);
    expect(ranks.length).toBe(BLOCK_SIZE);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBeLessThanOrEqual(2);
    expect(ranks[ranks.length - 1]).toBeGreaterThanOrEqual(MAX_RANK - 5);
    // log-spaced: gaps should grow, not stay constant (first gap << last gap).
    const firstGap = ranks[1] - ranks[0];
    const lastGap = ranks[ranks.length - 1] - ranks[ranks.length - 2];
    expect(lastGap).toBeGreaterThan(firstGap);
  });

  it("is deterministic", () => {
    expect(block1TargetRanks(MAX_RANK)).toEqual(block1TargetRanks(MAX_RANK));
  });
});

describe("isBeginnerAfterBlock1", () => {
  it("0 or 1 known out of 10 -> beginner", () => {
    const zero = Array.from({ length: 10 }, (_, i) => resp(i + 1, false));
    const one = zero.map((r, i) => (i === 0 ? { ...r, known: true } : r));
    expect(isBeginnerAfterBlock1(zero)).toBe(true);
    expect(isBeginnerAfterBlock1(one)).toBe(true);
    expect(BEGINNER_MAX_KNOWN_IN_BLOCK1).toBe(1);
  });

  it("2+ known out of 10 -> not beginner", () => {
    const two = Array.from({ length: 10 }, (_, i) => resp(i + 1, i < 2));
    expect(isBeginnerAfterBlock1(two)).toBe(false);
  });
});

describe("adaptiveTargetRanks", () => {
  it("centres the window on theta and stays within [1, maxRank]", () => {
    const fit = fitPlacement(
      [resp(20, true), resp(60, true), resp(600, false), resp(2000, false)],
      MAX_RANK,
    );
    const ranks = adaptiveTargetRanks(fit, { maxRank: MAX_RANK });
    expect(ranks.length).toBeGreaterThan(0);
    for (const r of ranks) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(MAX_RANK);
    }
    const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    expect(Math.abs(mean - fit.theta)).toBeLessThan(fit.ciHalfWidthWords + 200);
  });

  it("a mostly-known block 1 (design's 9-10/10 branch) skews the next block's window high", () => {
    // 9 known, 1 unknown across the block1 screening ranks -> theta pinned near the ceiling.
    const block1Ranks = block1TargetRanks(MAX_RANK);
    const mostlyKnown = block1Ranks.map((r, i) => resp(r, i < 9));
    const fit = fitPlacement(mostlyKnown, MAX_RANK);
    const ranks = adaptiveTargetRanks(fit, { maxRank: MAX_RANK });
    const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    expect(mean).toBeGreaterThan(MAX_RANK * 0.4); // skews toward the top of the list
  });

  it("narrows the window as the fit becomes more confident (denser evidence)", () => {
    const sparseFit = fitPlacement([resp(20, true), resp(2000, false)], MAX_RANK);
    const denseFit = fitPlacement(
      [
        resp(20, true),
        resp(60, true),
        resp(150, true),
        resp(300, true),
        resp(450, true),
        resp(600, false),
        resp(900, false),
        resp(1500, false),
        resp(2200, false),
        resp(2900, false),
      ],
      MAX_RANK,
    );
    const sparseRanks = adaptiveTargetRanks(sparseFit, { maxRank: MAX_RANK });
    const denseRanks = adaptiveTargetRanks(denseFit, { maxRank: MAX_RANK });
    const spread = (rs: number[]) => Math.max(...rs) - Math.min(...rs);
    expect(spread(denseRanks)).toBeLessThan(spread(sparseRanks));
  });
});

// --- word selection --------------------------------------------------------------

function words(n: number): RankedWord[] {
  return Array.from({ length: n }, (_, i) => ({ lemma: `w${i + 1}`, rank: i + 1 }));
}

describe("selectWordsForRanks", () => {
  it("picks the nearest available word to each target rank", () => {
    const chosen = selectWordsForRanks(words(3000), [1, 500, 3000], new Set());
    expect(chosen.map((w) => w.rank)).toEqual([1, 500, 3000]);
  });

  it("never returns the same lemma twice within one call, even for colliding target ranks", () => {
    const chosen = selectWordsForRanks(words(3000), [500, 500, 501], new Set());
    const lemmas = chosen.map((w) => w.lemma);
    expect(new Set(lemmas).size).toBe(lemmas.length);
  });

  it("skips lemmas already used in a previous block (excludeLemmas)", () => {
    const exclude = new Set(["w500"]);
    const chosen = selectWordsForRanks(words(3000), [500], exclude);
    expect(chosen[0].lemma).not.toBe("w500");
    expect(chosen[0].rank).toBeGreaterThanOrEqual(499); // nearest neighbour, either side
  });

  it("returns fewer results than requested if the pool is exhausted", () => {
    const chosen = selectWordsForRanks(words(1), [1, 1, 1], new Set());
    expect(chosen.length).toBe(1);
  });
});

// --- seed dispersion ---------------------------------------------------------------

describe("dispersedSeedStabilityDays", () => {
  it("spans exactly [30,120] at the range endpoints", () => {
    expect(dispersedSeedStabilityDays(1, 1, 500)).toBe(SEED_STABILITY_MAX_DAYS);
    expect(dispersedSeedStabilityDays(500, 1, 500)).toBe(SEED_STABILITY_MIN_DAYS);
  });

  it("is monotonically decreasing as rank increases toward the boundary", () => {
    const a = dispersedSeedStabilityDays(100, 1, 500);
    const b = dispersedSeedStabilityDays(300, 1, 500);
    const c = dispersedSeedStabilityDays(499, 1, 500);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("degenerates safely to the max when the range is empty/inverted", () => {
    expect(dispersedSeedStabilityDays(50, 100, 100)).toBe(SEED_STABILITY_MAX_DAYS);
    expect(dispersedSeedStabilityDays(50, 100, 50)).toBe(SEED_STABILITY_MAX_DAYS);
  });

  it("disperses a set of ranks across distinct days (the actual anti-pileup property)", () => {
    const ranks = [1, 50, 100, 150, 200];
    const days = ranks.map((r) => dispersedSeedStabilityDays(r, 1, 200));
    expect(new Set(days).size).toBe(days.length); // no two land on the same day
    for (const d of days) {
      expect(d).toBeGreaterThanOrEqual(SEED_STABILITY_MIN_DAYS);
      expect(d).toBeLessThanOrEqual(SEED_STABILITY_MAX_DAYS);
    }
  });
});

// --- finalizePlacement ------------------------------------------------------------

describe("finalizePlacement (write-out partitioning)", () => {
  const allWords: RankedWord[] = words(1000);

  it("splits into judged (ground truth), assumed known/unknown, and leaves the band unset", () => {
    const responses = [resp(20, true, "w20"), resp(900, false, "w900")];
    const fit = fitPlacement(responses, 1000);
    const out = finalizePlacement(fit, responses, allWords);

    expect(out.judgedKnown).toEqual(["w20"]);
    expect(out.judgedUnknown).toEqual(["w900"]);

    // Every assumed-known word is strictly below the band, every assumed-unknown
    // word strictly above it; the judged words never appear in either list.
    for (const lemma of out.assumedKnown) {
      const rank = Number(lemma.slice(1));
      expect(rank).toBeLessThan(out.bandLowRank);
    }
    for (const lemma of out.assumedUnknown) {
      const rank = Number(lemma.slice(1));
      expect(rank).toBeGreaterThan(out.bandHighRank);
    }
    expect(out.assumedKnown).not.toContain("w20");
    expect(out.assumedUnknown).not.toContain("w900");

    // Nothing is double-counted, and every word ends up in exactly one bucket
    // or the (silently dropped) unset band.
    const accounted = new Set([...out.judgedKnown, ...out.judgedUnknown, ...out.assumedKnown, ...out.assumedUnknown]);
    expect(accounted.size).toBe(
      out.judgedKnown.length + out.judgedUnknown.length + out.assumedKnown.length + out.assumedUnknown.length,
    );
    expect(accounted.size).toBeLessThan(allWords.length); // the band itself is left out
  });

  it("only assigns a dispersed seed stability to assumed-known words, all within [30,120]", () => {
    const responses = [resp(20, true, "w20"), resp(900, false, "w900")];
    const fit = fitPlacement(responses, 1000);
    const out = finalizePlacement(fit, responses, allWords);

    expect([...out.seedStabilityDaysByLemma.keys()].sort()).toEqual([...out.assumedKnown].sort());
    for (const days of out.seedStabilityDaysByLemma.values()) {
      expect(days).toBeGreaterThanOrEqual(SEED_STABILITY_MIN_DAYS);
      expect(days).toBeLessThanOrEqual(SEED_STABILITY_MAX_DAYS);
    }
  });

  it("a beginner fit (theta near 1) assumes almost nothing known", () => {
    const block1 = block1TargetRanks(1000).map((r) => resp(r, false));
    const fit = fitPlacement(block1, 1000);
    const out = finalizePlacement(fit, block1, allWords);
    expect(out.assumedKnown.length).toBeLessThan(20); // near-zero, not the whole deck
  });
});

// --- contract-level sanity ---------------------------------------------------------

describe("Task Contract soft cap", () => {
  it("MAX_QUESTIONS is exactly 4 blocks of BLOCK_SIZE (the explicit 'ソフト上限40問')", () => {
    expect(MAX_QUESTIONS).toBe(40);
    expect(MAX_QUESTIONS % BLOCK_SIZE).toBe(0);
  });
});
