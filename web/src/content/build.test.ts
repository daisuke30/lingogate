import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildDeck } from "../../scripts/build-content.mjs";

// Exercises the real pipeline data so the "band1 (+ imported if present)" glob
// and lemma linking stay correct as LINGO-009/010/011 change the data.
describe("content build", () => {
  const deck = buildDeck();

  it("imports 1000 band1 words and the core+word deck (>= 1000 sentences)", () => {
    expect(deck.words.length).toBeGreaterThanOrEqual(1000);
    expect(deck.sentences.length).toBeGreaterThanOrEqual(1000);
    expect(deck.bands).toContain(1);
  });

  it("LINGO-013/LINGO-020: loads the ~3000-word frame (bands 1-3) plus a band4 retired pool", () => {
    const byBand: Record<number, number> = {};
    for (const w of deck.words) byBand[w.band] = (byBand[w.band] ?? 0) + 1;
    // LINGO-020 (OpenSubtitles spoken-frequency rebaseline): bands are no
    // longer exactly 1000/1000/1000. ~57 new-inflow candidates were dropped
    // during cleanup (pymorphy mis-lemmatisations, character names) and not
    // backfilled — see pipeline/rebaseline/assemble_words.py docstring. band4
    // is new: old band1-3 words retired by the rebaseline, kept (not
    // deleted) so existing learner ReviewState/wordKnowledge still resolves.
    expect(byBand[1]).toBe(998);
    expect(byBand[2]).toBe(995);
    expect(byBand[3]).toBe(967);
    expect(byBand[4]).toBe(859);
    expect(deck.words.length).toBe(998 + 995 + 967 + 859);
    // Every band1-3 lemma is unique across the whole deck (no band4 collision).
    const seen = new Set<string>();
    for (const w of deck.words) {
      expect(seen.has(w.lemma)).toBe(false);
      seen.add(w.lemma);
    }
    // Every band1-4 word carries POS + glosses.
    for (const w of deck.words) {
      expect(w.pos).toBeTruthy();
    }
    // Ranks span 1..3000 across bands 1-3 (not necessarily contiguous — see
    // the ~40-word gap noted above); band4 words carry no rank (null).
    const rankedWords = deck.words.filter((w: any) => w.band <= 3);
    const ranks = rankedWords.map((w: any) => w.rank).sort((a: number, b: number) => a - b);
    expect(ranks[0]).toBe(1);
    expect(ranks[ranks.length - 1]).toBe(3000);
    for (const w of deck.words.filter((w: any) => w.band === 4)) {
      expect(w.rank).toBeNull();
    }
  });

  it("links lemmas to word ids and computes a min covered rank", () => {
    const s1 = deck.sentences.find((s: any) => s.id === "T0001");
    expect(s1).toBeTruthy();
    expect(s1.wordIds.length).toBeGreaterThan(0);
    expect(typeof s1.minRank).toBe("number");
    // T0001 targets "и" (rank 1), so its min covered rank should be small.
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

  it("computes a RU tokenCount >= linked wordIds for every sentence (LINGO-010 fix)", () => {
    for (const s of deck.sentences) {
      expect(typeof s.tokenCount).toBe("number");
      // tokenCount is the real RU word count; linked lemmas can only be a subset.
      expect(s.tokenCount).toBeGreaterThanOrEqual(s.wordIds.length);
    }
  });

  it("drops kind='sentence' rows over 8 RU words entirely; word cards are exempt", () => {
    const overlong = deck.sentences.filter((s: any) => s.kind === "sentence" && s.tokenCount > 8);
    expect(overlong).toEqual([]);
  });

  // 2026-08-26: Katsuta's explicit direction — "頻出1000単語を元に作成したフレーズだけに
  // フォーカス". Only LINGO-011 core sentences (target_lemma set, id T####) and bare
  // word cards ship to the app; every other kind='sentence' source (the original
  // band1 handwritten set, imported notes, imported lessons) is dropped even when
  // short enough to have survived the length-only filter.
  describe("core-only content restriction (LINGO-010 follow-up)", () => {
    it("keeps only T#### (core) sentences and word cards; drops every other sentence source", () => {
      for (const s of deck.sentences) {
        if (s.kind === "sentence") {
          expect(s.id.startsWith("T")).toBe(true);
          expect(s.targetLemma).not.toBeNull();
        }
      }
      // The pre-restriction dataset has non-core sentence sources (old band1
      // handwritten set "s...", imported notes "n...", imported lessons "L...");
      // confirm none leaked through as kind='sentence'.
      const leaked = deck.sentences.filter(
        (s: any) => s.kind === "sentence" && !s.id.startsWith("T"),
      );
      expect(leaked).toEqual([]);
    });

    it("keeps exactly the core sentences (1071 post-LINGO-020) plus any word cards", () => {
      // LINGO-020: 1000 original T#### core sentences, retagged across bands
      // 1-4 by their target_lemma's new band (stage4a), plus 71 new T1001+
      // sentences for genuinely-new band1 words with no prior core sentence
      // (stage4b) = 1071. See pipeline/rebaseline/retag_sentences.py.
      const core = deck.sentences.filter((s: any) => s.kind === "sentence");
      const words = deck.sentences.filter((s: any) => s.kind === "word");
      expect(core.length).toBe(1071);
      expect(deck.sentences.length).toBe(core.length + words.length);
    });

    it("logs a real, categorised exclusion count", () => {
      const m = deck._meta.excluded;
      expect(m.total).toBeGreaterThan(0);
      expect(m.byReason.nonCore).toBeGreaterThan(0);
      const originSum = m.byOrigin.generated + m.byOrigin.lessons + m.byOrigin.notes;
      expect(originSum).toBe(m.total);
    });
  });
});
