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
import thDeck from "../content/deck.th.json";
import jaDeck from "../content/deck.ja.json";
import { resolveLocalizedText, readsJapanese, pronunciationReadable } from "./localizedText";
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
  course: "ru" | "en" | "th" | "ja";
}

const DECKS = { ru: ruDeck, en: enDeck, th: thDeck, ja: jaDeck } as const;

/** The 18 valid (UI, front, course) combinations — LINGO-039 took this from
 * 12 to 18 by adding the Thai course (2 front options × 3 UI languages). */
const PATTERNS: Pattern[] = [];
for (const [course, fronts] of [
  ["ru", ["en", "ja"]],
  ["en", ["ja", "ru"]],
  ["th", ["ja", "en"]],
  ["ja", ["en", "ru"]],
] as const) {
  for (const front of fronts) {
    for (const ui of UI_LANGS) {
      // LINGO-044: a course is never offered to a speaker of its own target
      // language (selectableCourses), so these combinations are unreachable
      // and must not be audited as if a learner could land on them.
      if (ui === course) continue;
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
    // LINGO-039: the kana slot's gate is now "can this learner read THIS
    // transcription" rather than "does this learner read Japanese" — the RU
    // pack puts katakana here, the TH pack puts Paiboon romanization.
    if (s.kana && pronunciationReadable(s.kana as string, p.front, p.ui, p.course))
      out.push({ label: `kana ${s.id}`, text: s.kana as string });
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
  // The Japanese COURSE is excluded on purpose: its learners did choose
  // Japanese — it is what they are studying — so Japanese on the card is the
  // material, not a leak. They are covered by their own block below, which
  // asserts the opposite direction (the furigana must actually reach them).
  const jaFree = PATTERNS.filter(
    (p) => p.ui !== "ja" && p.front !== "ja" && p.course !== "ja",
  );
  // 4: back=ru front=en UI=en, back=en front=ru UI=ru, back=th front=en ×
  // UI en/ru. (Fewer than before LINGO-044 only because a course is no longer
  // offered to a speaker of its own language, so those pairings are gone.)
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

  it("JP traveller to Thailand (UI=ja/front=ja/back=th) sees Japanese glosses and the transcription", () => {
    const p: Pattern = { name: "jp-th", ui: "ja", front: "ja", course: "th" };
    const w = (thDeck.words as Record<string, unknown>[])[0];
    expect(gloss(w, p)).toBe(w.jaGloss);
    expect(CYRILLIC.test(gloss(w, p))).toBe(false);
    const kana = cardStrings(p).filter((s) => s.label.startsWith("kana "));
    expect(kana.length).toBeGreaterThan(0);
  });

  it("EN learner of Thai (UI=en/front=en/back=th) sees no Japanese anywhere", () => {
    const p: Pattern = { name: "en-th", ui: "en", front: "en", course: "th" };
    const bad = cardStrings(p).filter((s) => hasJapanese(s.text));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// -- 2b. the Thai transcription must REACH the learners who need it ---------
// The mirror image of every other test in this file. LINGO-037's rule was
// "suppress anything in a language the learner didn't choose"; applied
// literally to the kana slot it would have hidden the Paiboon transcription
// from every ja-free learner — silently gutting the Thai course, since Thai
// spelling does not tell a beginner the tone. A leak test that only ever
// checks for over-showing cannot catch under-showing, so this asserts the
// positive direction explicitly.
describe("LINGO-039: Thai pronunciation reaches every Thai learner", () => {
  const thPatterns = PATTERNS.filter((p) => p.course === "th");

  it("covers all 6 Thai patterns", () => {
    expect(thPatterns).toHaveLength(6);
  });

  for (const p of thPatterns) {
    it(`${p.name}: every sentence shows its transcription`, () => {
      const shown = cardStrings(p).filter((s) => s.label.startsWith("kana "));
      expect(shown.length).toBe((thDeck.sentences as unknown[]).length);
      // ...and it is Latin/Paiboon, never Japanese or Thai script
      for (const s of shown.slice(0, 50)) {
        expect(hasJapanese(s.text), `Japanese in a Thai transcription: ${s.text}`).toBe(false);
        expect(/[฀-๿]/.test(s.text), `Thai script in a transcription: ${s.text}`).toBe(false);
      }
    });
  }

  it("still hides the RU pack's katakana from a learner who cannot read it", () => {
    // The behaviour LINGO-037 introduced must survive the LINGO-039 change.
    expect(pronunciationReadable("ウディヴィーチェリナ", "en", "en")).toBe(false);
    expect(pronunciationReadable("ウディヴィーチェリナ", "en", "ja")).toBe(true);
    expect(pronunciationReadable("sà-wàt-dii", "en", "en")).toBe(true);
    expect(pronunciationReadable("sà-wàt-dii", "ru", "ru")).toBe(true);
  });
});

// -- 2c. the Japanese course's own material must reach its learners ---------
// The mirror of the block above, and the reason `pronunciationReadable` takes
// the target language. A Japanese course for English and Russian speakers is
// nothing but Japanese text; the furigana is the single line that makes a
// kanji word pronounceable for a beginner. Applying "suppress Japanese the
// learner didn't choose" literally would delete it and gut the course.
describe("LINGO-044: the Japanese course shows Japanese to its own learners", () => {
  const jaPatterns = PATTERNS.filter((p) => p.course === "ja");

  it("covers all 4 reachable Japanese-course patterns", () => {
    // fronts en/ru × UI en/ru; UI=ja is unreachable (selectableCourses).
    expect(jaPatterns).toHaveLength(4);
  });

  for (const p of jaPatterns) {
    it(`${p.name}: every sentence shows its reading`, () => {
      const shown = cardStrings(p).filter((s) => s.label.startsWith("kana "));
      expect(shown.length).toBe((jaDeck.sentences as unknown[]).length);
    });
  }

  it("still hides the RU pack's katakana from a learner who cannot read it", () => {
    // The LINGO-037 behaviour must survive: the exemption is for the course
    // being Japanese, not for Japanese script in general.
    expect(pronunciationReadable("ウディヴィーチェリナ", "en", "en", "ru")).toBe(false);
    expect(pronunciationReadable("ウディヴィーチェリナ", "en", "en", "ja")).toBe(true);
    expect(pronunciationReadable("sà-wàt-dii", "ru", "ru", "th")).toBe(true);
  });

  it("gives en/ru learners glosses in their own language, never Japanese", () => {
    for (const p of jaPatterns) {
      // Glosses only. A grammar NOTE on a Japanese course legitimately quotes
      // Japanese ("付く is a godan verb; its ます-form is 付きます") — that is the
      // explanation, not a leak. A gloss is a translation and must not.
      const bad = cardStrings(p)
        .filter((s) => s.label.startsWith("gloss "))
        .filter((s) => hasJapanese(s.text));
      expect(bad.slice(0, 3), `${p.name}: Japanese in a gloss`).toEqual([]);
    }
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

  it("every pos code present in any deck has an i18n key (no hardcoded ja posLabel fallback)", () => {
    const posCodes = new Set<string>();
    for (const d of [ruDeck, enDeck, thDeck])
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
