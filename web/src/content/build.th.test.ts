import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildDeck, sourceSentenceRows, TH_DECK, RU_DECK, EN_DECK } from "../../scripts/build-content.mjs";

// LINGO-039: Thai course. Exercises the real pipeline/courses/th data.
//
// Thai breaks two assumptions the RU/EN courses were built on, and most of
// these tests exist to pin the consequences:
//   1. Thai is written with NO SPACES between words, so the target text
//      cannot be tokenised by whitespace — `lemmas` is the authoritative
//      segmentation and build-content counts it for tokenCount.
//   2. Thai spelling does not tell a beginner the tone, so the Paiboon
//      transcription in `kana` is load-bearing content, not a nice-to-have:
//      a word or sentence without it is unusable.
const THAI_SCRIPT = /^[฀-๿]+$/;
const JA_SCRIPT = /[぀-ヿ一-鿿]/;
const CYRILLIC = /[Ѐ-ӿ]/;
/** Paiboon as this course writes it: plain Latin letters, the open-vowel
 * symbols ɔ ɛ ʉ ə, the five tone-marked vowel forms (both precomposed —
 * à á â ǎ, which is what Wiktionary actually emits — and as base + combining
 * accent), hyphens joining syllables inside a word, and spaces between words
 * in a sentence-level transcription. Deliberately an allowlist: anything
 * outside it (Thai script, katakana, a stray IPA symbol) is a data fault. */
const PAIBOON =
  /^[a-zɔɛʉəàáâǎèéêěìíîǐòóôǒùúûǔ̀́̂̌̃̄ -]+$/;

/** How many band1 core sentences the pack currently ships.
 *
 * Sentence generation is per-target-word and was produced in rank blocks, so
 * this is a coverage figure that grows as later blocks land — it is NOT
 * necessarily 1000. Pinned here so the number can only change deliberately:
 * a drop means a generation block was lost, which is exactly the regression
 * worth failing on. The band1 words that DO have a sentence are checked
 * exhaustively below (unique target, id number == target rank). */
const SHIPPED_SENTENCES = 600;

describe("TH course content build", () => {
  const deck = buildDeck(TH_DECK.dataDir, TH_DECK);

  it("carries the TH course config (targetLang=th, fronts=ja/en, no ru)", () => {
    expect(deck.courseId).toBe("th");
    expect(deck.targetLang).toBe("th");
    // Deliberately not "ru": the pack ships no Russian glosses, and offering
    // a front language the data can't serve is the LINGO-037 leak class.
    expect(deck.availableFrontLangs).toEqual(["ja", "en"]);
    expect(deck.defaultFrontLang).toBe("ja");
    // Thai has no conjugation, declension, gender or aspect — the grammar
    // slot names the one thing it DOES need instead.
    expect(deck.grammarMeta).toBe("classifier");
  });

  it("imports 3000 words (band1-3) and the shipped band1 core sentences", () => {
    expect(deck.words.length).toBe(3000);
    expect(deck.sentences.length).toBe(SHIPPED_SENTENCES);
    expect(deck.bands).toEqual([1]); // only band1 has sentences
  });

  it("every word is plain Thai script with a rank, band and whitelisted pos", () => {
    const POS = new Set([
      "noun", "verb", "adj", "adv", "pron", "det", "prep",
      "conj", "part", "num", "intj", "classifier",
    ]);
    const ranks = new Set<number>();
    for (const w of deck.words) {
      expect(w.lemma, `${w.lemma} is not plain Thai`).toMatch(THAI_SCRIPT);
      expect(POS.has(w.pos), `${w.lemma}: unexpected pos ${w.pos}`).toBe(true);
      expect([1, 2, 3]).toContain(w.band);
      expect(typeof w.rank).toBe("number");
      expect(ranks.has(w.rank), `duplicate rank ${w.rank}`).toBe(false);
      ranks.add(w.rank);
    }
    // ranks are a contiguous 1..3000, band1 = 1..1000
    expect(Math.min(...ranks)).toBe(1);
    expect(Math.max(...ranks)).toBe(3000);
    for (const w of deck.words) {
      expect(w.band).toBe(w.rank <= 1000 ? 1 : w.rank <= 2000 ? 2 : 3);
    }
  });

  it("every word has a Paiboon transcription in kana — the course is unusable without it", () => {
    for (const w of deck.words) {
      expect(typeof w.kana, `${w.lemma} has no kana`).toBe("string");
      expect(w.kana.length).toBeGreaterThan(0);
      expect(w.kana, `${w.lemma}: kana is not Paiboon: ${w.kana}`).toMatch(PAIBOON);
      // The transcription must not be Thai script or Japanese — the whole
      // point is that it is readable without knowing either.
      expect(JA_SCRIPT.test(w.kana)).toBe(false);
    }
  });

  it("writes aspirated stops as kh/ph/th, never bare k/p/t syllable-initially", () => {
    // The Paiboon convention this course adopts (Katsuta's own example
    // "khràp"): aspirated = kh/ph/th, unaspirated = g/bp/dt. Wiktionary's
    // module emits the older bare k/p/t for the aspirated series, so this
    // pins the rewrite — a regression would silently teach the wrong phoneme.
    const byLemma = new Map(deck.words.map((w: any) => [w.lemma, w.kana]));
    expect(byLemma.get("ครับ")).toBe("khráp");
    expect(byLemma.get("ขอบคุณ")).toBe("khɔ̀ɔp-khun");
    expect(byLemma.get("สวัสดี")).toBe("sà-wàt-dii");
    expect(byLemma.get("ไป")).toBe("bpai"); // unaspirated ป stays bp
    for (const w of deck.words) {
      for (const syl of w.kana.split(/[- ]/)) {
        expect(
          /^(?!bp|dt)[ptk][^h]/.test(syl) || /^(?!bp|dt)[ptk]$/.test(syl),
          `${w.lemma}: syllable "${syl}" has an unexpanded aspirated stop`,
        ).toBe(false);
      }
    }
  });

  it("every word has ja/en glosses and no ruGloss (fronts are ja/en only)", () => {
    for (const w of deck.words) {
      expect(typeof w.jaGloss, `${w.lemma} has no jaGloss`).toBe("string");
      expect(w.jaGloss.length).toBeGreaterThan(0);
      expect(JA_SCRIPT.test(w.jaGloss), `${w.lemma}: jaGloss is not Japanese`).toBe(true);
      expect(typeof w.enGloss, `${w.lemma} has no enGloss`).toBe("string");
      expect(w.enGloss.length).toBeGreaterThan(0);
      expect(JA_SCRIPT.test(w.enGloss), `${w.lemma}: Japanese in enGloss`).toBe(false);
      expect(w.ruGloss).toBeNull();
      // No Thai script inside a gloss — that would just repeat the headword.
      expect(/[฀-๿]/.test(w.jaGloss + w.enGloss)).toBe(false);
    }
  });

  it("carries no RU/EN grammar metadata (Thai has no aspect, gender or case)", () => {
    for (const w of deck.words) {
      expect(w.aspect).toBeNull();
      expect(w.aspectPair).toBeNull();
      expect(w.pairKind).toBeNull();
      expect(w.gender).toBeNull();
    }
    for (const s of deck.sentences) expect(s.forms).toEqual([]);
  });

  // The deck carries linked `wordIds`, not the raw `lemmas` array, so the two
  // structural invariants below are checked against the source JSONL — which
  // is also where a regression would actually be introduced.
  const sourceRows: any[] = sourceSentenceRows(TH_DECK.dataDir);

  it("sentence Thai text is exactly the concatenation of its lemmas", () => {
    // Thai is isolating: a word has one written form regardless of tense,
    // number or person, so the sentence surface text IS its dictionary forms
    // run together. The assembler computes `th` this way rather than having it
    // generated, which is what makes the transcription below trustworthy —
    // and it means an off-vocabulary word cannot appear in the text at all.
    expect(sourceRows.length).toBe(SHIPPED_SENTENCES);
    for (const s of sourceRows) {
      expect(s.th, `${s.id}: th is not its lemmas concatenated`).toBe(s.lemmas.join(""));
      expect(s.th, `${s.id}: displayed Thai must stay unspaced`).toMatch(THAI_SCRIPT);
      expect(s.lemmas.length).toBeGreaterThanOrEqual(3);
      expect(s.lemmas.length).toBeLessThanOrEqual(7);
    }
  });

  it("sentence kana is the space-joined transcription of its own words", () => {
    const kanaByLemma = new Map<string, string>(
      deck.words.map((w: any) => [w.lemma, w.kana]),
    );
    // A word's own transcription never contains a space (syllables inside a
    // word are hyphen-joined), so splitting a sentence's kana on spaces
    // recovers exactly one chunk per word.
    for (const w of deck.words) expect(w.kana).not.toContain(" ");
    for (const s of sourceRows) {
      expect(s.kana).toBe(s.lemmas.map((l: string) => kanaByLemma.get(l)).join(" "));
    }
  });

  it("counts tokenCount from lemmas, not from whitespace (Thai has none)", () => {
    // The regression this guards: tokenizeCount() on unspaced Thai returns 1
    // for a whole clause, which would make tokenCount < wordIds.length and
    // tell calibration every Thai sentence has zero unjudged words.
    for (const s of deck.sentences) {
      expect(typeof s.tokenCount).toBe("number");
      expect(s.tokenCount).toBeGreaterThanOrEqual(3);
      expect(s.tokenCount).toBeLessThanOrEqual(7);
      expect(
        s.tokenCount,
        `${s.id}: tokenCount ${s.tokenCount} < linked words ${s.wordIds.length}`,
      ).toBeGreaterThanOrEqual(s.wordIds.length);
    }
  });

  it("every sentence has ja + en translations, target lemma and linked words", () => {
    const lemmas = new Set(deck.words.map((w: any) => w.lemma));
    for (const s of deck.sentences) {
      expect(s.ja && JA_SCRIPT.test(s.ja), `${s.id}: ja missing/not Japanese`).toBe(true);
      expect(typeof s.en).toBe("string");
      expect(s.en.length).toBeGreaterThan(0);
      expect(lemmas.has(s.targetLemma), `${s.id}: target ${s.targetLemma} not a deck word`).toBe(true);
      expect(s.wordIds.length).toBeGreaterThan(0);
      expect(typeof s.minRank).toBe("number");
    }
  });

  it("each sentence targets a distinct band1 word, with id number == that word's rank", () => {
    const band1 = deck.words.filter((w: any) => w.band === 1);
    expect(band1.length).toBe(1000);
    const rankByLemma = new Map(band1.map((w: any) => [w.lemma, w.rank]));
    const targets = new Map<string, string>();
    for (const s of deck.sentences) {
      expect(targets.has(s.targetLemma), `${s.targetLemma} targeted twice`).toBe(false);
      targets.set(s.targetLemma, s.id);
      expect(s.id).toMatch(/^TH\d{4}$/);
      // id number == target rank is what makes coverage auditable at a glance
      // and keeps ids stable as later rank blocks are added.
      expect(
        parseInt(s.id.slice(2), 10),
        `${s.id}: id number does not match ${s.targetLemma}'s rank`,
      ).toBe(rankByLemma.get(s.targetLemma));
    }
    expect(targets.size).toBe(deck.sentences.length);
  });

  it("covers the travel-critical vocabulary a traveller needs first", () => {
    // The point of the whole course: these are the words that raw corpus rank
    // would have buried (สวัสดี is TNC #2831, ห้องน้ำ #1925, เผ็ด #4884) and
    // that a trip depends on. Whatever else is or isn't covered, these are.
    const targeted = new Set(deck.sentences.map((s: any) => s.targetLemma));
    const mustHave = [
      "สวัสดี", "ครับ", "ขอบคุณ", "ขอโทษ", "ผม", "ขอ", "ไม่",
      "ได้", "เท่าไหร่", "แพง", "อร่อย", "เผ็ด", "ข้าว", "น้ำ", "กิน",
    ];
    const missing = mustHave.filter((w) => !targeted.has(w));
    expect(missing, `travel-critical words with no sentence: ${missing}`).toEqual([]);
  });

  it("has no duplicate sentence ids or duplicate Thai text", () => {
    const ids = deck.sentences.map((s: any) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = deck.sentences.map((s: any) => s.th);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("notes are either absent or fully three-language (ja + en + ru)", () => {
    // The TH course can be taken with a ru UI, so a half-translated note
    // either leaks Japanese or silently vanishes (LINGO-037 finding #4).
    for (const s of deck.sentences) {
      const present = [s.note, s.noteEn, s.noteRu].map((n: any) => !!n);
      if (present.some(Boolean)) {
        expect(present, `${s.id}: partially translated note`).toEqual([true, true, true]);
        expect(JA_SCRIPT.test(s.note), `${s.id}: ja note slot is not Japanese`).toBe(true);
        expect(JA_SCRIPT.test(s.noteEn), `${s.id}: Japanese in noteEn`).toBe(false);
        expect(CYRILLIC.test(s.noteRu), `${s.id}: noteRu is not Russian`).toBe(true);
      }
    }
    // The classifier/tone/word-order guidance the course promised must exist.
    expect(deck.sentences.filter((s: any) => s.note).length).toBeGreaterThan(0);
  });

  it("does not disturb the RU/EN packs (they gain only always-null th/kana keys)", () => {
    for (const cfg of [RU_DECK, EN_DECK]) {
      const d = buildDeck(cfg.dataDir, cfg);
      for (const s of d.sentences) expect(s.th).toBeNull();
      for (const w of d.words) expect(w.kana).toBeNull();
    }
  });
});
