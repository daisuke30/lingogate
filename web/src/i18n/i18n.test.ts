import { describe, it, expect } from "vitest";
import { CATALOG, UI_LANGS, langName, translate } from "./i18n";

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
    expect(translate("en", "home.band.dueNow", { n: 3 })).toBe("Cards due for review: 3");
  });

  it("falls back to Japanese for an unknown language and to the raw key for an unknown key", () => {
    // @ts-expect-error — exercising the runtime fallback path with a bad lang.
    expect(translate("xx", "common.home")).toBe("ホーム");
    expect(translate("ja", "no.such.key")).toBe("no.such.key");
  });

  it("langName gives the language's name in the requested UI language", () => {
    expect(langName("ja", "ru")).toBe("ロシア語");
    expect(langName("en", "ru")).toBe("Russian");
    expect(langName("ru", "en")).toBe("английский");
  });
});
