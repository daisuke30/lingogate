import { describe, it, expect } from "vitest";
import {
  estimatedCoveragePct,
  masteryLevelLabel,
  masteredLemmaSet,
  masteryStats,
  approximateWordCount,
  MASTERY_STABILITY_DAYS,
  MASTERY_TARGET_WORDS,
} from "./mastery";
import type { Sentence } from "./content";
import type { KnowledgeMap } from "./calibration";
import { CardState, newReviewState } from "./fsrs";
import type { ReviewState } from "./fsrs";

// --- coverage interpolation --------------------------------------------------

describe("estimatedCoveragePct (piecewise-linear coverage curve)", () => {
  it("hits the control points exactly", () => {
    expect(estimatedCoveragePct(0)).toBe(0);
    expect(estimatedCoveragePct(1000)).toBe(85);
    expect(estimatedCoveragePct(2000)).toBe(90);
    expect(estimatedCoveragePct(3000)).toBe(95);
  });

  it("interpolates linearly between points, 1 decimal", () => {
    expect(estimatedCoveragePct(500)).toBe(42.5); // half of 0→85
    expect(estimatedCoveragePct(1500)).toBe(87.5); // midpoint 85→90
    expect(estimatedCoveragePct(2500)).toBe(92.5); // midpoint 90→95
    expect(estimatedCoveragePct(250)).toBe(21.3); // 85*0.25 = 21.25 → 21.3
    expect(estimatedCoveragePct(1234)).toBe(86.2); // 85 + 5*0.234 = 86.17 → 86.2
  });

  it("clamps below 0 and above 3000", () => {
    expect(estimatedCoveragePct(-100)).toBe(0);
    expect(estimatedCoveragePct(3000)).toBe(95);
    expect(estimatedCoveragePct(5000)).toBe(95);
  });
});

// --- level ladder ------------------------------------------------------------

describe("masteryLevelLabel", () => {
  it("labels by highest reached threshold", () => {
    expect(masteryLevelLabel(0)).toBe("完全初心者");
    expect(masteryLevelLabel(1)).toBe("完全初心者");
    expect(masteryLevelLabel(499)).toBe("完全初心者");
    expect(masteryLevelLabel(500)).toBe("500マスター");
    expect(masteryLevelLabel(999)).toBe("500マスター");
    expect(masteryLevelLabel(1000)).toBe("1000マスター");
    expect(masteryLevelLabel(1500)).toBe("1500マスター");
    expect(masteryLevelLabel(2000)).toBe("2000マスター");
    expect(masteryLevelLabel(2500)).toBe("2500マスター");
    expect(masteryLevelLabel(3000)).toBe("3000マスター");
    expect(masteryLevelLabel(9999)).toBe("3000マスター");
  });
});

// --- mastered-lemma aggregation ---------------------------------------------

function target(id: string, lemma: string): Sentence {
  return {
    id,
    ru: `ру ${id}`,
    en: `en ${id}`,
    ja: null,
    kana: null,
    note: null,
    band: 1,
    difficulty: 1,
    source: "generated",
    kind: "sentence",
    targetLemma: lemma,
    wordIds: [],
    minRank: 1,
    tokenCount: 2,
  };
}

function stateWithStability(sentenceId: string, stability: number | null): ReviewState {
  return {
    ...newReviewState(sentenceId),
    stability,
    difficulty: 5,
    due: 0,
    reps: 1,
    lapses: 0,
    lastReview: 0,
    state: CardState.Review,
  };
}

const DECK_LEMMAS = new Set(["дом", "рука", "книга", "город", "вода"]);

describe("masteredLemmaSet", () => {
  it("counts judged-known deck lemmas", () => {
    const knowledge: KnowledgeMap = new Map([
      ["дом", "known"],
      ["рука", "unknown"],
      ["книга", "unset"],
    ]);
    const set = masteredLemmaSet([], knowledge, [], DECK_LEMMAS);
    expect([...set]).toEqual(["дом"]);
  });

  it("ignores a known lemma that is not a deck word (stays within the 3000 universe)", () => {
    const knowledge: KnowledgeMap = new Map([["собака", "known"]]);
    const set = masteredLemmaSet([], knowledge, [], DECK_LEMMAS);
    expect(set.size).toBe(0);
  });

  it("counts a target word whose review stability ≥ threshold", () => {
    const sentences = [target("T1", "город"), target("T2", "вода")];
    const states = [
      stateWithStability("T1", MASTERY_STABILITY_DAYS), // exactly at threshold → mastered
      stateWithStability("T2", MASTERY_STABILITY_DAYS - 0.01), // just under → not
    ];
    const set = masteredLemmaSet(sentences, new Map(), states, DECK_LEMMAS);
    expect([...set]).toEqual(["город"]);
  });

  it("ignores a low-stability or null-stability (new) card's target", () => {
    const sentences = [target("T1", "город")];
    const states = [stateWithStability("T1", null), stateWithStability("T1", 5)];
    const set = masteredLemmaSet(sentences, new Map(), states, DECK_LEMMAS);
    expect(set.size).toBe(0);
  });

  it("dedups a lemma mastered via BOTH known-judgement and a stable target", () => {
    const knowledge: KnowledgeMap = new Map([["город", "known"]]);
    const sentences = [target("T1", "город")];
    const states = [stateWithStability("T1", 60)];
    const set = masteredLemmaSet(sentences, knowledge, states, DECK_LEMMAS);
    expect([...set]).toEqual(["город"]); // counted once
  });

  it("ignores a stable state for an orphan sentence not in the deck", () => {
    const states = [stateWithStability("ghost", 60)];
    const set = masteredLemmaSet([], new Map(), states, DECK_LEMMAS);
    expect(set.size).toBe(0);
  });
});

describe("masteryStats", () => {
  it("combines count, target, coverage and level", () => {
    const knowledge: KnowledgeMap = new Map([
      ["дом", "known"],
      ["рука", "known"],
    ]);
    const sentences = [target("T1", "город")];
    const states = [stateWithStability("T1", 30)];
    const stats = masteryStats(sentences, knowledge, states, DECK_LEMMAS);
    expect(stats.masteredCount).toBe(3); // дом, рука, город
    expect(stats.targetWords).toBe(MASTERY_TARGET_WORDS);
    expect(stats.coveragePct).toBe(estimatedCoveragePct(3));
    expect(stats.level).toBe("完全初心者");
  });

  // LINGO-040 (QA-7): a 1–3 minute level check can declare several hundred
  // words known, and the old screen folded those into a single "N語マスター".
  // The split is what lets the details sheet say which half is the learner's
  // own claim and which half the app watched stick.
  it("splits the count into declared (level check) and learned (study)", () => {
    const knowledge: KnowledgeMap = new Map([
      ["дом", "known"],
      ["рука", "known"],
    ]);
    const stats = masteryStats(
      [target("T1", "город")],
      knowledge,
      [stateWithStability("T1", 30)],
      DECK_LEMMAS,
    );
    expect(stats.declaredCount).toBe(2); // дом, рука
    expect(stats.learnedCount).toBe(1); // город
    expect(stats.declaredCount + stats.learnedCount).toBe(stats.masteredCount);
  });

  it("counts a lemma earned BOTH ways as declared only, never twice", () => {
    // город was ticked in the level check AND has since become stable.
    const knowledge: KnowledgeMap = new Map([["город", "known"]]);
    const stats = masteryStats(
      [target("T1", "город")],
      knowledge,
      [stateWithStability("T1", 30)],
      DECK_LEMMAS,
    );
    expect(stats.masteredCount).toBe(1);
    expect(stats.declaredCount).toBe(1);
    expect(stats.learnedCount).toBe(0);
  });
});

// --- headline approximation (LINGO-046) -------------------------------------
// "覚えた語 275" reads as a measurement; it isn't. The figure blends a
// self-declared level check with FSRS stability crossing a threshold, so the
// last digit carries no meaning worth showing.

describe("approximateWordCount", () => {
  it("rounds down to a round ten and flags the result as approximate", () => {
    expect(approximateWordCount(275)).toEqual({ value: 270, isApproximate: true });
    expect(approximateWordCount(270)).toEqual({ value: 270, isApproximate: true });
    expect(approximateWordCount(279)).toEqual({ value: 270, isApproximate: true });
    expect(approximateWordCount(1234)).toEqual({ value: 1230, isApproximate: true });
  });

  it("never rounds UP — the app must not claim more words than the learner has", () => {
    for (const n of [10, 11, 19, 99, 101, 999, 2999]) {
      expect(approximateWordCount(n).value).toBeLessThanOrEqual(n);
    }
  });

  it("returns small counts exactly, so nobody is told they know '約0語'", () => {
    expect(approximateWordCount(0)).toEqual({ value: 0, isApproximate: false });
    expect(approximateWordCount(7)).toEqual({ value: 7, isApproximate: false });
    expect(approximateWordCount(9)).toEqual({ value: 9, isApproximate: false });
    // 10 is the first value where rounding says anything at all.
    expect(approximateWordCount(10)).toEqual({ value: 10, isApproximate: true });
  });

  it("clamps nonsense input rather than propagating it to the screen", () => {
    expect(approximateWordCount(-5)).toEqual({ value: 0, isApproximate: false });
    expect(approximateWordCount(12.9)).toEqual({ value: 10, isApproximate: true });
  });
});
