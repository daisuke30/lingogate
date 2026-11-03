// LINGO-068 — the example picker.
//
// The thing worth testing is the picker's judgement, not that it returns an
// array: three slots must buy three DIFFERENT things. A word whose entry
// carries eight past-tense examples and one imperative should not spend all
// three slots on the past tense, and the sentence the learner is taught the
// word on must lead.
//
// The last block runs the picker over the real RU deck and the real v2
// dictionary, because the coverage gap this feature has to live with is a
// fact about the data, not about the code.

import { describe, it, expect } from "vitest";
import { collectWordExamples, dictExampleGroups } from "./wordExamples";
import type { WordDictEntry } from "./explain";

function entry(over: Partial<WordDictEntry> = {}): WordDictEntry {
  return {
    lemma: "делать",
    pos: "verb",
    forms: null,
    aspectUsage: null,
    etymology: "",
    related: [],
    collocations: [],
    commonMistakes: "",
    ...over,
  };
}

const ex = (ru: string, gloss = `${ru}-gloss`) => ({ ru, gloss });

describe("collectWordExamples", () => {
  it("leads with the sentence the word is taught on", () => {
    const out = collectWordExamples({
      deckSentences: [
        { id: "T2", ru: "Другое предложение.", gloss: "other", isTarget: false },
        { id: "T1", ru: "Я делаю это.", gloss: "I do it.", isTarget: true },
      ],
      entry: null,
    });
    expect(out[0]).toMatchObject({ ru: "Я делаю это.", source: "deck", sentenceId: "T1" });
  });

  it("spends its slots on different things, not three of the same form", () => {
    // Eight past-tense examples and one imperative: a naive "take the first
    // three" returns three past forms and teaches nothing new on slots 2-3.
    const formExamples: Record<string, { ru: string; gloss: string }> = {};
    for (const k of ["m", "f", "n", "pl"]) formExamples[`past.${k}`] = ex(`past-${k}`);
    for (const k of ["1sg", "2sg", "3sg"]) formExamples[`nonpast.${k}`] = ex(`nonpast-${k}`);
    formExamples["imperative.sg"] = ex("imper-sg");

    const out = collectWordExamples({ deckSentences: [], entry: entry({ formExamples }) });
    const groups = out.map((o) => (o.slot ?? "").split(".")[0]);
    expect(out).toHaveLength(3);
    expect(new Set(groups).size).toBe(3); // past, nonpast, imperative — one each
  });

  it("takes one example from each aspect side rather than two of one", () => {
    const out = collectWordExamples({
      deckSentences: [],
      entry: entry({
        aspectExamples: [
          { aspect: "impf", lemma: "делать", examples: [ex("impf-1"), ex("impf-2")] },
          { aspect: "pf", lemma: "сделать", examples: [ex("pf-1"), ex("pf-2")] },
        ],
      }),
      limit: 2,
    });
    expect(out.map((o) => o.ru)).toEqual(["impf-1", "pf-1"]);
  });

  it("puts case government first — it is the most informative single example", () => {
    const out = collectWordExamples({
      deckSentences: [],
      entry: entry({
        governance: [{ pattern: "+ instr", example: ex("gov-1") }],
        formExamples: { "past.m": ex("form-1") },
      }),
      limit: 1,
    });
    expect(out[0]).toMatchObject({ ru: "gov-1", source: "governance", slot: "+ instr" });
  });

  it("never shows the same sentence twice, however it is punctuated", () => {
    const out = collectWordExamples({
      deckSentences: [{ id: "T1", ru: "Я делаю это.", gloss: "g", isTarget: true }],
      entry: entry({ formExamples: { "nonpast.1sg": ex("я  делаю  это", "dup") } }),
    });
    expect(out).toHaveLength(1);
  });

  it("falls back to other deck sentences when the dictionary has nothing", () => {
    const out = collectWordExamples({
      deckSentences: [
        { id: "T1", ru: "Один.", gloss: "one", isTarget: true },
        { id: "T2", ru: "Два.", gloss: "two", isTarget: false },
        { id: "T3", ru: "Три.", gloss: "three", isTarget: false },
        { id: "T4", ru: "Четыре.", gloss: "four", isTarget: false },
      ],
      entry: null,
    });
    expect(out.map((o) => o.ru)).toEqual(["Один.", "Два.", "Три."]);
  });

  it("drops examples with no translation rather than showing bare Russian", () => {
    const out = collectWordExamples({
      deckSentences: [{ id: "T1", ru: "Без перевода.", gloss: "", isTarget: true }],
      entry: entry({
        governance: [{ pattern: "p", example: { ru: "Тоже без.", gloss: "" } }],
      }),
    });
    expect(out).toEqual([]);
  });

  it("returns nothing at all for a word with neither source", () => {
    expect(collectWordExamples({ deckSentences: [], entry: entry() })).toEqual([]);
    expect(collectWordExamples({ deckSentences: [], entry: null })).toEqual([]);
  });
});

describe("dictExampleGroups", () => {
  it("keeps form groups apart so the picker can round-robin them", () => {
    const groups = dictExampleGroups(
      entry({
        formExamples: {
          "past.m": ex("a"),
          "past.f": ex("b"),
          "nonpast.1sg": ex("c"),
        },
      }),
    );
    expect(groups.map((g) => g.length)).toEqual([2, 1]);
  });

  it("is empty for an entry with no v2 enrichment", () => {
    expect(dictExampleGroups(entry())).toEqual([]);
    expect(dictExampleGroups(null)).toEqual([]);
  });
});
