import { describe, it, expect } from "vitest";
import { evaluateBandPromotion, wordsToPromotion } from "./bandPromotion";

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

// LINGO-040: the one number Home now shows about the next step, replacing
// "次の解放まで カバー率28/90%・定着率79/80%" — four numbers and two
// thresholds that only their author could read.
describe("wordsToPromotion (LINGO-040)", () => {
  const progress = (seenWords: number, coverageDenominator: number) => ({
    seenWords,
    coverageDenominator,
  });

  it("reports the remaining distance to the 90% coverage gate", () => {
    // 998 coverable words -> the gate opens at ceil(0.9 * 998) = 899.
    expect(wordsToPromotion(progress(284, 998))).toBe(615);
    expect(wordsToPromotion(progress(898, 998))).toBe(1);
  });

  it("ceils, so 89.9% never reads as '0 more words'", () => {
    // 89 of 100 = 89% — still short, and must say so.
    expect(wordsToPromotion(progress(89, 100))).toBe(1);
  });

  it("is 0 once the coverage half of the gate is satisfied (Home then switches to the review line)", () => {
    expect(wordsToPromotion(progress(90, 100))).toBe(0);
    expect(wordsToPromotion(progress(100, 100))).toBe(0);
  });

  it("never goes negative, and handles an empty band", () => {
    expect(wordsToPromotion(progress(120, 100))).toBe(0);
    expect(wordsToPromotion(progress(0, 0))).toBe(0);
  });

  it("honours a custom coverage threshold", () => {
    expect(wordsToPromotion(progress(40, 100), 0.5)).toBe(10);
  });
});
