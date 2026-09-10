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
  // LINGO-026: was missing entirely (no i18n key either) — 38 RU words
  // (спасибо, привет, пожалуйста...) fell through to the raw "intj" string.
  intj: "感動詞",
  // LINGO-039: Thai noun classifier (類別詞). Deliberately NOT added to
  // FUNCTION_POS below — a classifier carries real information a learner needs
  // (which one a given noun takes), unlike the particles/prepositions that
  // list exists to suppress.
  classifier: "類別詞",
};

/** Parts of speech dropped from a *sentence* card's breakdown, unless the
 * word is that sentence's target. See module doc comment for rationale. */
const FUNCTION_POS = new Set(["part", "prep", "conj", "pron", "det"]);

/**
 * LINGO-037: the breakdown lines are COMPOSED here from a label plus the
 * learner's own lemma, and the glue between them used to be hardcoded CJK
 * punctuation (（）。・) regardless of UI language — so an English or Russian
 * UI got "делать（imperfective） ⇔ pair: сделать（perfective）", full-width
 * Japanese brackets and an ideographic full stop around Latin/Cyrillic text.
 * That is the same class of bug LINGO-026 fixed inside the i18n catalog
 * (home.band.coverageValue / settings.buildAt), just one layer down.
 *
 * The glue therefore follows the UI language like every other structural
 * label: full-width and space-less for ja (correct Japanese typography, and
 * unchanged for Katsuta's UI=ja setup), ASCII with the spacing Latin/Cyrillic
 * typography expects for en/ru.
 */
export interface Punct {
  /** Opens a parenthetical tag after a lemma. */
  open: string;
  /** Closes it. */
  close: string;
  /** Ends a clause before an appended free-text note. */
  stop: string;
  /** Joins two tags inside one parenthetical (e.g. "no pair" + "always impf"). */
  mid: string;
}

export const JA_PUNCT: Punct = { open: "（", close: "）", stop: "。", mid: "・" };
export const LATIN_PUNCT: Punct = { open: " (", close: ")", stop: ". ", mid: ", " };

/** Punctuation set for a UI language. ja keeps full-width; en/ru get ASCII. */
export function punctFor(uiLang: "ja" | "en" | "ru"): Punct {
  return uiLang === "ja" ? JA_PUNCT : LATIN_PUNCT;
}

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
export interface AspectLineEntry {
  lemma: string;
  aspect: "pf" | "impf" | "both" | null;
  aspectPair: string | null;
  pairKind: "pair" | "related" | "none" | null;
  /** LINGO-026: the nuance note ALREADY resolved to a single display string
   * for the current front/UI language (via engine/localizedText.ts's
   * resolveLocalizedText()) — this function has no opinion on language
   * fallback, it just renders whatever string it's handed. Deliberately an
   * inline type rather than `Pick<WordBreakdownEntry, ...>`: WordBreakdownEntry
   * itself carries the raw pairNoteJa/En/Ru triple, not a single resolved
   * value, so the two shapes are intentionally different. */
  pairNote: string | null;
}

export function formatAspectLine(
  entry: AspectLineEntry,
  labels: AspectLabels = DEFAULT_ASPECT_LABELS,
  p: Punct = JA_PUNCT,
): string | null {
  if (!entry.aspect) return null;

  if (entry.aspect === "both") {
    const base = `${entry.lemma}${p.open}${labels.both}${p.close}`;
    return entry.pairNote ? `${base}${p.stop}${entry.pairNote}` : base;
  }

  const own = `${entry.lemma}${p.open}${labels[entry.aspect]}${p.close}`;
  const oppAspect = entry.aspect === "impf" ? "pf" : "impf";

  if (entry.pairKind === "pair" && entry.aspectPair) {
    const base = `${own} ⇔ ${labels.pair}: ${entry.aspectPair}${p.open}${labels[oppAspect]}${p.close}`;
    return entry.pairNote ? `${base}${p.stop}${entry.pairNote}` : base;
  }
  if (entry.pairKind === "related" && entry.aspectPair) {
    const base = `${own} ⇔ ${labels.related}: ${entry.aspectPair}${p.open}${labels[oppAspect]}${p.close}`;
    return entry.pairNote ? `${base}${p.stop}${entry.pairNote}` : base;
  }
  // pairKind "none" (also the fallback for any legacy/unmigrated row that has
  // an aspect but no pairKind — never silently drop to a bare aspect-only line).
  const base = `${entry.lemma}${p.open}${labels.noPair}${p.mid}${labels.always}${labels[entry.aspect]}${p.close}`;
  if (entry.aspectPair) {
    const noted = entry.pairNote
      ? `${entry.aspectPair}${p.open}${entry.pairNote}${p.close}`
      : entry.aspectPair;
    return `${base}${p.stop}${labels.related}: ${noted}`;
  }
  return entry.pairNote ? `${base}${p.stop}${entry.pairNote}` : base;
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
  p: Punct = JA_PUNCT,
): string | null {
  if (!entry.gender) return null;
  return `${entry.lemma}${p.open}${labels[entry.gender]}${p.close}`;
}

/** Labels for the case-in-text line (LINGO-033). `form` is the leading
 * "文中の形:" / "form in the sentence:" / "форма в тексте:" prefix; case1..6
 * are the full "N格・和名" / "case N (english)" / "русское (N-й)" labels for
 * each of the 6 RU cases. UI-language driven, same convention as
 * AspectLabels/GenderLabels — see i18n keys case.form / case.1 .. case.6. */
export interface CaseLabels {
  form: string;
  case1: string;
  case2: string;
  case3: string;
  case4: string;
  case5: string;
  case6: string;
}

const DEFAULT_CASE_LABELS: CaseLabels = {
  form: "文中の形",
  case1: "1格・主格",
  case2: "2格・生格",
  case3: "3格・与格",
  case4: "4格・対格",
  case5: "5格・造格",
  case6: "6格・前置格",
};

/**
 * "文中の形" line for a noun/adjective/pronoun entry whose inflected surface
 * form in this specific sentence pymorphy3 could confidently resolve to a
 * case (LINGO-033), e.g. "文中の形: книгу（4格・対格）" for книга used as
 * "Я читаю книгу" (I read a/the book). Mirrors formatGenderLine/
 * formatAspectLine's "label: value（tag）" shape. Returns null when this
 * entry has no resolved case (ambiguous tokens are never guessed — see
 * pipeline/rebaseline/annotate_cases.py's quality gate — or the entry's
 * surface form is identical to its dictionary lemma, in which case showing
 * "文中の形" would be redundant noise).
 */
export function formatCaseLine(
  entry: Pick<WordBreakdownEntry, "lemma" | "caseForm">,
  labels: CaseLabels = DEFAULT_CASE_LABELS,
  p: Punct = JA_PUNCT,
): string | null {
  if (!entry.caseForm) return null;
  const { surface, case: c } = entry.caseForm;
  if (surface === entry.lemma) return null;
  const caseLabel = labels[`case${c}` as keyof CaseLabels];
  return `${labels.form}: ${surface}${p.open}${caseLabel}${p.close}`;
}

export interface WordBreakdownEntry {
  lemma: string;
  pos: string;
  posLabel: string;
  aspect: "pf" | "impf" | "both" | null;
  aspectPair: string | null;
  /** LINGO-025: see formatAspectLine doc comment. Null for non-verbs. */
  pairKind: "pair" | "related" | "none" | null;
  /** LINGO-026: raw ja/en/ru nuance-note triple for pairKind related/none
   * (null for non-verbs). NOT for direct rendering — resolve to one string
   * via engine/localizedText.ts's resolveLocalizedText() first (see
   * AspectLineEntry.pairNote), the same front→UI→en→ja chain used for
   * Sentence.note. Named with the "Ja/En/Ru" suffix (rather than a bare
   * `pairNote`, which used to be the single ja-only field before LINGO-026)
   * so a call site can't accidentally render the untranslated raw value. */
  pairNoteJa: string | null;
  pairNoteEn: string | null;
  pairNoteRu: string | null;
  /** Noun grammatical gender (LINGO-022); null for non-nouns. */
  gender: "m" | "f" | "n" | "pl" | "mf" | null;
  /** LINGO-033: this word's resolved case/number as it actually appears in
   * THIS sentence (e.g. книга used as "книгу" -> {surface:"книгу", case:4,
   * number:"sg"}), or null when pymorphy3 couldn't confidently resolve it
   * (never guessed) or this word isn't a noun/adjective/pronoun. */
  caseForm: { surface: string; case: 1 | 2 | 3 | 4 | 5 | 6; number: "sg" | "pl" } | null;
  enGloss: string | null;
  jaGloss: string | null;
  ruGloss: string | null;
  /** LINGO-039: pronunciation transcription of this headword (Paiboon
   * romanization on the TH pack; null on RU/EN). Gate rendering through
   * engine/localizedText.ts's pronunciationReadable(), same as
   * Sentence.kana — the script is the course's choice. */
  kana: string | null;
  /** This is the sentence's target_lemma (LINGO-011) — the new element the
   * card exists to teach. Always included and always sorted first. */
  isTarget: boolean;
}

/** Build the ordered breakdown list for one card's back face: the target
 * word (if any) first, then the remaining linked, non-function-word entries
 * in their original (roughly text) order — word-kind cards keep every linked
 * word, function words included, since there's no target/support split. */
export function buildWordBreakdown(
  sentence: Pick<Sentence, "kind" | "targetLemma" | "wordIds" | "forms">,
  wordById: Map<number, DeckWord>,
): WordBreakdownEntry[] {
  // LINGO-033: consumed left-to-right and removed as matched, so a lemma
  // repeated across two wordIds (rare) pairs each with a distinct forms[]
  // entry instead of both showing the same (first) resolved case.
  const remainingForms = (sentence.forms ?? []).slice();
  function takeCaseForm(lemma: string) {
    const idx = remainingForms.findIndex((f) => f.lemma === lemma);
    if (idx === -1) return null;
    const [f] = remainingForms.splice(idx, 1);
    return { surface: f.surface, case: f.case, number: f.number };
  }

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
      pairNoteJa: w.pairNote ?? null,
      pairNoteEn: w.pairNoteEn ?? null,
      pairNoteRu: w.pairNoteRu ?? null,
      gender: w.gender ?? null,
      caseForm: takeCaseForm(w.lemma),
      enGloss: w.enGloss ?? null,
      jaGloss: w.jaGloss ?? null,
      ruGloss: w.ruGloss ?? null,
      kana: w.kana ?? null,
      isTarget,
    });
  }
  // Stable sort: only reorders target-vs-rest, preserves original order within each group.
  out.sort((a, b) => (a.isTarget === b.isTarget ? 0 : a.isTarget ? -1 : 1));
  return out;
}
