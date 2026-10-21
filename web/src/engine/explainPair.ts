// LINGO-060 — the aspect partner inside the explanation sheet.
//
// Katsuta's request: when a sentence uses a perfective verb, the explanation
// should also carry its imperfective partner (and vice versa). Russian aspect
// is learned as a PAIR — сказать is only meaningful against говорить — so an
// entry that shows one half is teaching half a word.
//
// Nothing is regenerated for this: the partner's lemma is already on the deck
// word (LINGO-025's aspectPair/pairKind), and its full entry is usually
// already in the same dictionary chunk. This module is the pure lookup, kept
// out of the component so the "what if the partner is missing?" branch is
// testable — and it is not a rare branch: 43% of paired verbs have no entry
// for their partner (see explainPair.test.ts, which pins that number).

import type { WordDictEntry, WordDict } from "./explain";

export type PairAspect = "pf" | "impf" | null;

/** How much we can say about the partner. */
export type PairDepth = "full" | "brief";

export interface AspectPairRef {
  lemma: string;
  /** The partner's aspect, inferred as the opposite of the source verb's. */
  aspect: PairAspect;
  /** `full` when the dictionary has the partner; `brief` when all we have is
   * the lemma, its aspect and whatever note the source verb carries. */
  depth: PairDepth;
  /** The partner's dictionary entry; null when depth is "brief". */
  entry: WordDictEntry | null;
  /** The partner's gloss from the deck, when the deck happens to know it. */
  gloss: string | null;
  /** LINGO-025 classification of the relationship. */
  pairKind: "pair" | "related" | "none" | null;
}

/**
 * Aspect of the partner. A pair is by definition one of each, so the source
 * verb's aspect determines it. `both` (genuinely biaspectual) and null give
 * null: we do not know, and guessing would put a wrong label on a real word.
 */
export function oppositeAspect(aspect: string | null | undefined): PairAspect {
  if (aspect === "pf") return "impf";
  if (aspect === "impf") return "pf";
  return null;
}

/** The source verb as the deck records it. Fields are optional to match
 * DeckWord, where everything past lemma/pos/rank/band is. */
export interface PairSource {
  pos: string;
  aspect?: string | null;
  aspectPair?: string | null;
  pairKind?: "pair" | "related" | "none" | null;
}

/**
 * Resolve the partner to show under a verb, or null when there is nothing
 * worth showing.
 *
 * `pairKind: "none"` is excluded deliberately. LINGO-025 uses it for verbs
 * where the data carries a nearby verb but it is NOT an aspect partner
 * (быть/побыть, for instance) — presenting that as "the pair" would teach a
 * relationship the language does not have, which is worse than showing
 * nothing.
 */
export function resolveAspectPair(
  source: PairSource,
  dict: WordDict | null,
  glossOf?: (lemma: string) => string | null,
): AspectPairRef | null {
  if (source.pos !== "verb") return null;
  const lemma = source.aspectPair;
  if (!lemma) return null;
  if (source.pairKind === "none") return null;

  const entry = dict?.[lemma] ?? null;
  return {
    lemma,
    aspect: oppositeAspect(source.aspect),
    depth: entry ? "full" : "brief",
    entry,
    gloss: glossOf?.(lemma) ?? null,
    pairKind: source.pairKind ?? null,
  };
}

/**
 * Every partner lemma that has no dictionary entry — the backlog for data
 * completion. Returned sorted and de-duplicated so a report diffs cleanly
 * between runs.
 */
export function collectMissingPairLemmas(
  verbs: (PairSource & { lemma: string })[],
  dict: WordDict,
): string[] {
  const missing = new Set<string>();
  for (const v of verbs) {
    if (!dict[v.lemma]) continue; // the verb itself isn't in the dictionary
    const pair = resolveAspectPair(v, dict);
    if (pair && pair.depth === "brief") missing.add(pair.lemma);
  }
  return [...missing].sort();
}
