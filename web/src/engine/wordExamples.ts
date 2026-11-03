// LINGO-068 — "この語を使う例文": example sentences for ONE word.
//
// Katsuta asked for this in place of the sheet's 会話での返し ("how you'd
// reply"): when you are looking at a word, what you want is the word at work,
// in more than one shape — a different case, a different tense, a different
// context.
//
// Two sources, deliberately in this order:
//
//  1. The DECK's own sentences containing the word. These are the sentences
//     the learner is actually taught, they always carry a real translation,
//     and seeing "oh, this is that card" is worth more than a fresh example.
//  2. The v2 dictionary's generated examples (governance / aspect / per-form),
//     which exist for the 871 verb entries and are exactly where the variety
//     of case and tense lives.
//
// Neither source covers everything — see ai-org/Tasks/LINGO-068 for the
// measured gap — so `collectWordExamples` returns what exists and the caller
// decides what to show when it returns nothing.

import type { WordDictEntry } from "./explain";

export type ExampleSource =
  /** A sentence from the course itself. */
  | "deck"
  /** Dictionary: case/construction government. */
  | "governance"
  /** Dictionary: aspect-pair contrast. */
  | "aspect"
  /** Dictionary: one per inflected form. */
  | "form";

export interface WordExample {
  ru: string;
  gloss: string;
  source: ExampleSource;
  /** Deck examples only: lets the UI point at the card this is. */
  sentenceId?: string | null;
  /** What this example is showing ("+ instrumental", "past.f", ...). */
  slot?: string | null;
}

export interface DeckExampleInput {
  id: string;
  ru: string;
  gloss: string;
  /** True for the sentence the word is the teaching target of. */
  isTarget: boolean;
}

export interface CollectWordExamplesInput {
  deckSentences: DeckExampleInput[];
  entry: WordDictEntry | null;
  /** How many to return. Three is the brief; fewer when that is all there is. */
  limit?: number;
}

/** Collapse whitespace/case/punctuation so two spellings of one sentence do
 * not both take a slot. */
function key(ru: string): string {
  return ru.toLowerCase().replace(/[\s.,!?;:—–-]+/g, " ").trim();
}

/** Every glossed example the dictionary entry carries, grouped so the picker
 * can take one from each group before taking a second from any. */
export function dictExampleGroups(entry: WordDictEntry | null): WordExample[][] {
  if (!entry) return [];
  const groups: WordExample[][] = [];

  const governance = (entry.governance ?? [])
    .filter((g) => g.example?.ru && g.example?.gloss)
    .map<WordExample>((g) => ({
      ru: g.example.ru,
      gloss: g.example.gloss,
      source: "governance",
      slot: g.pattern,
    }));
  if (governance.length) groups.push(governance);

  // One group PER aspect side, so a pair contributes one example of each
  // rather than two of the imperfective.
  for (const a of entry.aspectExamples ?? []) {
    const items = (a.examples ?? [])
      .filter((e) => e.ru && e.gloss)
      .map<WordExample>((e) => ({ ru: e.ru, gloss: e.gloss, source: "aspect", slot: a.aspect }));
    if (items.length) groups.push(items);
  }

  // Forms are grouped by tense/mood (past / nonpast / imperative), which is
  // precisely the "different tense" variety this feature is for.
  const byGroup = new Map<string, WordExample[]>();
  for (const [slot, ex] of Object.entries(entry.formExamples ?? {})) {
    if (!ex?.ru || !ex?.gloss) continue;
    const g = slot.split(".")[0];
    const list = byGroup.get(g) ?? [];
    list.push({ ru: ex.ru, gloss: ex.gloss, source: "form", slot });
    byGroup.set(g, list);
  }
  for (const list of byGroup.values()) groups.push(list);

  return groups;
}

/**
 * Pick the examples to show, in display order.
 *
 * The target sentence leads when there is one — it is the card this word was
 * taught on, and recognising it is the point. After that the picker takes one
 * example from each dictionary group in turn (round-robin), so three slots
 * spend themselves on three DIFFERENT things rather than three past-tense
 * forms. Remaining deck sentences fill anything left over.
 */
export function collectWordExamples(input: CollectWordExamplesInput): WordExample[] {
  const limit = input.limit ?? 3;
  const out: WordExample[] = [];
  const seen = new Set<string>();

  const push = (ex: WordExample): boolean => {
    const k = key(ex.ru);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    out.push(ex);
    return out.length >= limit;
  };

  const deck = input.deckSentences.filter((d) => d.ru && d.gloss);
  const target = deck.find((d) => d.isTarget);
  const rest = deck.filter((d) => d !== target);
  const asExample = (d: DeckExampleInput): WordExample => ({
    ru: d.ru,
    gloss: d.gloss,
    source: "deck",
    sentenceId: d.id,
  });

  if (target && push(asExample(target))) return out;

  // Round-robin across the dictionary groups.
  const groups = dictExampleGroups(input.entry);
  for (let i = 0; groups.some((g) => i < g.length); i++) {
    for (const g of groups) {
      if (i >= g.length) continue;
      if (push(g[i])) return out;
    }
  }

  for (const d of rest) {
    if (push(asExample(d))) return out;
  }
  return out;
}
