import { describe, it, expect } from "vitest";
import { COLLAPSED_FUNCTION_WORD_RANK, hasExplanation, wordDensity } from "./explain";
import type { SentenceCommentary } from "./explain";
import type { KnowledgeMap } from "./calibration";

const km = (entries: Record<string, "known" | "unknown" | "unset">): KnowledgeMap =>
  new Map(Object.entries(entries));

const input = (over: Partial<Parameters<typeof wordDensity>[0]> = {}) => ({
  lemma: "машина",
  pos: "noun",
  rank: 500,
  knowledge: km({}),
  ...over,
});

// The density rule is the one judgement call in this feature: a full entry is
// several paragraphs, and a sentence has five to eight words. Getting this
// wrong means the answer to the learner's actual question is buried.

describe("wordDensity (LINGO-057 display density, Katsuta-approved)", () => {
  // LINGO-061: the generator's target word gets no special tier. It is the
  // word the SENTENCE was built for, not the word this learner lacks, and
  // promoting it announced the wrong protagonist.
  it("gives the sentence's target word no special treatment", () => {
    // машина judged known → collapsed, exactly like any other known word,
    // even though the sentence was generated for it.
    expect(wordDensity(input({ knowledge: km({ машина: "known" }) }))).toBe("collapsed");
    // And an unknown word is open whether or not it was the generator's pick.
    expect(wordDensity(input({ lemma: "проверить", pos: "verb", rank: 800 }))).toBe("expanded");
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

