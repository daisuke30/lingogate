// LINGO-062 — mixed-language explanations.
//
// Katsuta learns vocabulary in English and grammar in Japanese, so neither
// chunk alone is right for him: the ja chunk explains the grammar the way he
// wants but glosses words in Japanese, and the en chunk does the reverse.
//
// The merge is structural rather than a list of field paths, and that is the
// whole point. LINGO-056's schema names things consistently:
//
//   `gloss`  — the translation of a Russian example or word. A TRANSLATION.
//   `note`, `keyPoint`, `pattern`, `construction`, `aspectUsage`,
//   `etymology`, `commonMistakes`, `simplest` — prose ABOUT the language.
//   `ru`, `lemma`, `forms`, `related`, `collocations` — Russian itself,
//            identical in both chunks.
//
// So: take the prose-language entry whole, and overlay only the `gloss`
// fields from the other one. Written as "every key named gloss" rather than
// as a path list, a v3 that adds `examples[].gloss` is handled on the day it
// lands, and a v3 that adds a new prose field stays in the prose language —
// both without anyone remembering to update this file.

/** Keys whose value is a translation and therefore follows the gloss language. */
const GLOSS_KEYS = new Set(["gloss"]);

/**
 * Deep-merge two renderings of the SAME entry: everything from `prose`,
 * except `gloss` values, which come from `gloss`.
 *
 * Falls back to the prose value wherever the two shapes disagree (a missing
 * counterpart, a different array length, a type mismatch). A half-merged
 * entry in one language is always better than a crash or a blank: the data is
 * generated per language and could in principle drift.
 */
export function mergeGlossLanguage<T>(prose: T, gloss: T | null | undefined): T {
  if (gloss == null) return prose;
  return mergeNode(prose, gloss) as T;
}

function mergeNode(prose: unknown, gloss: unknown): unknown {
  if (Array.isArray(prose)) {
    if (!Array.isArray(gloss)) return prose;
    return prose.map((item, i) => (i < gloss.length ? mergeNode(item, gloss[i]) : item));
  }

  if (isPlainObject(prose)) {
    if (!isPlainObject(gloss)) return prose;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(prose)) {
      const other = gloss[key];
      if (GLOSS_KEYS.has(key)) {
        // Take the translation, but only if the other side actually has one.
        out[key] = typeof other === "string" && other.trim() !== "" ? other : value;
      } else {
        out[key] = mergeNode(value, other);
      }
    }
    return out;
  }

  // Primitives: prose language wins (Russian literals are identical anyway).
  return prose;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * How the sheet picks its two languages.
 *
 * `mixed` is the default because it matches how people actually study a third
 * language through a second one: you want the meaning of a word in the
 * language you already think in for vocabulary, and the grammar explained in
 * your strongest language. `front` is for anyone who would rather have one
 * language throughout.
 */
export type ExplainLangMode = "mixed" | "front";

export interface ExplainLangs {
  /** Chunk supplying explanations (notes, key points, etymology...). */
  prose: string;
  /** Chunk supplying translations (`gloss` fields). */
  gloss: string;
}

/**
 * Resolve which chunk supplies what.
 *
 * `uiLang` only participates when the chunks actually exist in it — a
 * ru-interface learner of Russian has no ru explanation chunk, and silently
 * falling back to the front language is better than an empty sheet.
 */
export function resolveExplainLangs(
  mode: ExplainLangMode,
  frontLang: string,
  uiLang: string,
  available: (lang: string) => boolean,
): ExplainLangs {
  const glossLang = available(frontLang) ? frontLang : uiLang;
  if (mode === "front") return { prose: glossLang, gloss: glossLang };
  const proseLang = available(uiLang) ? uiLang : glossLang;
  return { prose: proseLang, gloss: glossLang };
}
