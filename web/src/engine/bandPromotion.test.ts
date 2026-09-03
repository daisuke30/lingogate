import { describe, it, expect } from "vitest";
import { evaluateBandPromotion } from "./bandPromotion";

// Ported 1:1 from ios/QuizEngine/Tests/QuizEngineTests/BandPromotionTests.swift
// (LINGO-004) — same cases, same expected results, so this engine's behaviour
// stays provably identical to the iOS implementation it was ported from.
// coverage = seen/coverable, retention = reps/(reps+lapses).

describe("evaluateBandPromotion (LINGO-024: coverage>=90% AND retention>=80%)", () => {
  it("promotes when both thresholds are met", () => {
    // coverage 90/100 = 0.90, retention 8/(8+2) = 0.80, 6 review cards.
    const p = evaluateBandPromotion({
      band: 1,
      seenWords: 90,
      totalWords: 200,
      coverableWords: 100,
      reps: 8,
      lapses: 2,
      reviewCards: 6,
    });
    expect(p.coverage).toBeCloseTo(0.9, 9);
    expect(p.retention).toBeCloseTo(0.8, 9);
    expect(p.promoted).toBe(true);
  });

  it("coverage just below threshold blocks", () => {
    // 89/100 = 0.89 < 0.90
    const p = evaluateBandPromotion({
      band: 1,
      seenWords: 89,
      totalWords: 200,
      coverableWords: 100,
      reps: 9,
      lapses: 1,
      reviewCards: 8,
    });
    expect(p.promoted).toBe(false);
  });

  it("retention just below threshold blocks", () => {
    // 79/(79+21) = 0.79 < 0.80
    const p = evaluateBandPromotion({
      band: 1,
      seenWords: 95,
      totalWords: 100,
      coverableWords: 100,
      reps: 79,
      lapses: 21,
      reviewCards: 10,
    });
    expect(p.promoted).toBe(false);
  });

  it("too few review cards blocks even at perfect retention", () => {
    // 4 cards < minReviewCards 5, retention 1.0, coverage 1.0 -> still blocked.
    const p = evaluateBandPromotion({
      band: 1,
      seenWords: 100,
      totalWords: 100,
      coverableWords: 100,
      reps: 4,
      lapses: 0,
      reviewCards: 4,
    });
    expect(p.promoted).toBe(false);
  });

  it("zero data is safe (no divide-by-zero, no false promotion)", () => {
    const p = evaluateBandPromotion({
      band: 1,
      seenWords: 0,
      totalWords: 0,
      coverableWords: 0,
      reps: 0,
      lapses: 0,
      reviewCards: 0,
    });
    expect(p.coverage).toBe(0);
    expect(p.retention).toBe(0);
    expect(p.promoted).toBe(false);
  });

  it("custom thresholds override the defaults", () => {
    const p = evaluateBandPromotion(
      { band: 1, seenWords: 50, totalWords: 100, coverableWords: 100, reps: 5, lapses: 5, reviewCards: 5 },
      { coverageThreshold: 0.5, retentionThreshold: 0.5, minReviewCards: 5 },
    );
    expect(p.coverage).toBeCloseTo(0.5, 9);
    expect(p.retention).toBeCloseTo(0.5, 9);
    expect(p.promoted).toBe(true); // would fail the 0.9/0.8 defaults
  });
});
