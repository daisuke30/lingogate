import { describe, it, expect } from "vitest";
import { CATALOG, NATIVE_LANG_NAME, UI_LANGS, langName, translate } from "./i18n";
import { COURSES } from "../content/courses";

describe("i18n catalog (LINGO-014)", () => {
  it("has a non-empty translation for all three UI languages on every key", () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(CATALOG)) {
      for (const lang of UI_LANGS) {
        if (!entry[lang] || entry[lang].trim() === "") missing.push(`${key}:${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps {placeholder}s consistent across languages for a key", () => {
    // A placeholder present in one language must be present in all (or a param
    // silently disappears in some UI language).
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    const mismatches: string[] = [];
    for (const [key, entry] of Object.entries(CATALOG)) {
      const ja = JSON.stringify(placeholders(entry.ja));
      for (const lang of UI_LANGS) {
        if (JSON.stringify(placeholders(entry[lang])) !== ja) mismatches.push(`${key}:${lang}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("interpolates named params", () => {
    expect(translate("ja", "settings.unlock.minutes", { m: 10 })).toBe("10分");
    expect(translate("en", "settings.unlock.minutes", { m: 10 })).toBe("10 min");
    // LINGO-040 retired home.band.dueNow with the rest of the band card, and
    // LINGO-046 retired its replacement (home.today.withReviews) in turn. The
    // same interpolation path is now exercised through the copy that stands
    // today: the daily goal's countdown.
    expect(translate("en", "home.today.remaining", { n: 3 })).toBe("3 to go");
  });

  it("falls back to Japanese for an unknown language and to the raw key for an unknown key", () => {
    // @ts-expect-error — exercising the runtime fallback path with a bad lang.
    expect(translate("xx", "common.home")).toBe("ホーム");
    expect(translate("ja", "no.such.key")).toBe("no.such.key");
  });

  // LINGO-040: Home's course chip and its picker both render
  // NATIVE_LANG_NAME[course.targetLang] — nothing else. A course whose target
  // language is missing from that map shows a blank chip, and the learner
  // cannot tell what they are studying. LINGO-039's Thai course is the first
  // target language that is not also a UI language, which is precisely the
  // case that can drift.
  it("every course in the picker has a native name for its target language", () => {
    for (const c of COURSES) {
      const name = NATIVE_LANG_NAME[c.targetLang];
      expect(name, `course '${c.courseId}' has no native name`).toBeTruthy();
      expect(name.trim(), `course '${c.courseId}' has a blank native name`).not.toBe("");
    }
    // Spot-check the two that ship today plus Thai, in their own scripts.
    expect(NATIVE_LANG_NAME.ru).toBe("Русский");
    expect(NATIVE_LANG_NAME.th).toBe("ไทย");
  });

  it("every course target language is also nameable inside a sentence, in all three UI languages", () => {
    // e.g. Settings' "{lang}を読み上げる". A missing lang.name.* key would fall
    // through to the raw key and print "lang.name.th" at the learner.
    for (const c of COURSES) {
      for (const ui of UI_LANGS) {
        const rendered = translate(ui, `lang.name.${c.targetLang}`);
        expect(rendered, `lang.name.${c.targetLang} missing for UI=${ui}`).not.toBe(
          `lang.name.${c.targetLang}`,
        );
      }
    }
  });

  it("langName gives the language's name in the requested UI language", () => {
    expect(langName("ja", "ru")).toBe("ロシア語");
    expect(langName("en", "ru")).toBe("Russian");
    expect(langName("ru", "en")).toBe("английский");
  });
});
