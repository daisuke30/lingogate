// Fallback resolution for free-text explanatory content (LINGO-026): sentence
// grammar notes and verb aspect-pair nuance notes. These are NOT the same
// category as glosses (word meaning translations, which already follow
// front-language-first — see FlashcardCard.tsx's orderedGloss) nor structural
// labels (part-of-speech / aspect / gender category names, a closed 3-language
// vocabulary that intentionally follows the UI language so Katsuta's own
// setup — UI=ja, front=en — is unaffected; see the module note in
// wordBreakdown.ts). Free-text notes are prose written once per language and
// may not have a translation for every language yet, so they get their own
// explicit fallback chain instead of a hardcoded "ja-or-nothing" default.
//
// Rule (Katsuta 2026-08-30, explicit instruction): 表面言語 → UI言語 → en.
// A `ja` value is consulted only as a last-resort safety net for content that
// hasn't been translated at all yet — after LINGO-026's data migration this
// should be rare-to-never for shipped content (every note gets ja+en, most
// get ru too), but showing SOMETHING beats an element silently vanishing.

export type NoteLang = "ja" | "en" | "ru";

export interface LocalizedText {
  ja: string | null;
  en: string | null;
  ru: string | null;
}

/** Resolve one piece of localized free text via the front→UI→en→ja chain.
 * Returns null only if every field is null/empty. An empty string is treated
 * the same as null (never resolves to a blank line in the UI).
 *
 * LINGO-037: the trailing `ja` step is now opt-in (`allowJaFallback`, default
 * true so the pure contract and its tests are unchanged). The safety net above
 * was written when ja was the only UI language, so "showing SOMETHING beats an
 * element vanishing" was always true — the reader could read it. It stops being
 * true for a UI=ru/front=ru learner: untranslated Japanese prose is not a
 * degraded note, it is the exact "日本語が読めない人のUIに日本語が出る" failure
 * this rule exists to prevent, and an absent note is strictly better. Call
 * sites pass `frontLang === "ja" || uiLang === "ja"` so the net still catches
 * Katsuta (UI=ja) and disappears for everyone who cannot read it.
 *
 * The audited data debt this guards (LINGO-037): deck.ru.json has 12 sentences
 * whose only note is Japanese, and deck.en.json has 141 notes parked in the
 * `ja` slot that are not actually Japanese. Translating those is content work
 * tracked separately; this makes the leak impossible meanwhile. */
export function resolveLocalizedText(
  text: LocalizedText,
  frontLang: NoteLang,
  uiLang: NoteLang,
  allowJaFallback = true,
): string | null {
  return (
    pick(text[frontLang]) ??
    pick(text[uiLang]) ??
    pick(text.en) ??
    (allowJaFallback ? pick(text.ja) : null) ??
    null
  );
}

/** Whether the last-resort `ja` note is readable for this learner — i.e. they
 * chose Japanese on at least one of the two axes. Pass to resolveLocalizedText. */
export function readsJapanese(frontLang: NoteLang, uiLang: NoteLang): boolean {
  return frontLang === "ja" || uiLang === "ja";
}

/** Kana or kanji anywhere in the string. Mirrors i18nLeak.test.ts's detectors. */
const JA_SCRIPT = /[぀-ヿ㐀-䶿一-鿿]/;

export function hasJapaneseScript(s: string): boolean {
  return JA_SCRIPT.test(s);
}

/**
 * Whether a `kana` pronunciation aid can be shown to this learner.
 *
 * LINGO-039: `kana` is the pronunciation-transcription slot, but the script it
 * holds is the course's choice, so a single fixed rule cannot be right for
 * both packs:
 *
 *   RU pack — katakana ("ウディヴィーチェリナ"). Meaningless to anyone who
 *     doesn't read Japanese, which is why LINGO-037 gated it behind
 *     readsJapanese() (finding #3: a UI=en learner was being shown it).
 *   TH pack — Paiboon romanization ("sà-wàt-dii"). Latin letters plus tone
 *     diacritics, readable by every learner, and the single most important
 *     field on a Thai card: Thai script encodes tone only through rules a
 *     beginner has not learned, so without this line the learner cannot say
 *     the word at all.
 *
 * Applying LINGO-037's rule unchanged would therefore have silently hidden
 * the transcription from exactly the ja-free learners a Thai course most needs
 * to serve. Gating on what the string ACTUALLY IS keeps LINGO-037's fix intact
 * for the RU pack (katakana still requires a Japanese reader) while letting a
 * romanized transcription through, and neither pack can regress the other.
 */
export function pronunciationReadable(
  kana: string,
  frontLang: NoteLang,
  uiLang: NoteLang,
  targetLang?: string,
): boolean {
  // LINGO-044: a transcription written in the script of the language being
  // LEARNED is not a leak — it is the material. The Japanese course puts
  // furigana here (たべます / tabemasu) for English and Russian speakers, and
  // suppressing it as "Japanese text they didn't ask for" would delete the
  // single most useful line on the card: a beginner cannot read the kanji, so
  // the reading is how they get at the word at all. They did ask for Japanese
  // — it is their course.
  //
  // The rule is therefore "text in a language the learner did not choose",
  // and choosing to LEARN Japanese counts just as much as choosing it for the
  // UI or prompts. RU's katakana aid is unaffected: its target is Russian, so
  // Japanese script there still requires a Japanese reader.
  if (targetLang === "ja") return true;
  return !hasJapaneseScript(kana) || readsJapanese(frontLang, uiLang);
}

function pick(v: string | null | undefined): string | null {
  return v && v.trim() !== "" ? v : null;
}
