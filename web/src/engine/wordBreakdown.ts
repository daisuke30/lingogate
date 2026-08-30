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
  /** LINGO-025: genuinely biaspectual verb label (両体動詞). */
  both: string;
  /** Word for "counterpart / pair" (e.g. 対 / pair / пара). */
  pair: string;
  /** LINGO-025: word for a non-strict related verb (e.g. 関連 / related /
   * связано) — used both for pairKind="related" (⇔ arrow) and for
   * pairKind="none" rows that still surface a related word for reference. */
  related: string;
  /** LINGO-025: "no pair" (対なし). */
  noPair: string;
  /** LINGO-025: "always" (常に), composed with pf/impf for the noPair line
   * ("対なし・常に不完了体"). */
  always: string;
}

const DEFAULT_ASPECT_LABELS: AspectLabels = {
  pf: "完了体",
  impf: "不完了体",
  both: "両体動詞",
  pair: "対",
  related: "関連",
  noPair: "対なし",
  always: "常に",
};

/**
 * Human-readable aspect line for a verb entry. Every verb with a non-null
 * `aspect` always renders SOMETHING (Katsuta 2026-08-30: a bare "対なし" with
 * no further information is not acceptable — every verb must show its aspect
 * situation, never silently omit it). Three pairKind shapes (LINGO-025):
 *
 *   "pair"    — a standard textbook aspectual pair, both directions labelled
 *               (Katsuta feedback 2026-08-27: never leave the pair's own
 *               aspect unlabelled). e.g. "делать（不完了体） ⇔ 対: сделать
 *               （完了体）".
 *   "related" — a genuinely related but not strictly-paired verb (shifted
 *               meaning, e.g. знать→узнать, or a multidirectional/
 *               unidirectional motion counterpart). Same "⇔" shape as pair
 *               (its aspect really is the opposite — see LINGO-025 audit) but
 *               labelled 関連 instead of 対, plus the nuance note. e.g.
 *               "знать（不完了体） ⇔ 関連: узнать（完了体）。узнать=知るよう
 *               になる（意味がずれた派生語）".
 *   "none"    — no aspectual partner exists at all. Always states the head's
 *               own (fixed) aspect explicitly ("対なし・常に不完了体") rather
 *               than a bare "no pair", and — when a merely-related word is
 *               worth mentioning (e.g. лежать's delimitative полежать) —
 *               appends it as a non-committal "関連:" mention, never a "⇔"
 *               (that arrow is reserved for pairKind pair/related, where the
 *               shown word really is aspectually opposite). e.g. "лежать
 *               （対なし・常に不完了体）。関連: полежать（しばらく横になる）".
 *
 * aspect="both" (genuinely biaspectual, e.g. организовать) shows its own
 * label with no pair machinery at all. Returns null only for non-verbs
 * (aspect null).
 */
export function formatAspectLine(
  entry: Pick<WordBreakdownEntry, "lemma" | "aspect" | "aspectPair" | "pairKind" | "pairNote">,
  labels: AspectLabels = DEFAULT_ASPECT_LABELS,
): string | null {
  if (!entry.aspect) return null;

  if (entry.aspect === "both") {
    const base = `${entry.lemma}（${labels.both}）`;
    return entry.pairNote ? `${base}。${entry.pairNote}` : base;
  }

  const own = `${entry.lemma}（${labels[entry.aspect]}）`;
  const oppAspect = entry.aspect === "impf" ? "pf" : "impf";

  if (entry.pairKind === "pair" && entry.aspectPair) {
    const base = `${own} ⇔ ${labels.pair}: ${entry.aspectPair}（${labels[oppAspect]}）`;
    return entry.pairNote ? `${base}。${entry.pairNote}` : base;
  }
  if (entry.pairKind === "related" && entry.aspectPair) {
    const base = `${own} ⇔ ${labels.related}: ${entry.aspectPair}（${labels[oppAspect]}）`;
    return entry.pairNote ? `${base}。${entry.pairNote}` : base;
  }
  // pairKind "none" (also the fallback for any legacy/unmigrated row that has
  // an aspect but no pairKind — never silently drop to a bare aspect-only line).
  const base = `${entry.lemma}（${labels.noPair}・${labels.always}${labels[entry.aspect]}）`;
  if (entry.aspectPair) {
    const noted = entry.pairNote ? `${entry.aspectPair}（${entry.pairNote}）` : entry.aspectPair;
    return `${base}。${labels.related}: ${noted}`;
  }
  return entry.pairNote ? `${base}。${entry.pairNote}` : base;
}

/** Labels for the five noun-gender codes (LINGO-022). UI-language driven,
 * same as AspectLabels — see i18n keys gender.m / gender.f / gender.n /
 * gender.pl / gender.mf. */
export interface GenderLabels {
  m: string;
  f: string;
  n: string;
  pl: string;
  mf: string;
}

const DEFAULT_GENDER_LABELS: GenderLabels = {
  m: "男性名詞",
  f: "女性名詞",
  n: "中性名詞",
  pl: "複数のみ",
  mf: "通性名詞",
};

/**
 * Human-readable gender line for a noun entry, e.g. "книга（女性名詞）"
 * (Katsuta 2026-08-29: show the noun's grammatical gender on the card back).
 * Mirrors formatAspectLine's "lemma（label）" shape so the breakdown reads
 * uniformly. Returns null for non-nouns / entries with no gender.
 */
export function formatGenderLine(
  entry: Pick<WordBreakdownEntry, "lemma" | "gender">,
  labels: GenderLabels = DEFAULT_GENDER_LABELS,
): string | null {
  if (!entry.gender) return null;
  return `${entry.lemma}（${labels[entry.gender]}）`;
}

export interface WordBreakdownEntry {
  lemma: string;
  pos: string;
  posLabel: string;
  aspect: "pf" | "impf" | "both" | null;
  aspectPair: string | null;
  /** LINGO-025: see formatAspectLine doc comment. Null for non-verbs. */
  pairKind: "pair" | "related" | "none" | null;
  /** LINGO-025: short ja nuance note for pairKind related/none. Null for non-verbs. */
  pairNote: string | null;
  /** Noun grammatical gender (LINGO-022); null for non-nouns. */
  gender: "m" | "f" | "n" | "pl" | "mf" | null;
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
      pairKind: w.pairKind ?? null,
      pairNote: w.pairNote ?? null,
      gender: w.gender ?? null,
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
