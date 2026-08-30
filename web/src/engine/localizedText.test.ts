import { describe, it, expect } from "vitest";
import { resolveLocalizedText } from "./localizedText";
import type { LocalizedText } from "./localizedText";

const full: LocalizedText = { ja: "日本語ノート", en: "English note", ru: "Заметка" };

describe("resolveLocalizedText (LINGO-026: front→UI→en→ja fallback for free-text notes)", () => {
  it("prefers the front language when present", () => {
    expect(resolveLocalizedText(full, "en", "ru")).toBe("English note");
    expect(resolveLocalizedText(full, "ru", "en")).toBe("Заметка");
    expect(resolveLocalizedText(full, "ja", "en")).toBe("日本語ノート");
  });

  it("falls back to the UI language when the front language has no translation", () => {
    const text: LocalizedText = { ja: "日本語ノート", en: null, ru: "Заметка" };
    expect(resolveLocalizedText(text, "en", "ru")).toBe("Заметка"); // front=en missing -> UI=ru
  });

  it("falls back to en when neither front nor UI language has a translation", () => {
    const text: LocalizedText = { ja: "日本語ノート", en: "English note", ru: null };
    expect(resolveLocalizedText(text, "ru", "ru")).toBe("English note");
  });

  it("falls back to ja as a last resort when only ja exists (untranslated legacy content)", () => {
    const text: LocalizedText = { ja: "日本語ノート", en: null, ru: null };
    expect(resolveLocalizedText(text, "en", "en")).toBe("日本語ノート");
  });

  it("this is exactly the reported bug's fix: UI=en, front=en, no ja/no leak once translated", () => {
    // Before LINGO-026: the raw ja note was shown unconditionally regardless
    // of UI/front language. After: an en translation resolves to en text.
    const text: LocalizedText = { ja: "しばらく横になる", en: "lie down for a while", ru: null };
    expect(resolveLocalizedText(text, "en", "en")).toBe("lie down for a while");
    expect(resolveLocalizedText(text, "en", "en")).not.toContain("しばらく");
  });

  it("returns null when every field is null", () => {
    expect(resolveLocalizedText({ ja: null, en: null, ru: null }, "en", "en")).toBeNull();
  });

  it("treats an empty string the same as null (never resolves to a blank line)", () => {
    const text: LocalizedText = { ja: "日本語ノート", en: "", ru: "  " };
    expect(resolveLocalizedText(text, "en", "ru")).toBe("日本語ノート"); // both en/ru blank -> falls through to ja
  });

  it("front === uiLang is not a special case — same field just checked once effectively", () => {
    expect(resolveLocalizedText(full, "ru", "ru")).toBe("Заметка");
  });
});
