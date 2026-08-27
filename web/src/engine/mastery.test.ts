import { describe, it, expect } from "vitest";
import {
  estimatedCoveragePct,
  masteryLevelLabel,
  masteredLemmaSet,
  masteryStats,
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
});
