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

  it("LINGO-013/LINGO-020/LINGO-043: loads exactly the 3000-word frame (bands 1-3, 1000 each) plus a band4 retired pool", () => {
    const byBand: Record<number, number> = {};
    for (const w of deck.words) byBand[w.band] = (byBand[w.band] ?? 0) + 1;
    // LINGO-043: band1-3 are now EXACTLY 1000/1000/1000 (Katsuta's repeated
    // "why 998, not 1000" — the LINGO-020 rebaseline left ~57 new-inflow
    // candidates dropped during cleanup and un-backfilled; LINGO-043
    // telescoped the resulting gaps closed — band1's 2-word shortfall filled
    // from band2's top, band2's resulting gap from band3's top, band3's from
    // the band4 retirement pool's top (by original candidate rank) — and
    // renumbered rank 1..3000 contiguously. band4 (old band1-3 words retired
    // by the LINGO-020 rebaseline, kept — not deleted — so existing learner
    // ReviewState/wordKnowledge still resolves) shrank by the 40 words
    // recovered into band3: 859 -> 819.
    // LINGO-049: a full-corpus pymorphy audit found 267 content-word tokens
    // (verb/noun/adj) present in RU sentence text but missing from their
    // sentence's own `lemmas` array (the exact bug class behind Katsuta's
    // "to spend time"/"to make money" report). Most were fixed by relinking
    // to existing Word rows; 65 verbs + 102 nouns + 40 adjectives (41
    // generated minus 1 duplicate of the already-registered "каков") were
    // genuinely new vocabulary, appended to words_band4.jsonl (band:4, no
    // rank, same retirement-pool convention): 819 + 207 = 1026.
    // LINGO-051: rebalancing the RU core sentences' subject-person
    // distribution (я/ты/вы/он/она/мы/они/no-subject/dative-experiencer, per
    // Katsuta's dating/cafe/small-talk conversation simulation) via 714
    // sentence rewrites surfaced another 38 missing-vocabulary words the
    // rewrites naturally reached for (verbs/nouns/adjectives/adverbs a real
    // conversation needs — свитер, тренировать, дружелюбно, etc.), same
    // Codex-generate + independently-verified + band4-append pipeline as
    // LINGO-049: 1026 + 38 = 1064.
    expect(byBand[1]).toBe(1000);
    expect(byBand[2]).toBe(1000);
    expect(byBand[3]).toBe(1000);
    expect(byBand[4]).toBe(1064);
    expect(deck.words.length).toBe(1000 + 1000 + 1000 + 1064);
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
    // Ranks span 1..3000 across bands 1-3, now fully contiguous (LINGO-043 —
    // no gaps); band4 words carry no rank (null).
    const rankedWords = deck.words.filter((w: any) => w.band <= 3);
    const ranks = rankedWords.map((w: any) => w.rank).sort((a: number, b: number) => a - b);
    expect(ranks[0]).toBe(1);
    expect(ranks[ranks.length - 1]).toBe(3000);
    expect(ranks.length).toBe(3000);
    for (let i = 0; i < ranks.length; i++) expect(ranks[i]).toBe(i + 1);
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
  // フォーカス". Only LINGO-011 core sentences (target_lemma set, id T####/B####) and
  // bare word cards shipped to the MAIN line; every other kind='sentence' source (the
  // original band1 handwritten set, imported notes, imported lessons) was dropped
  // entirely, even when short enough to have survived the length-only filter.
  //
  // LINGO-050/051 (2026-09-18, Katsuta-approved 純化プラン): that blanket drop was too
  // broad — the imported notes/lessons sentences are real, useful material, just not
  // part of the frequency-ranked core curriculum. They now ship as the optional
  // マイノート (My Notes) lane's pool (engine/content.ts's sentencePool() already
  // classifies any kind="sentence" row with no targetLemma as "notes"; this build
  // script previously never gave it anything to draw from). The OLD handwritten band1
  // corpus (origin "generated" — sentences_band1.jsonl, pre-LINGO-011 free-form
  // sentences this project moved away from) is intentionally NOT included — only the
  // "notes"/"lessons" origins (sentences_imported*.jsonl) count as マイノート material.
  describe("core + マイノート content restriction (LINGO-010/050/051)", () => {
    it("every kind='sentence' row is either a core T/B row (targetLemma set) or a マイノート notes/lessons row (targetLemma null); nothing else leaks through", () => {
      // LINGO-023: band2/3 inflow core sentences use B-prefixed ids
      // (B2001-B2286, B3001-B3462); the core identity is target_lemma != null,
      // carried by every T- and B- row and no other sentence source.
      const isCoreId = (id: string) => /^[TB]/.test(id);
      for (const s of deck.sentences) {
        if (s.kind !== "sentence") continue;
        if (isCoreId(s.id)) {
          expect(s.targetLemma).not.toBeNull();
        } else {
          // マイノート row: came from sentences_imported*.jsonl, never carries
          // a targetLemma (that's exactly what makes it "notes" not "core").
          expect(s.targetLemma).toBeNull();
        }
      }
      // The old handwritten band1 corpus ("s..." ids, origin "generated") must
      // never leak through even though it's also non-core — only "notes"/
      // "lessons" origin non-core rows are allowed to ship.
      const leakedGenerated = deck.sentences.filter(
        (s: any) => s.kind === "sentence" && !isCoreId(s.id) && /^s\d/.test(s.id),
      );
      expect(leakedGenerated).toEqual([]);
    });

    it("keeps exactly the core sentences (2135 post-LINGO-043) + マイノート notes/lessons rows + word cards", () => {
      // LINGO-020: 1000 original T#### core sentences, retagged across bands
      // 1-4 by their target_lemma's new band (stage4a), plus 71 new T1001+
      // sentences for genuinely-new band1 words with no prior core sentence
      // (stage4b) = 1071. See pipeline/rebaseline/retag_sentences.py.
      // LINGO-022: +315 T1072-T1386 core sentences for the promoted-into-band1
      // words that still lacked a target example = 1386.
      // LINGO-023: +748 B-prefixed core sentences for the band2/3 inflow words
      // that lacked a target example (band2 B2001-B2286 = 286, band3
      // B3001-B3462 = 462) = 2134.
      // LINGO-043: band normalization to exactly 1000/1000/1000 moved 2 words
      // from band2 into band1 (сложно, животное); животное already had a core
      // sentence (retagged into sentences_band1_core.jsonl), сложно did not —
      // +1 new T1387 = 2135. These ship in the deck but stay dormant at
      // runtime while PRIMARY_BAND is fixed at 1 (band progression = LINGO-024).
      // LINGO-050/051: マイノート pool = sentences_imported.jsonl's + sentences_
      // imported_lessons.jsonl's kind="sentence" rows with no target_lemma,
      // minus the ones over MAX_SENTENCE_TOKENS(8) = 604.
      const core = deck.sentences.filter((s: any) => s.kind === "sentence" && s.targetLemma != null);
      const notes = deck.sentences.filter((s: any) => s.kind === "sentence" && s.targetLemma == null);
      const words = deck.sentences.filter((s: any) => s.kind === "word");
      expect(core.length).toBe(2135);
      expect(notes.length).toBe(604);
      expect(deck.sentences.length).toBe(core.length + notes.length + words.length);
    });

    it("logs a real, categorised exclusion count (the old band1 handwritten corpus + over-length rows from any origin)", () => {
      const m = deck._meta.excluded;
      expect(m.total).toBeGreaterThan(0);
      expect(m.byReason.nonCore).toBeGreaterThan(0);
      // nonCore exclusions are now ONLY the old "generated"-origin handwritten
      // corpus (sentences_band1.jsonl, 291 non-core rows) — notes/lessons
      // non-core rows ship to the マイノート lane instead of being excluded.
      expect(m.byOrigin.generated).toBe(291);
      expect(m.byReason.nonCore).toBe(291);
      const originSum = m.byOrigin.generated + m.byOrigin.lessons + m.byOrigin.notes;
      expect(originSum).toBe(m.total);
    });
  });
});
