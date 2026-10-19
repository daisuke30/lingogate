import { describe, it, expect } from "vitest";
import {
  COLLAPSED_FUNCTION_WORD_RANK,
  hasExplanation,
  orderExplainWords,
  wordDensity,
} from "./explain";
import type { SentenceCommentary } from "./explain";
import type { KnowledgeMap } from "./calibration";

const km = (entries: Record<string, "known" | "unknown" | "unset">): KnowledgeMap =>
  new Map(Object.entries(entries));

const input = (over: Partial<Parameters<typeof wordDensity>[0]> = {}) => ({
  lemma: "машина",
  pos: "noun",
  rank: 500,
  isTarget: false,
  knowledge: km({}),
  ...over,
});

// The density rule is the one judgement call in this feature: a full entry is
// several paragraphs, and a sentence has five to eight words. Getting this
// wrong means the answer to the learner's actual question is buried.

describe("wordDensity (LINGO-057 display density, Katsuta-approved)", () => {
  it("always fully opens the word the sentence exists to teach", () => {
    expect(wordDensity(input({ isTarget: true }))).toBe("target");
    // Even if they already said they know it, and even if it is a top-rank
    // function word — it is still why this card is on screen.
    expect(
      wordDensity(input({ isTarget: true, knowledge: km({ машина: "known" }), pos: "prep", rank: 3 })),
    ).toBe("target");
  });

  it("opens words the learner has not judged as known", () => {
    expect(wordDensity(input({ knowledge: km({}) }))).toBe("expanded");
    expect(wordDensity(input({ knowledge: km({ машина: "unknown" }) }))).toBe("expanded");
    expect(wordDensity(input({ knowledge: km({ машина: "unset" }) }))).toBe("expanded");
  });

  it("collapses words the learner said they know", () => {
    expect(wordDensity(input({ knowledge: km({ машина: "known" }) }))).toBe("collapsed");
  });

  it("collapses only the very top function words, never content words", () => {
    const fn = (rank: number) => wordDensity(input({ lemma: "и", pos: "conj", rank }));
    expect(fn(3)).toBe("collapsed");
    expect(fn(COLLAPSED_FUNCTION_WORD_RANK)).toBe("collapsed");
    expect(fn(COLLAPSED_FUNCTION_WORD_RANK + 1)).toBe("expanded");

    // A very frequent VERB is still worth reading about.
    expect(wordDensity(input({ lemma: "быть", pos: "verb", rank: 1 }))).toBe("expanded");
    expect(wordDensity(input({ lemma: "дом", pos: "noun", rank: 2 }))).toBe("expanded");
  });

  it("never collapses on rank when the deck has no rank for the word", () => {
    expect(wordDensity(input({ lemma: "и", pos: "conj", rank: null }))).toBe("expanded");
  });
});

describe("orderExplainWords", () => {
  it("puts the target first and otherwise keeps sentence order", () => {
    const words = [
      { entry: "ты", density: "collapsed" as const },
      { entry: "продал", density: "target" as const },
      { entry: "машину", density: "expanded" as const },
    ];
    expect(orderExplainWords(words).map((w) => w.entry)).toEqual(["продал", "ты", "машину"]);
  });

  it("is a no-op when there is no target (a notes sentence)", () => {
    const words = [
      { entry: "a", density: "expanded" as const },
      { entry: "b", density: "collapsed" as const },
    ];
    expect(orderExplainWords(words).map((w) => w.entry)).toEqual(["a", "b"]);
  });
});

describe("hasExplanation (button visibility)", () => {
  const commentary: SentenceCommentary = {
    T0164: { id: "T0164", skeleton: [], keyPoint: "", replies: [] },
  };

  it("is true only for a sentence that actually has an entry", () => {
    expect(hasExplanation("T0164", commentary)).toBe(true);
    expect(hasExplanation("T9999", commentary)).toBe(false);
  });

  it("is false when the course ships no commentary at all (EN/TH/JA)", () => {
    expect(hasExplanation("T0164", null)).toBe(false);
  });

  it("is not fooled by inherited Object properties", () => {
    // A sentence id of "constructor" must not look like it has an entry.
    expect(hasExplanation("constructor", commentary)).toBe(false);
    expect(hasExplanation("toString", {} as SentenceCommentary)).toBe(false);
  });
});

// LINGO-057 follow-up: ordering must not drop the extra per-word display data
// the sheet carries (the deck glosses), or the English meaning Katsuta
// explicitly asked for would vanish on exactly the words that got reordered.
describe("orderExplainWords preserves per-word payload", () => {
  it("keeps every field on the reordered items", () => {
    const words = [
      { entry: "ты", density: "collapsed" as const, gloss: "you / あなた" },
      { entry: "проверить", density: "target" as const, gloss: "to check / 確認する" },
    ];
    const out = orderExplainWords(words);
    expect(out[0]).toEqual({
      entry: "проверить",
      density: "target",
      gloss: "to check / 確認する",
    });
    expect(out[1].gloss).toBe("you / あなた");
  });
});
