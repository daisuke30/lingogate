import { describe, it, expect } from "vitest";
import { buildWordBreakdown, formatAspectLine, formatGenderLine, posLabel } from "./wordBreakdown";
import type { DeckWord } from "./content";

function word(over: Partial<DeckWord> & { id: number; lemma: string; pos: string }): DeckWord {
  return {
    rank: null,
    band: 1,
    enGloss: null,
    jaGloss: null,
    aspect: null,
    aspectPair: null,
    ...over,
  };
}

describe("buildWordBreakdown (LINGO-012 card-back word list)", () => {
  const wordById = new Map<number, DeckWord>([
    [1, word({ id: 1, lemma: "я", pos: "pron", enGloss: "I", jaGloss: "私" })],
    [2, word({ id: 2, lemma: "и", pos: "conj", enGloss: "and", jaGloss: "そして" })],
    [
      3,
      word({
        id: 3,
        lemma: "сказать",
        pos: "verb",
        enGloss: "say",
        jaGloss: "言う",
        aspect: "pf",
        aspectPair: "говорить",
      }),
    ],
    [4, word({ id: 4, lemma: "быть", pos: "verb", enGloss: "be", jaGloss: "である", aspect: "impf" })],
    [5, word({ id: 5, lemma: "дом", pos: "noun", enGloss: "house", jaGloss: "家", gender: "m" })],
  ]);

  it("sentence card: drops function words (pron/conj) that aren't the target, keeps content words", () => {
    const sentence = { kind: "sentence" as const, targetLemma: "дом", wordIds: [1, 2, 5] };
    const out = buildWordBreakdown(sentence, wordById);
    expect(out.map((e) => e.lemma)).toEqual(["дом"]); // я/и (pron/conj) dropped, дом (target, noun) kept
    expect(out[0].isTarget).toBe(true);
  });

  it("sentence card: always keeps the target word even if it's a function-word part of speech", () => {
    const sentence = { kind: "sentence" as const, targetLemma: "и", wordIds: [1, 2, 5] };
    const out = buildWordBreakdown(sentence, wordById);
    const lemmas = out.map((e) => e.lemma);
    expect(lemmas).toContain("и"); // target, kept despite pos=conj
    expect(lemmas).not.toContain("я"); // non-target pron, dropped
    expect(out[0].lemma).toBe("и"); // target sorts first
  });

  it("carries aspect + aspect pair formatted as 完了体/不完了体 with the paired lemma", () => {
    const sentence = { kind: "sentence" as const, targetLemma: "сказать", wordIds: [3, 4] };
    const out = buildWordBreakdown(sentence, wordById);
    const skazat = out.find((e) => e.lemma === "сказать")!;
    expect(skazat.aspect).toBe("pf");
    expect(skazat.aspectPair).toBe("говорить");
    const byt = out.find((e) => e.lemma === "быть")!;
    expect(byt.aspect).toBe("impf");
    expect(byt.aspectPair).toBeNull(); // быть has no true perfective partner
  });

  it("word card: keeps every linked entry, function words included (no target/support split)", () => {
    const sentence = { kind: "word" as const, targetLemma: null, wordIds: [1, 2] };
    const out = buildWordBreakdown(sentence, wordById);
    expect(out.map((e) => e.lemma).sort()).toEqual(["и", "я"]);
    expect(out.every((e) => e.isTarget)).toBe(false); // word cards have no targetLemma concept
  });

  it("silently skips wordIds that don't resolve to a deck word", () => {
    const sentence = { kind: "sentence" as const, targetLemma: "дом", wordIds: [5, 999] };
    expect(() => buildWordBreakdown(sentence, wordById)).not.toThrow();
    const out = buildWordBreakdown(sentence, wordById);
    expect(out.map((e) => e.lemma)).toEqual(["дом"]);
  });

  it("posLabel falls back to the raw pos code for unmapped values", () => {
    expect(posLabel("verb")).toBe("動詞");
    expect(posLabel("xyz")).toBe("xyz");
  });
});

describe("formatAspectLine (Katsuta 2026-08-27: label both head and pair)", () => {
  it("labels both the head verb and its pair, deriving the pair's aspect as the opposite", () => {
    expect(
      formatAspectLine({ lemma: "делать", aspect: "impf", aspectPair: "сделать" }),
    ).toBe("делать（不完了体） ⇔ 対: сделать（完了体）");
    expect(
      formatAspectLine({ lemma: "сказать", aspect: "pf", aspectPair: "говорить" }),
    ).toBe("сказать（完了体） ⇔ 対: говорить（不完了体）");
  });

  it("shows only the head verb's own labelled aspect when there is no pair", () => {
    expect(formatAspectLine({ lemma: "быть", aspect: "impf", aspectPair: null })).toBe(
      "быть（不完了体）",
    );
  });

  it("returns null for entries with no aspect (non-verbs)", () => {
    expect(formatAspectLine({ lemma: "дом", aspect: null, aspectPair: null })).toBeNull();
  });
});

describe("noun gender (LINGO-022 card-back breakdown)", () => {
  it("buildWordBreakdown carries the noun's gender through to the entry", () => {
    const wordById = new Map<number, DeckWord>([
      [5, word({ id: 5, lemma: "дом", pos: "noun", enGloss: "house", gender: "m" })],
    ]);
    const out = buildWordBreakdown(
      { kind: "sentence" as const, targetLemma: "дом", wordIds: [5] },
      wordById,
    );
    expect(out[0].gender).toBe("m");
  });

  it("formatGenderLine renders lemma（label） for each gender code", () => {
    expect(formatGenderLine({ lemma: "книга", gender: "f" })).toBe("книга（女性名詞）");
    expect(formatGenderLine({ lemma: "дом", gender: "m" })).toBe("дом（男性名詞）");
    expect(formatGenderLine({ lemma: "окно", gender: "n" })).toBe("окно（中性名詞）");
    expect(formatGenderLine({ lemma: "деньги", gender: "pl" })).toBe("деньги（複数のみ）");
    expect(formatGenderLine({ lemma: "коллега", gender: "mf" })).toBe("коллега（通性名詞）");
  });

  it("honours caller-provided (UI-language) labels", () => {
    const en = { m: "masculine noun", f: "feminine noun", n: "neuter noun", pl: "plural only", mf: "common gender" };
    expect(formatGenderLine({ lemma: "книга", gender: "f" }, en)).toBe("книга（feminine noun）");
  });

  it("returns null for entries with no gender (non-nouns)", () => {
    expect(formatGenderLine({ lemma: "делать", gender: null })).toBeNull();
  });
});
