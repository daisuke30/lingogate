// LINGO-068 — finding the deck's own sentences for one word.
//
// engine/wordExamples.ts decides WHICH examples to show; this finds the raw
// material in the loaded deck. Separate because the deck scan is the only part
// that touches runtime state, and because it is the part with a cost: the RU
// deck is 2,983 sentences and the sheet asks this question on every open.

import { DECK, WORD_BY_ID } from "./service";
import type { DeckExampleInput } from "../engine/wordExamples";
import type { Sentence } from "../engine/content";

/** The front-language text of a sentence, plus the UI language when it differs
 * — the same mixing rule the rest of the sheet uses (LINGO-062). */
function glossOf(s: Sentence, frontLang: string, uiLang: string): string {
  const pick = (l: string) => (l === "en" ? s.en : l === "ja" ? s.ja : null);
  const parts: string[] = [];
  for (const l of [frontLang, uiLang, "en"]) {
    const g = pick(l);
    if (g && g.trim() && !parts.includes(g)) parts.push(g);
  }
  return parts.join(" / ");
}

/**
 * Deck sentences containing `lemma`, target sentence first.
 *
 * Capped at `max` because the only consumer shows at most three and the scan
 * is the expensive part — there is no reason to collect 40 matches for одна
 * and throw 37 away.
 */
export function deckSentencesForLemma(
  lemma: string,
  frontLang: string,
  uiLang: string,
  max = 6,
): DeckExampleInput[] {
  // Resolve the lemma to its deck id once; comparing ids beats comparing
  // strings 2,983 x 8 times.
  let wordId: number | null = null;
  for (const w of WORD_BY_ID.values()) {
    if (w.lemma === lemma) {
      wordId = w.id;
      break;
    }
  }
  if (wordId == null) return [];

  const out: DeckExampleInput[] = [];
  for (const s of DECK.sentences) {
    if (!s.wordIds.includes(wordId)) continue;
    out.push({
      id: s.id,
      ru: s.ru,
      gloss: glossOf(s, frontLang, uiLang),
      isTarget: s.targetLemma === lemma,
    });
    // One target plus a few alternates is all the picker can use; stop early
    // once we certainly have enough, but never before finding the target.
    if (out.length >= max && out.some((d) => d.isTarget)) break;
  }
  out.sort((a, b) => Number(b.isTarget) - Number(a.isTarget));
  return out.slice(0, max);
}
