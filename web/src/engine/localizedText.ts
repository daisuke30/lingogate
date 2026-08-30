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
 * the same as null (never resolves to a blank line in the UI). */
export function resolveLocalizedText(
  text: LocalizedText,
  frontLang: NoteLang,
  uiLang: NoteLang,
): string | null {
  return pick(text[frontLang]) ?? pick(text[uiLang]) ?? pick(text.en) ?? pick(text.ja) ?? null;
}

function pick(v: string | null | undefined): string | null {
  return v && v.trim() !== "" ? v : null;
}
