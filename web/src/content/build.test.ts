import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildDeck } from "../../scripts/build-content.mjs";

// Exercises the real pipeline data so the "band1 (+ imported if present)" glob
// and lemma linking stay correct as LINGO-009 adds sentences_imported*.jsonl.
describe("content build", () => {
  const deck = buildDeck();

  it("imports the band1 deck (>= 291 sentences, 1000 words)", () => {
    expect(deck.words.length).toBeGreaterThanOrEqual(1000);
    expect(deck.sentences.length).toBeGreaterThanOrEqual(291);
    expect(deck.bands).toContain(1);
  });

  it("links lemmas to word ids and computes a min covered rank", () => {
    const s1 = deck.sentences.find((s: any) => s.id === "s001");
    expect(s1).toBeTruthy();
    expect(s1.wordIds.length).toBeGreaterThan(0);
    expect(typeof s1.minRank).toBe("number");
    // "и"/"в"/"не" are rank 1-3; s001 covers "не" so minRank should be small.
    expect(s1.minRank).toBeLessThanOrEqual(10);
  });

  it("globs both band and imported sentence sources (imported optional)", () => {
    // At minimum the band1 file is present; imported may or may not exist yet.
    expect(deck._meta.sources.some((n: string) => /sentences_band1/.test(n))).toBe(true);
    // Every source matched the intended patterns.
    expect(
      deck._meta.sources.every((n: string) => /^sentences_(band\d+|imported)/.test(n)),
    ).toBe(true);
  });

  it("produces sentence rows shaped for the flashcard UI", () => {
    for (const s of deck.sentences.slice(0, 20)) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.ru).toBe("string");
      expect(typeof s.en).toBe("string");
      expect(["sentence", "word"]).toContain(s.kind);
    }
  });

  it("carries LINGO-011 target lemmas that resolve to deck words", () => {
    const targeted = deck.sentences.filter((s: any) => s.targetLemma);
    expect(targeted.length).toBeGreaterThan(0);
    const lemmas = new Set(deck.words.map((w: any) => w.lemma));
    // Every target lemma is a real deck word (so calibration/scoring can link it).
    for (const s of targeted.slice(0, 50)) expect(lemmas.has(s.targetLemma)).toBe(true);
  });
});
