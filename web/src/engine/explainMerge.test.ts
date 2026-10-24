import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildWordChunk, buildSentenceChunk } from "../../scripts/build-explain.mjs";
import { mergeGlossLanguage, resolveExplainLangs } from "./explainMerge";

// Katsuta learns words in English and grammar in Japanese, so the sheet reads
// from two chunks at once. The merge is structural — "every key named gloss" —
// rather than a list of field paths, so these tests pin that property, not a
// snapshot of today's schema.

describe("mergeGlossLanguage", () => {
  it("takes prose from one side and gloss from the other", () => {
    const ja = { note: "対格", example: { ru: "Я проверил почту.", gloss: "メールを確認した。" } };
    const en = { note: "accusative", example: { ru: "Я проверил почту.", gloss: "I checked my mail." } };
    expect(mergeGlossLanguage(ja, en)).toEqual({
      note: "対格", // prose stays Japanese
      example: { ru: "Я проверил почту.", gloss: "I checked my mail." }, // translation is English
    });
  });

  it("reaches gloss fields at any depth, including inside arrays", () => {
    const ja = {
      replies: [{ ru: "Да.", gloss: "うん。" }, { ru: "Нет.", gloss: "いや。" }],
      aspectExamples: [{ lemma: "проверять", examples: [{ ru: "Я проверяю.", gloss: "確認する。" }] }],
    };
    const en = {
      replies: [{ ru: "Да.", gloss: "Yes." }, { ru: "Нет.", gloss: "No." }],
      aspectExamples: [{ lemma: "проверять", examples: [{ ru: "Я проверяю.", gloss: "I check." }] }],
    };
    const merged = mergeGlossLanguage(ja, en) as typeof ja;
    expect(merged.replies.map((r) => r.gloss)).toEqual(["Yes.", "No."]);
    expect(merged.aspectExamples[0].examples[0].gloss).toBe("I check.");
    expect(merged.aspectExamples[0].examples[0].ru).toBe("Я проверяю.");
  });

  it("handles map-shaped fields like formExamples", () => {
    const ja = { formExamples: { "past.m": { ru: "Он проверил.", gloss: "彼は確認した。" } } };
    const en = { formExamples: { "past.m": { ru: "Он проверил.", gloss: "He checked." } } };
    expect((mergeGlossLanguage(ja, en) as typeof ja).formExamples["past.m"].gloss).toBe("He checked.");
  });

  // The structural rule is the point: a schema that grows should not need
  // this file edited.
  it("sends a NEW gloss field to the gloss language automatically", () => {
    const ja = { futureField: { ru: "Х", gloss: "新フィールド" } };
    const en = { futureField: { ru: "Х", gloss: "new field" } };
    expect((mergeGlossLanguage(ja, en) as typeof ja).futureField.gloss).toBe("new field");
  });

  it("keeps a NEW prose field in the prose language automatically", () => {
    const ja = { futureNote: "新しい説明" };
    const en = { futureNote: "a new explanation" };
    expect(mergeGlossLanguage(ja, en)).toEqual({ futureNote: "新しい説明" });
  });

  it("falls back to prose when the counterpart is missing or mis-shaped", () => {
    const ja = { a: { gloss: "あ" }, b: [{ gloss: "い" }] };
    expect(mergeGlossLanguage(ja, null)).toBe(ja);
    expect(mergeGlossLanguage(ja, undefined)).toBe(ja);
    expect(mergeGlossLanguage(ja, {} as typeof ja)).toEqual(ja);
    // Array shorter on the gloss side: the extra items keep their prose value.
    expect(mergeGlossLanguage({ b: [{ gloss: "い" }, { gloss: "う" }] }, { b: [{ gloss: "i" }] })).toEqual({
      b: [{ gloss: "i" }, { gloss: "う" }],
    });
  });

  it("ignores an empty gloss rather than blanking a real one", () => {
    expect(mergeGlossLanguage({ gloss: "ある" }, { gloss: "" })).toEqual({ gloss: "ある" });
    expect(mergeGlossLanguage({ gloss: "ある" }, { gloss: "   " })).toEqual({ gloss: "ある" });
  });
});

describe("resolveExplainLangs", () => {
  const both = (l: string) => l === "ja" || l === "en";

  it("Katsuta's setup: English meanings, Japanese grammar", () => {
    expect(resolveExplainLangs("mixed", "en", "ja", both)).toEqual({ prose: "ja", gloss: "en" });
  });

  it("the mirror case: a ja-front learner with an en interface", () => {
    expect(resolveExplainLangs("mixed", "ja", "en", both)).toEqual({ prose: "en", gloss: "ja" });
  });

  it("'front' mode puts everything in one language", () => {
    expect(resolveExplainLangs("front", "en", "ja", both)).toEqual({ prose: "en", gloss: "en" });
  });

  it("falls back when the UI language has no chunks (a ru interface)", () => {
    // Better one language than an empty sheet.
    expect(resolveExplainLangs("mixed", "en", "ru", both)).toEqual({ prose: "en", gloss: "en" });
  });

  it("falls back when the FRONT language has no chunks", () => {
    expect(resolveExplainLangs("mixed", "ru", "ja", both)).toEqual({ prose: "ja", gloss: "ja" });
  });

  it("degrades to a single language when neither is available", () => {
    const none = () => false;
    expect(resolveExplainLangs("mixed", "ru", "ru", none)).toEqual({ prose: "ru", gloss: "ru" });
  });
});

// Against the REAL generated data, so a schema change that breaks the split
// shows up here rather than on Katsuta's phone.
describe("the real chunks merge into a genuinely mixed sheet", () => {
  it("gives English glosses and Japanese prose for a verb entry", () => {
    const ja = buildWordChunk("ja") as Record<string, Record<string, unknown>>;
    const en = buildWordChunk("en") as Record<string, Record<string, unknown>>;
    const merged = mergeGlossLanguage(ja["проверить"], en["проверить"]) as {
      etymology: string;
      commonMistakes: string;
      governance?: { pattern: string; example: { gloss: string } }[];
      formExamples?: Record<string, { gloss: string }>;
    };
    // Prose: Japanese (contains kana or kanji).
    expect(merged.etymology).toMatch(/[ぁ-んァ-ン一-龥]/);
    expect(merged.commonMistakes).toMatch(/[ぁ-んァ-ン一-龥]/);
    expect(merged.governance?.[0].pattern).toMatch(/[ぁ-んァ-ン一-龥]/);
    // Glosses: English (no Japanese script).
    expect(merged.governance?.[0].example.gloss).not.toMatch(/[ぁ-んァ-ン一-龥]/);
    const firstForm = Object.values(merged.formExamples ?? {})[0];
    expect(firstForm?.gloss).not.toMatch(/[ぁ-んァ-ン一-龥]/);
  });

  it("gives English reply glosses and Japanese skeleton notes for a sentence", () => {
    const ja = buildSentenceChunk("ja") as Record<string, Record<string, unknown>>;
    const en = buildSentenceChunk("en") as Record<string, Record<string, unknown>>;
    const merged = mergeGlossLanguage(ja["T0174"], en["T0174"]) as {
      skeleton: { note: string }[];
      keyPoint: string;
      replies: { ru: string; gloss: string }[];
    };
    expect(merged.skeleton[0].note).toMatch(/[ぁ-んァ-ン一-龥]/);
    expect(merged.keyPoint).toMatch(/[ぁ-んァ-ン一-龥]/);
    for (const r of merged.replies) {
      expect(r.gloss, `reply gloss should be English: ${r.gloss}`).not.toMatch(/[ぁ-んァ-ン一-龥]/);
      expect(r.ru).toMatch(/[А-Яа-яЁё]/); // Russian untouched
    }
  });
});
