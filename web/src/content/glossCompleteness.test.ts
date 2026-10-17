import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildDeck, validateGlossCompleteness, RU_DECK, EN_DECK, TH_DECK, JA_DECK } from "../../scripts/build-content.mjs";
import { buildWordBreakdown } from "../engine/wordBreakdown";
import { orderedGloss } from "../ui/FlashcardCard";

// LINGO-054: Katsuta reported that the word-breakdown for "Ты продал машину?"
// showed no English/Japanese translation for продать. Investigation (full
// corpus audit across all 4 courses + a direct test of the real
// buildDeck -> buildWordBreakdown -> orderedGloss chain, reproduced below)
// found BOTH the data and the rendering logic already correct as of this
// task — продать carries en_gloss="sell"/ja_gloss="売る" in
// pipeline/data/words_band1.jsonl, and the real resolution chain produces
// "sell / 売る" for Katsuta's own front=en/UI=ja configuration. The most
// likely explanation is a stale cached PWA bundle on his device (see
// LINGO-047/048's prior service-worker caching history) rather than a code
// bug — but the audit that chased it down found the project had NO
// build-time guarantee this stays true, so a future data-entry gap would
// ship silently. These two tests are the permanent guard:
//   1. validateGlossCompleteness() (now wired into buildDeck() itself, so
//      `npm run gen:content` fails loudly on any gap, not just `npm test`)
//      passes for the CURRENT data in every course — confirming the full
//      corpus has zero missing/empty/placeholder glosses in each course's
//      required languages.
//   2. The real rendering-path chain resolves продать's gloss correctly for
//      Katsuta's exact configuration, in sentence T0164 specifically — this
//      is the literal reproduction case, kept as a named regression test so
//      a future change to orderedGloss/buildWordBreakdown that reintroduces
//      a blank gloss fails immediately.
describe("word gloss completeness across every course (LINGO-054)", () => {
  it("every RU/EN/TH/JA deck word has a non-empty gloss in every language its own front can be set to", () => {
    // buildDeck() already calls validateGlossCompleteness() internally and
    // throws on any gap, so simply building every course without an
    // exception IS the test — but call it explicitly too, so a future
    // refactor that removes the internal call doesn't silently lose this
    // guarantee.
    for (const deckConfig of [RU_DECK, EN_DECK, TH_DECK, JA_DECK]) {
      const deck = buildDeck(deckConfig.dataDir, deckConfig);
      expect(() => validateGlossCompleteness(deck.words, deckConfig)).not.toThrow();
    }
  });

  it("rejects a word with a missing gloss (sanity check on the validator itself)", () => {
    const words = [{ lemma: "тест", id: 1, band: 1, enGloss: null, jaGloss: "テスト" }];
    expect(() =>
      validateGlossCompleteness(words, { courseId: "ru", availableFrontLangs: ["en", "ja"] }),
    ).toThrow(/missing enGloss/);
  });

  it("reproduces Katsuta's exact report (T0164 'Ты продал машину?', front=en/UI=ja): продать resolves to a non-empty gloss through the real rendering chain", () => {
    const deck = buildDeck(RU_DECK.dataDir, RU_DECK);
    const wordById = new Map<number, any>(deck.words.map((w: any) => [w.id, w]));
    const sentence = deck.sentences.find((s: any) => s.id === "T0164");
    expect(sentence).toBeTruthy();
    const breakdown = buildWordBreakdown(sentence, wordById);
    const prodat = breakdown.find((e) => e.lemma === "продать");
    expect(prodat).toBeTruthy();
    expect(prodat!.enGloss).toBe("sell");
    expect(prodat!.jaGloss).toBe("売る");
    const gloss = orderedGloss(prodat!, "en", "ja");
    expect(gloss).toBe("sell / 売る");
  });
});
