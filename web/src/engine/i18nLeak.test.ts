// LINGO-037: per-pattern language-leak regression suite.
//
// The app has three independent language axes (design §1): UI language, course
// (card back / target), and front (prompt & gloss) language. That is 12 valid
// combinations today (2 shipped courses × 2 front languages each × 3 UI
// languages; the ja course is still coming-soon). The rule under test:
//
//   a learner must never be shown text in a language they did not choose,
//   with English as the only neutral last resort.
//
// These tests run the REAL decks and the REAL display resolvers, so a data
// regression (a note that loses its translation, a new word with only a ja
// gloss) fails here exactly like a code regression. Four patterns are called
// out by name because they are the personas the product is actually aimed at:
//
//   Katsuta        UI=ja  front=en  back=ru  — the shipped setup, must not regress
//   JP → English   UI=ja  front=ja  back=en
//   RU → English   UI=ru  front=ru  back=en  — not one Japanese character
//   EN → Russian   UI=en  front=en  back=ru  — not one Japanese character

import { describe, it, expect } from "vitest";
import ruDeck from "../content/deck.ru.json";
import enDeck from "../content/deck.en.json";
import { resolveLocalizedText, readsJapanese } from "./localizedText";
import { formatAspectLine, formatGenderLine, formatCaseLine, punctFor } from "./wordBreakdown";
import { translate, CATALOG, UI_LANGS } from "../i18n/i18n";
import type { Lang } from "../content/courses";

// -- script detectors -------------------------------------------------------
const KANA = /[぀-ヿ]/;
const HAN = /[一-鿿]/;
const CYRILLIC = /[Ѐ-ӿ]/;
/** CJK punctuation: full-width brackets, 、。・〜 etc. */
const CJK_PUNCT = /[　-〿！-｠]/;

const hasJapanese = (s: string) => KANA.test(s) || HAN.test(s);

// -- the display model, mirroring FlashcardCard ----------------------------
interface Pattern {
  name: string;
  ui: Lang;
  front: Lang;
  course: "ru" | "en";
}

const DECKS = { ru: ruDeck, en: enDeck } as const;

/** The 12 valid (UI, front, course) combinations. */
const PATTERNS: Pattern[] = [];
for (const [course, fronts] of [
  ["ru", ["en", "ja"]],
  ["en", ["ja", "ru"]],
] as const) {
  for (const front of fronts) {
    for (const ui of UI_LANGS) {
      PATTERNS.push({ name: `UI=${ui}/front=${front}/back=${course}`, ui, front, course });
    }
  }
}

/** Languages this learner chose, and can therefore read. */
const chosen = (p: Pattern): Lang[] => (p.front === p.ui ? [p.front] : [p.front, p.ui]);

/** Mirrors FlashcardCard's orderedGloss. */
function gloss(w: Record<string, unknown>, p: Pattern): string {
  const of = (l: Lang) => (w[`${l}Gloss`] as string | null) ?? null;
  const picked = chosen(p)
    .map(of)
    .filter((g): g is string => !!g);
  if (picked.length > 0) return picked.filter((x, i, a) => a.indexOf(x) === i).join(" / ");
  return (of("en") ?? (readsJapanese(p.front, p.ui) ? of("ja") : null)) ?? "";
}

/** Every free-text and gloss string a card can put on screen for a pattern. */
function cardStrings(p: Pattern): { label: string; text: string }[] {
  const deck = DECKS[p.course] as unknown as {
    words: Record<string, unknown>[];
    sentences: Record<string, unknown>[];
  };
  const out: { label: string; text: string }[] = [];
  const showJaAid = readsJapanese(p.front, p.ui);

  for (const s of deck.sentences) {
    // target text (course language) and prompt text (front language) are
    // by definition in a language the learner asked for — not re-checked here.
    const note = resolveLocalizedText(
      { ja: (s.note as string) ?? null, en: (s.noteEn as string) ?? null, ru: (s.noteRu as string) ?? null },
      p.front,
      p.ui,
      showJaAid,
    );
    if (note) out.push({ label: `note ${s.id}`, text: note });
    if (showJaAid && s.kana) out.push({ label: `kana ${s.id}`, text: s.kana as string });
    // (the card also skips this when targetLang is ja; no shipped course is ja yet)
    if (showJaAid && p.front !== "ja" && s.ja)
      out.push({ label: `ja-line ${s.id}`, text: s.ja as string });
  }

  for (const w of deck.words) {
    const g = gloss(w, p);
    if (g) out.push({ label: `gloss ${w.lemma}`, text: g });
    const pairNote = resolveLocalizedText(
      {
        ja: (w.pairNote as string) ?? null,
        en: (w.pairNoteEn as string) ?? null,
        ru: (w.pairNoteRu as string) ?? null,
      },
      p.front,
      p.ui,
      showJaAid,
    );
    if (pairNote) out.push({ label: `pairNote ${w.lemma}`, text: pairNote });
  }
  return out;
}

// -- 1. no Japanese for learners who did not choose Japanese ---------------
describe("LINGO-037: no Japanese reaches a learner who chose neither ja UI nor ja prompts", () => {
  const jaFree = PATTERNS.filter((p) => p.ui !== "ja" && p.front !== "ja");
  // 4 of the 12: UI=en/front=en/ru, UI=ru/front=en/ru, UI=en/front=ru/en, UI=ru/front=ru/en
  it("covers every ja-free pattern", () => {
    expect(jaFree.map((p) => p.name)).toHaveLength(4);
  });

  for (const p of jaFree) {
    it(`${p.name}: not one kana or kanji on any card`, () => {
      const offenders = cardStrings(p)
        .filter((s) => hasJapanese(s.text))
        .slice(0, 5);
      expect(offenders, `Japanese leaked into ${p.name}: ${JSON.stringify(offenders)}`).toEqual([]);
    });

    it(`${p.name}: no CJK punctuation in composed breakdown lines`, () => {
      const punct = punctFor(p.ui);
      const labels = {
        pf: translate(p.ui, "aspect.pf"),
        impf: translate(p.ui, "aspect.impf"),
        both: translate(p.ui, "aspect.both"),
        pair: translate(p.ui, "aspect.pairOf"),
        related: translate(p.ui, "aspect.related"),
        noPair: translate(p.ui, "aspect.noPair"),
        always: translate(p.ui, "aspect.always"),
      };
      const line = formatAspectLine(
        { lemma: "делать", aspect: "impf", aspectPair: "сделать", pairKind: "pair", pairNote: null },
        labels,
        punct,
      );
      expect(line).not.toBeNull();
      expect(CJK_PUNCT.test(line!), `CJK punctuation in ${p.name}: ${line}`).toBe(false);
    });
  }
});

// -- 2. the four named personas --------------------------------------------
describe("LINGO-037: the four target personas", () => {
  it("Katsuta (UI=ja/front=en/back=ru) keeps his bilingual EN+JA gloss — no regression", () => {
    const p: Pattern = { name: "katsuta", ui: "ja", front: "en", course: "ru" };
    const я = (ruDeck.words as Record<string, unknown>[]).find((w) => w.lemma === "я")!;
    expect(gloss(я, p)).toBe("I / 私");
    // and he still gets the ja reference line + kana aid
    expect(readsJapanese(p.front, p.ui)).toBe(true);
    expect(punctFor(p.ui).open).toBe("（");
  });

  it("JP learner of English (UI=ja/front=ja/back=en) sees Japanese only — no stray Russian gloss", () => {
    const p: Pattern = { name: "jp-en", ui: "ja", front: "ja", course: "en" };
    const w = (enDeck.words as Record<string, unknown>[])[0];
    const g = gloss(w, p);
    expect(g).toBe(w.jaGloss);
    expect(CYRILLIC.test(g), `Russian gloss leaked to a JP learner: ${g}`).toBe(false);
  });

  it("RU learner of English (UI=ru/front=ru/back=en) sees no Japanese anywhere", () => {
    const p: Pattern = { name: "ru-en", ui: "ru", front: "ru", course: "en" };
    const bad = cardStrings(p).filter((s) => hasJapanese(s.text));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("EN learner of Russian (UI=en/front=en/back=ru) sees no Japanese anywhere", () => {
    const p: Pattern = { name: "en-ru", ui: "en", front: "en", course: "ru" };
    const bad = cardStrings(p).filter((s) => hasJapanese(s.text));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// -- 3. structural labels follow the UI language ---------------------------
describe("LINGO-037: structural labels follow the UI language", () => {
  for (const ui of UI_LANGS) {
    it(`UI=${ui}: every pos/aspect/gender/case label is in the UI language, never a ja fallback`, () => {
      const keys = Object.keys(CATALOG).filter((k) =>
        /^(pos|aspect|gender|case)\./.test(k),
      );
      expect(keys.length).toBeGreaterThan(20);
      for (const k of keys) {
        const v = translate(ui, k);
        expect(v, `${k} missing for ${ui}`).not.toBe(k);
        if (ui !== "ja") {
          expect(hasJapanese(v), `${k} for UI=${ui} is Japanese: ${v}`).toBe(false);
        }
      }
    });
  }

  it("every pos code present in either deck has an i18n key (no hardcoded ja posLabel fallback)", () => {
    const posCodes = new Set<string>();
    for (const d of [ruDeck, enDeck])
      for (const w of d.words as Record<string, unknown>[]) posCodes.add(w.pos as string);
    for (const pos of posCodes) {
      expect(Object.keys(CATALOG), `pos '${pos}' has no i18n key`).toContain(`pos.${pos}`);
    }
  });

  it("gender and case lines are punctuated per UI language", () => {
    expect(formatGenderLine({ lemma: "книга", gender: "f" }, undefined, punctFor("ja"))).toBe(
      "книга（女性名詞）",
    );
    const en = { m: "masculine", f: "feminine", n: "neuter", pl: "plural only", mf: "common" };
    expect(formatGenderLine({ lemma: "книга", gender: "f" }, en, punctFor("en"))).toBe(
      "книга (feminine)",
    );
    const caseLabels = {
      form: "form in the sentence",
      case1: "case 1",
      case2: "case 2",
      case3: "case 3",
      case4: "case 4 (accusative)",
      case5: "case 5",
      case6: "case 6",
    };
    expect(
      formatCaseLine(
        { lemma: "книга", caseForm: { surface: "книгу", case: 4, number: "sg" } },
        caseLabels,
        punctFor("en"),
      ),
    ).toBe("form in the sentence: книгу (case 4 (accusative))");
  });
});

// -- 4. the ja last-resort net is reachable only by ja readers -------------
describe("LINGO-037: ja last-resort fallback is gated on the learner reading ja", () => {
  const jaOnly = { ja: "しばらく横になる", en: null, ru: null };

  it("still fires for a ja reader (Katsuta, and a ja-prompt learner)", () => {
    expect(resolveLocalizedText(jaOnly, "en", "ja", readsJapanese("en", "ja"))).toBe(
      "しばらく横になる",
    );
    expect(resolveLocalizedText(jaOnly, "ja", "ru", readsJapanese("ja", "ru"))).toBe(
      "しばらく横になる",
    );
  });

  it("returns null rather than untranslated Japanese for a non-ja learner", () => {
    expect(resolveLocalizedText(jaOnly, "en", "en", readsJapanese("en", "en"))).toBeNull();
    expect(resolveLocalizedText(jaOnly, "ru", "ru", readsJapanese("ru", "ru"))).toBeNull();
    expect(resolveLocalizedText(jaOnly, "en", "ru", readsJapanese("en", "ru"))).toBeNull();
  });

  it("en is still the neutral last resort before ja is considered", () => {
    const withEn = { ja: "しばらく横になる", en: "lie down for a while", ru: null };
    expect(resolveLocalizedText(withEn, "ru", "ru", readsJapanese("ru", "ru"))).toBe(
      "lie down for a while",
    );
  });
});
