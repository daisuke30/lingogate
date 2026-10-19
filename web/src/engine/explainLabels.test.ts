import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations (same
// pattern as content/build.test.ts). Reading the SOURCE jsonl through the real
// builder, rather than the generated public/ chunk, means drift is caught
// before the artifact is even rebuilt.
import { buildWordChunk } from "../../scripts/build-explain.mjs";
import {
  CASE_NUMBER_BY_ABBR,
  KNOWN_FORM_SLOTS,
  aspectFormsNoteKey,
  formCellLabelKey,
  formGroupLabelKey,
} from "./explainLabels";
import { CATALOG, UI_LANGS, translate } from "../i18n/i18n";

describe("case abbreviations map to the app-wide numbered cases (LINGO-033)", () => {
  it("covers all six Russian cases in the pedagogical order", () => {
    expect(CASE_NUMBER_BY_ABBR).toEqual({ nom: 1, gen: 2, dat: 3, acc: 4, instr: 5, prep: 6 });
  });

  it("renders a noun's declension with the same labels the card back uses", () => {
    expect(formCellLabelKey("sg", "nom")).toBe("case.1");
    expect(formCellLabelKey("sg", "prep")).toBe("case.6");
    expect(translate("ja", formCellLabelKey("sg", "acc")!)).toBe("4格・対格");
    expect(translate("en", formCellLabelKey("sg", "gen")!)).toBe("case 2 (genitive)");
    expect(translate("ru", formCellLabelKey("sg", "dat")!)).toBe("дательный (3-й)");
  });
});

describe("slot labels are resolved per group, not globally", () => {
  it("reads 'pl' as plural under imperative but as 'they' under nonpast", () => {
    expect(formCellLabelKey("imperative", "pl")).toBe("explain.number.pl");
    expect(formCellLabelKey("nonpast", "3pl")).toBe("explain.person.3pl");
  });

  it("reads bare m/f/n/pl as gender agreement (adjective row and past tense)", () => {
    expect(formCellLabelKey("", "f")).toBe("explain.gender.f");
    expect(formCellLabelKey("past", "n")).toBe("explain.gender.n");
  });

  it("returns null for a slot it does not know, so the raw key shows rather than a blank", () => {
    expect(formCellLabelKey("sg", "vocative")).toBeNull();
    expect(formCellLabelKey("nonpast", "4sg")).toBeNull();
    expect(formGroupLabelKey("dual")).toBeNull();
  });
});

// THE regression guard the follow-up asked for: a slot that appears in the
// shipped dictionary but has no mapping would render as a bare "nom" — the
// exact thing being fixed — and nothing else would notice.
describe("no abbreviation in the shipped dictionary goes unmapped", () => {

  it("every (group, cell) in the declared slot list resolves to a real catalog key", () => {
    for (const { group, cells } of KNOWN_FORM_SLOTS) {
      if (group) {
        const gk = formGroupLabelKey(group);
        expect(gk, `group '${group}' has no label key`).not.toBeNull();
        expect(Object.keys(CATALOG), `group '${group}' key missing from catalog`).toContain(gk!);
      }
      for (const cell of cells) {
        const ck = formCellLabelKey(group, cell);
        expect(ck, `slot '${group}.${cell}' has no label key`).not.toBeNull();
        expect(Object.keys(CATALOG), `'${group}.${cell}' key missing from catalog`).toContain(ck!);
        for (const lang of UI_LANGS) {
          // A key that falls through to itself is an untranslated label.
          expect(translate(lang, ck!), `'${ck}' untranslated in ${lang}`).not.toBe(ck);
        }
      }
    }
  });

  it("the real dictionary data uses no slot outside that list", () => {
    const dict = buildWordChunk("ja") as Record<string, { forms: Record<string, unknown> | null }>;
    expect(Object.keys(dict).length).toBeGreaterThan(2000); // the real 3000-word dictionary
    const unmapped = new Set<string>();
    for (const entry of Object.values(dict)) {
      if (!entry.forms) continue;
      for (const [key, value] of Object.entries(entry.forms)) {
        if (value == null) continue;
        if (typeof value === "string") {
          if (!formCellLabelKey("", key)) unmapped.add(`(flat).${key}`);
          continue;
        }
        if (!formGroupLabelKey(key)) unmapped.add(`group:${key}`);
        for (const cell of Object.keys(value as Record<string, string>)) {
          if (!formCellLabelKey(key, cell)) unmapped.add(`${key}.${cell}`);
        }
      }
    }
    expect([...unmapped].sort()).toEqual([]);
  });
});

// Katsuta's question (2026-10-19): the table said "nonpast", which is the
// schema's name for a slot, not something a learner ever meets.
describe("the conjugation table is named per aspect, not per schema slot", () => {
  it("calls an imperfective's conjugation the present", () => {
    expect(formGroupLabelKey("nonpast", "impf")).toBe("explain.forms.present");
    expect(translate("ja", "explain.forms.present")).toBe("現在形");
    expect(translate("en", "explain.forms.present")).toBe("present");
  });

  it("calls a perfective's conjugation the future", () => {
    expect(formGroupLabelKey("nonpast", "pf")).toBe("explain.forms.future");
    expect(translate("ja", "explain.forms.future")).toBe("未来形");
    expect(translate("ru", "explain.forms.future")).toBe("будущее время");
  });

  it("falls back to the neutral wording for a biaspectual or unknown verb", () => {
    expect(formGroupLabelKey("nonpast", "both")).toBe("explain.forms.nonpast");
    expect(formGroupLabelKey("nonpast", null)).toBe("explain.forms.nonpast");
    expect(formGroupLabelKey("nonpast")).toBe("explain.forms.nonpast");
  });

  it("adds the 'no present tense' note for perfectives only", () => {
    expect(aspectFormsNoteKey("pf")).toBe("explain.forms.pfNote");
    expect(aspectFormsNoteKey("impf")).toBeNull();
    expect(aspectFormsNoteKey("both")).toBeNull();
    expect(aspectFormsNoteKey(null)).toBeNull();
  });

  it("has that note translated in all three UI languages", () => {
    for (const lang of UI_LANGS) {
      const text = translate(lang, "explain.forms.pfNote");
      expect(text).not.toBe("explain.forms.pfNote");
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it("aspect never changes the non-verb groups", () => {
    for (const aspect of ["pf", "impf", "both", null] as const) {
      expect(formGroupLabelKey("sg", aspect)).toBe("explain.forms.sg");
      expect(formGroupLabelKey("past", aspect)).toBe("explain.forms.past");
      expect(formGroupLabelKey("imperative", aspect)).toBe("explain.forms.imperative");
    }
  });
});
