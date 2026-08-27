import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildDeck, EN_DECK } from "../../scripts/build-content.mjs";

// LINGO-015 (Phase B): NGSL-based English course. Exercises the real
// pipeline/courses/en data so band1 (1000 words + 1000 core sentences) and
// the ja/ru gloss + word-breakdown wiring stay correct as later bands land.
describe("EN course content build", () => {
  const deck = buildDeck(EN_DECK.dataDir, EN_DECK);

  it("carries the EN course config (targetLang=en, fronts=ja/ru)", () => {
    expect(deck.courseId).toBe("en");
    expect(deck.targetLang).toBe("en");
    expect(deck.availableFrontLangs).toEqual(["ja", "ru"]);
    expect(deck.defaultFrontLang).toBe("ja");
  });

  it("imports 3000 NGSL words (band1-3) and 1000 band1 core sentences", () => {
    expect(deck.words.length).toBe(3000);
    expect(deck.sentences.length).toBe(1000);
    expect(deck.bands).toEqual([1]); // only band1 has sentences so far
  });

  it("links lemmas to word ids and computes a min covered rank", () => {
    const s1 = deck.sentences.find((s: any) => s.id === "E0001");
    expect(s1).toBeTruthy();
    expect(s1.wordIds.length).toBeGreaterThan(0);
    expect(typeof s1.minRank).toBe("number");
    expect(s1.minRank).toBeLessThanOrEqual(10);
  });

  it("carries target lemmas that resolve to real deck words", () => {
    const targeted = deck.sentences.filter((s: any) => s.targetLemma);
    expect(targeted.length).toBe(1000);
    const lemmas = new Set(deck.words.map((w: any) => w.lemma));
    for (const s of targeted.slice(0, 50)) expect(lemmas.has(s.targetLemma)).toBe(true);
  });

  it("every band1 word is covered by at least one sentence (target-word-driven generation)", () => {
    const band1 = deck.words.filter((w: any) => w.band === 1);
    const coveredIds = new Set<number>();
    for (const s of deck.sentences) for (const wid of s.wordIds) coveredIds.add(wid);
    const uncovered = band1.filter((w: any) => !coveredIds.has(w.id));
    expect(uncovered).toEqual([]);
  });

  it("every word has jaGloss/ruGloss populated but no enGloss (the word IS the English text)", () => {
    for (const w of deck.words) {
      expect(w.enGloss).toBeNull();
      expect(typeof w.jaGloss).toBe("string");
      expect(w.jaGloss.length).toBeGreaterThan(0);
      expect(typeof w.ruGloss).toBe("string");
      expect(w.ruGloss.length).toBeGreaterThan(0);
    }
  });

  it("computes a real EN content-word tokenCount (not the RU field) for every sentence", () => {
    for (const s of deck.sentences) {
      expect(typeof s.tokenCount).toBe("number");
      expect(s.tokenCount).toBeGreaterThanOrEqual(s.wordIds.length);
      expect(s.tokenCount).toBeGreaterThanOrEqual(3);
      expect(s.tokenCount).toBeLessThanOrEqual(8);
    }
  });

  it("marks irregular-verb targets with a 'base-past-participle' note", () => {
    const withNote = deck.sentences.filter((s: any) => s.note);
    expect(withNote.length).toBeGreaterThan(0);
    const goSentence = deck.sentences.find((s: any) => s.targetLemma === "go");
    expect(goSentence.note).toBe("go-went-gone");
  });

  it("has no duplicate sentence ids and every id is E####", () => {
    const ids = deck.sentences.map((s: any) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^E\d{4}$/);
  });
});
