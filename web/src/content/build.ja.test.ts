import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildDeck, sourceSentenceRows, JA_DECK, TH_DECK, RU_DECK, EN_DECK } from "../../scripts/build-content.mjs";

// LINGO-044: Japanese course, for English and Russian speakers.
//
// Japanese shares Thai's "no spaces between words" problem but NOT its
// grammar: Japanese inflects, so a sentence is not the concatenation of its
// dictionary forms and cannot be assembled the way the Thai pack is. Instead
// the sentence text is written normally and a morphological analyser (UniDic
// via fugashi) derives the reading, the romanisation and the dictionary forms
// from it. Most of these tests pin the consequences of that split.
const JA_SCRIPT = /[ぁ-んァ-ヶー一-鿿々]/;
const KANA_ONLY = /^[ぁ-んー]+$/;
const CYRILLIC = /[Ѐ-ӿ]/;
/** Hepburn as this course writes it: ASCII letters, the apostrophe that
 * separates syllabic ん from a following vowel (kin'en), hyphens and spaces. */
const ROMAJI = /^[a-z' -]+$/;

/** How many band1 core sentences the pack ships. Pinned so a lost generation
 * block fails the build instead of silently shrinking the deck. */
const SHIPPED_SENTENCES = 1000;

describe("JA course content build", () => {
  const deck = buildDeck(JA_DECK.dataDir, JA_DECK);

  it("carries the JA course config (targetLang=ja, fronts=en/ru, no ja front)", () => {
    expect(deck.courseId).toBe("ja");
    expect(deck.targetLang).toBe("ja");
    expect(deck.availableFrontLangs).toEqual(["en", "ru"]);
    expect(deck.defaultFrontLang).toBe("en");
    // A course never offers its own target as a prompt language.
    expect(deck.availableFrontLangs).not.toContain("ja");
    expect(deck.grammarMeta).toBe("conjugation");
  });

  it("imports 3000 words (band1-3) and the shipped band1 core sentences", () => {
    expect(deck.words.length).toBe(3000);
    expect(deck.sentences.length).toBe(SHIPPED_SENTENCES);
    expect(deck.bands).toEqual([1]);
  });

  it("every word is Japanese, with a rank, band and whitelisted pos", () => {
    const POS = new Set([
      "noun", "verb", "adj", "adv", "pron", "det", "conj", "part", "intj",
    ]);
    const ranks = new Set<number>();
    for (const w of deck.words) {
      expect(JA_SCRIPT.test(w.lemma), `${w.lemma} is not Japanese`).toBe(true);
      expect(POS.has(w.pos), `${w.lemma}: unexpected pos ${w.pos}`).toBe(true);
      expect([1, 2, 3]).toContain(w.band);
      expect(ranks.has(w.rank), `duplicate rank ${w.rank}`).toBe(false);
      ranks.add(w.rank);
    }
    expect(Math.min(...ranks)).toBe(1);
    expect(Math.max(...ranks)).toBe(3000);
    for (const w of deck.words) {
      expect(w.band).toBe(w.rank <= 1000 ? 1 : w.rank <= 2000 ? 2 : 3);
    }
  });

  it("every word carries a reading and a romanisation — the course is unusable without them", () => {
    // Japanese is the extreme case of the rule the Thai course established:
    // a learner cannot derive the reading of a kanji word from its script, so
    // a word whose reading we could not verify is not shipped at all.
    for (const w of deck.words) {
      expect(typeof w.kana, `${w.lemma} has no kana`).toBe("string");
      expect(w.kana.length).toBeGreaterThan(0);
      if (w.kana.includes(" / ")) {
        // kanji-containing word: "furigana / romaji"
        const [reading, romaji] = w.kana.split(" / ");
        expect(KANA_ONLY.test(reading), `${w.lemma}: furigana not kana: ${reading}`).toBe(true);
        expect(ROMAJI.test(romaji), `${w.lemma}: romaji not Hepburn: ${romaji}`).toBe(true);
      } else {
        // already-kana headword: the furigana would just repeat it, so the
        // field is the romanisation alone.
        expect(ROMAJI.test(w.kana), `${w.lemma}: romaji not Hepburn: ${w.kana}`).toBe(true);
        expect(KANA_ONLY.test(w.lemma) || /[ァ-ヶー]/.test(w.lemma)).toBe(true);
      }
    }
  });

  it("romanises the particles by sound, not by spelling", () => {
    // は/へ/を are written one way and read another; getting this wrong would
    // teach a learner to say "ha" for the topic marker.
    const byLemma = new Map(deck.words.map((w: any) => [w.lemma, w.kana]));
    expect(byLemma.get("は")).toBe("wa");
    expect(byLemma.get("へ")).toBe("e");
    expect(byLemma.get("を")).toBe("o");
    // ...and the same applies inside the fixed greetings
    expect(byLemma.get("こんにちは")).toBe("konnichiwa");
    expect(byLemma.get("こんばんは")).toBe("konbanwa");
    // long vowels stay faithful to the spelling (modified Hepburn), so
    // 先生 is sensei and not "sensē"
    expect(byLemma.get("先生")).toBe("せんせい / sensei");
    expect(byLemma.get("私")).toBe("わたし / watashi");
  });

  it("every word has en/ru glosses and no jaGloss (the word IS the Japanese)", () => {
    for (const w of deck.words) {
      expect(typeof w.enGloss, `${w.lemma} has no enGloss`).toBe("string");
      expect(w.enGloss.length).toBeGreaterThan(0);
      expect(JA_SCRIPT.test(w.enGloss), `${w.lemma}: Japanese in enGloss`).toBe(false);
      expect(typeof w.ruGloss, `${w.lemma} has no ruGloss`).toBe("string");
      expect(CYRILLIC.test(w.ruGloss), `${w.lemma}: ruGloss is not Russian`).toBe(true);
      expect(JA_SCRIPT.test(w.ruGloss), `${w.lemma}: Japanese in ruGloss`).toBe(false);
      expect(w.jaGloss).toBeNull();
    }
  });

  it("carries no RU/TH grammar metadata (Japanese has no aspect, gender or case)", () => {
    for (const w of deck.words) {
      expect(w.aspect).toBeNull();
      expect(w.aspectPair).toBeNull();
      expect(w.pairKind).toBeNull();
      expect(w.gender).toBeNull();
    }
    for (const s of deck.sentences) expect(s.forms).toEqual([]);
  });

  const sourceRows: any[] = sourceSentenceRows(JA_DECK.dataDir);

  it("every sentence's reading and lemmas were derived from the sentence itself", () => {
    expect(sourceRows.length).toBe(SHIPPED_SENTENCES);
    for (const s of sourceRows) {
      // kana is "furigana / romaji", both produced by the analyser
      expect(s.kana).toContain(" / ");
      const [reading, romaji] = s.kana.split(" / ");
      expect(KANA_ONLY.test(reading), `${s.id}: reading is not kana: ${reading}`).toBe(true);
      expect(ROMAJI.test(romaji), `${s.id}: romaji is not Hepburn: ${romaji}`).toBe(true);
      // the reading is the concatenation of the per-token readings, so it has
      // no spaces, while the romaji is space-separated per token
      expect(reading).not.toContain(" ");
      // One romaji chunk per READING token. That is >= lemmas.length, not
      // equal to it: inflectional auxiliaries (the ぬ of 飲みません, the て of
      // 働いています) are pronounced, so they are in the reading, but they are
      // conjugation rather than vocabulary so they are not lemmas.
      expect(romaji.split(" ").length).toBeGreaterThanOrEqual(s.lemmas.length);
      expect(s.lemmas.length).toBeGreaterThanOrEqual(3);
      expect(s.lemmas.length).toBeLessThanOrEqual(8);
    }
  });

  it("no sentence uses a word outside the deck", () => {
    // The Thai pack got this for free (its text was built FROM the vocabulary);
    // here the text is written freely, so the assembler enforces it and this
    // pins the result.
    const lemmas = new Set(deck.words.map((w: any) => w.lemma));
    const offenders: string[] = [];
    for (const s of sourceRows) {
      for (const l of s.lemmas) if (!lemmas.has(l)) offenders.push(`${s.id}:${l}`);
    }
    expect(offenders.slice(0, 10)).toEqual([]);
  });

  it("counts tokenCount from lemmas, not from whitespace (Japanese has none)", () => {
    for (const s of deck.sentences) {
      expect(typeof s.tokenCount).toBe("number");
      expect(s.tokenCount).toBeGreaterThanOrEqual(3);
      expect(s.tokenCount).toBeLessThanOrEqual(8);
      expect(
        s.tokenCount,
        `${s.id}: tokenCount ${s.tokenCount} < linked words ${s.wordIds.length}`,
      ).toBeGreaterThanOrEqual(s.wordIds.length);
    }
  });

  it("every sentence has en + ru translations and a target lemma in the deck", () => {
    const lemmas = new Set(deck.words.map((w: any) => w.lemma));
    for (const s of deck.sentences) {
      expect(JA_SCRIPT.test(s.ja), `${s.id}: ja is not Japanese`).toBe(true);
      expect(s.en.length).toBeGreaterThan(0);
      expect(JA_SCRIPT.test(s.en), `${s.id}: Japanese in en`).toBe(false);
      expect(CYRILLIC.test(s.ru), `${s.id}: ru is not Russian`).toBe(true);
      expect(JA_SCRIPT.test(s.ru), `${s.id}: Japanese in ru`).toBe(false);
      expect(lemmas.has(s.targetLemma), `${s.id}: target not a deck word`).toBe(true);
      expect(s.wordIds.length).toBeGreaterThan(0);
    }
  });

  it("each sentence targets a distinct band1 word, id number == that word's rank", () => {
    const band1 = deck.words.filter((w: any) => w.band === 1);
    const rankByLemma = new Map(band1.map((w: any) => [w.lemma, w.rank]));
    const targets = new Set<string>();
    for (const s of deck.sentences) {
      expect(targets.has(s.targetLemma), `${s.targetLemma} targeted twice`).toBe(false);
      targets.add(s.targetLemma);
      expect(s.id).toMatch(/^JA\d{4}$/);
      expect(parseInt(s.id.slice(2), 10)).toBe(rankByLemma.get(s.targetLemma));
    }
  });

  it("has no duplicate sentence ids or duplicate sentences", () => {
    const ids = deck.sentences.map((s: any) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = deck.sentences.map((s: any) => s.ja);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("notes are either absent or fully three-language (ja + en + ru)", () => {
    for (const s of deck.sentences) {
      const present = [s.note, s.noteEn, s.noteRu].map((n: any) => !!n);
      if (present.some(Boolean)) {
        expect(present, `${s.id}: partially translated note`).toEqual([true, true, true]);
        expect(JA_SCRIPT.test(s.note)).toBe(true);
        // The English and Russian notes must be WRITTEN IN those languages,
        // but they are grammar explanations and may quote Japanese — "付く is
        // a godan verb; its ます-form is 付きます" is exactly what a useful note
        // looks like. So assert the prose language is present rather than
        // banning the cited Japanese.
        expect(/[A-Za-z]/.test(s.noteEn), `${s.id}: noteEn is not English prose`).toBe(true);
        expect(CYRILLIC.test(s.noteRu), `${s.id}: noteRu is not Russian`).toBe(true);
      }
    }
    expect(deck.sentences.filter((s: any) => s.note).length).toBeGreaterThan(0);
  });

  it("does not disturb the RU/EN/TH packs", () => {
    for (const cfg of [RU_DECK, EN_DECK, TH_DECK]) {
      const d = buildDeck(cfg.dataDir, cfg);
      expect(d.words.length).toBeGreaterThan(0);
      expect(d.courseId).not.toBe("ja");
    }
  });
});
