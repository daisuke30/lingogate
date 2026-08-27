// Card-back "word breakdown" list (LINGO-012): for each linked word in a
// sentence, show its dictionary form, part of speech, verb aspect (+ aspect
// pair), and EN/JA gloss — the vocabulary support a learner needs to actually
// parse the sentence instead of just memorising it whole.
//
// Function words (particle/preposition/conjunction/pronoun/determiner) are
// omitted from *sentence* cards: by the time a learner reaches band1 core
// content these are near-universally already known (LINGO-011's
// target-word-driven sentences deliberately wrap the new word in
// higher-frequency vocabulary — that's the whole "1 card = 1 new element"
// design), so re-explaining "и = and" on every single card is pure noise
// working against the "fits in the card's scroll area" constraint. The
// sentence's own targetLemma is always shown regardless of its part of
// speech — it's the entire point of the card. Word-kind cards (vocabulary
// cards imported from lessons/notes) have no such target/support
// distinction — every linked word *is* the point of the card — so nothing is
// filtered there.

import type { DeckWord, Sentence } from "./content";

const POS_LABELS: Record<string, string> = {
  verb: "動詞",
  noun: "名詞",
  adj: "形容詞",
  adv: "副詞",
  num: "数詞",
  predic: "述語",
  pron: "代名詞",
  det: "限定詞",
  prep: "前置詞",
  conj: "接続詞",
  part: "助詞",
};

/** Parts of speech dropped from a *sentence* card's breakdown, unless the
 * word is that sentence's target. See module doc comment for rationale. */
const FUNCTION_POS = new Set(["part", "prep", "conj", "pron", "det"]);

export function posLabel(pos: string): string {
  return POS_LABELS[pos] ?? pos;
}

export interface AspectLabels {
  pf: string;
  impf: string;
  /** Word for "counterpart / pair" (e.g. 対 / pair / пара). */
  pair: string;
}

const DEFAULT_ASPECT_LABELS: AspectLabels = {
  pf: "完了体",
  impf: "不完了体",
  pair: "対",
};

/**
 * Human-readable aspect line for a verb entry, with BOTH the head word and its
 * pair explicitly labelled so it is never ambiguous which verb each aspect
 * names (Katsuta feedback 2026-08-27: the old "不完了体 ⇔ 対: сделать" left the
 * bare label floating — a reader could not tell whether it described the head
 * word or its pair). The pair's aspect is derived as the opposite of the head's
 * (an aspect pair is by definition one pf + one impf), so we never need to
 * store it. e.g. "делать（不完了体） ⇔ 対: сделать（完了体）". A verb with no
 * pair shows just its own labelled form ("быть（不完了体）"). Returns null for
 * non-verbs / aspectless entries.
 */
export function formatAspectLine(
  entry: Pick<WordBreakdownEntry, "lemma" | "aspect" | "aspectPair">,
  labels: AspectLabels = DEFAULT_ASPECT_LABELS,
): string | null {
  if (!entry.aspect) return null;
  const own = `${entry.lemma}（${labels[entry.aspect]}）`;
  if (!entry.aspectPair) return own;
  const oppAspect = entry.aspect === "impf" ? "pf" : "impf";
  return `${own} ⇔ ${labels.pair}: ${entry.aspectPair}（${labels[oppAspect]}）`;
}

export interface WordBreakdownEntry {
  lemma: string;
  pos: string;
  posLabel: string;
  aspect: "pf" | "impf" | null;
  aspectPair: string | null;
  enGloss: string | null;
  jaGloss: string | null;
  ruGloss: string | null;
  /** This is the sentence's target_lemma (LINGO-011) — the new element the
   * card exists to teach. Always included and always sorted first. */
  isTarget: boolean;
}

/** Build the ordered breakdown list for one card's back face: the target
 * word (if any) first, then the remaining linked, non-function-word entries
 * in their original (roughly text) order — word-kind cards keep every linked
 * word, function words included, since there's no target/support split. */
export function buildWordBreakdown(
  sentence: Pick<Sentence, "kind" | "targetLemma" | "wordIds">,
  wordById: Map<number, DeckWord>,
): WordBreakdownEntry[] {
  const out: WordBreakdownEntry[] = [];
  for (const wid of sentence.wordIds) {
    const w = wordById.get(wid);
    if (!w) continue;
    const isTarget = sentence.kind === "sentence" && w.lemma === sentence.targetLemma;
    if (sentence.kind === "sentence" && !isTarget && FUNCTION_POS.has(w.pos)) continue;
    out.push({
      lemma: w.lemma,
      pos: w.pos,
      posLabel: posLabel(w.pos),
      aspect: w.aspect ?? null,
      aspectPair: w.aspectPair ?? null,
      enGloss: w.enGloss ?? null,
      jaGloss: w.jaGloss ?? null,
      ruGloss: w.ruGloss ?? null,
      isTarget,
    });
  }
  // Stable sort: only reorders target-vs-rest, preserves original order within each group.
  out.sort((a, b) => (a.isTarget === b.isTarget ? 0 : a.isTarget ? -1 : 1));
  return out;
}
