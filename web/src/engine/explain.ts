// LINGO-057 — the "解説" (explanation) sheet's pure logic.
//
// The data shapes mirror the LINGO-056 contract exactly (see
// ai-org/Tasks/LINGO-056-dictionary-generation.md §スキーマ, declared fixed).
// Nothing here fetches or renders; state/explain.ts does the loading and
// ui/ExplainSheet.tsx the drawing, so the one judgement call in this feature —
// how much of each word to show — stays unit-testable.

import type { KnowledgeMap } from "./calibration";

// MARK: schema (LINGO-056 contract)

export interface WordDictForms {
  past?: Record<string, string>;
  nonpast?: Record<string, string>;
  imperative?: Record<string, string>;
  sg?: Record<string, string>;
  m?: string;
  f?: string;
  n?: string;
  pl?: string;
}

export interface WordDictEntry {
  lemma: string;
  pos: string;
  /** null for parts of speech with no inflection table (adv/prep/conj/...). */
  forms: WordDictForms | null;
  /** Verbs only — how this aspect pairs with its partner. null otherwise. */
  aspectUsage: string | null;
  etymology: string;
  related: string[];
  collocations: string[];
  commonMistakes: string;

  // MARK: v2 (LINGO-059) — additive, optional, verbs only. Absent on entries
  // not yet enriched and on every non-verb entry (nouns/adjectives/etc. are
  // out of LINGO-059's scope). A v1-only consumer ignores these safely.

  /** Case/construction government, e.g. "+ instrumental", with an example. */
  governance?: { pattern: string; example: { ru: string; gloss: string } }[];
  /** Aspect-pair usage contrast, 2 examples per aspect side (1 side if the
   * verb has no true perfective/imperfective partner). */
  aspectExamples?: {
    aspect: "impf" | "pf" | "both";
    lemma: string;
    examples: { ru: string; gloss: string }[];
  }[];
  /** Near-synonym comparison (e.g. казаться vs выглядеть). Omitted or empty
   * when no comparison is applicable for this lemma. */
  synonymComparison?: { lemma: string; note: string }[];
  /** One short example per populated form in `forms`, keyed as
   * "<group>.<key>" (e.g. "past.m", "nonpast.3sg", "imperative.sg").
   * Defective forms (value "—" in `forms`) have no entry here. */
  formExamples?: Record<string, { ru: string; gloss: string }>;
}

export interface SentenceCommentaryEntry {
  id: string;
  skeleton: { surface: string; note: string }[];
  keyPoint: string;
  replies: { ru: string; gloss: string }[];

  // MARK: v2 (LINGO-059) — additive, optional. Absent on sentences not yet
  // enriched. A v1-only consumer ignores these safely.

  /** The sentence's headline grammar point — case government / construction. */
  grammarFocus?: { construction: string; note: string };
  /** Gender/number variants of this same sentence (at least one). */
  variations?: { ru: string; note: string }[];
  /** 2-3 natural paraphrase options plus which one is simplest in conversation. */
  paraphrases?: { options: { ru: string; note: string }[]; simplest: string };
  /** The one high-frequency pattern worth memorizing from this sentence. */
  takeaway?: { pattern: string; note: string };
}

export type WordDict = Record<string, WordDictEntry>;
export type SentenceCommentary = Record<string, SentenceCommentaryEntry>;

// MARK: display density (Katsuta-approved, 2026-10-17)

/**
 * How much of a word's dictionary entry to show on first open.
 *
 * A full entry is a lot of text — forms table, etymology, collocations,
 * mistakes — and a sentence has five to eight words. Printing all of them
 * expanded turns the one thing the learner actually wondered about into a
 * needle in a haystack. So the sheet opens showing only what this learner
 * plausibly does not know:
 *
 *  - `target`    the word this sentence exists to teach. Always fully open,
 *                always first: it is the answer to "why am I being shown this
 *                sentence at all".
 *  - `expanded`  words they have not judged as known. These are the ones a
 *                question is likely about.
 *  - `collapsed` words they told us they know, and the handful of ultra-high
 *                -frequency function words (и, в, не...) that every learner
 *                meets in week one. One line each, tappable — never deleted,
 *                because "I know this word" is a claim that can be wrong and
 *                the entry has to stay reachable when it is.
 */
export type ExplainDensity = "target" | "expanded" | "collapsed";

/**
 * Frequency rank at or below which a FUNCTION word is collapsed by default.
 *
 * Deliberately small. These are the words that appear in nearly every
 * sentence in the deck, so leaving them expanded would mean the same three
 * paragraphs about «и» at the top of every explanation the learner ever
 * opens. Content words are never collapsed on frequency alone, however
 * common — "to be able to" is frequent AND worth reading about.
 */
export const COLLAPSED_FUNCTION_WORD_RANK = 100;

const FUNCTION_WORD_POS = new Set(["prep", "conj", "part", "pron", "det", "num"]);

export interface WordDensityInput {
  lemma: string;
  pos: string;
  /** Frequency rank from the deck; null when unknown (never collapsed on rank). */
  rank: number | null;
  isTarget: boolean;
  knowledge: KnowledgeMap;
}

export function wordDensity(input: WordDensityInput): ExplainDensity {
  if (input.isTarget) return "target";
  if (input.knowledge.get(input.lemma) === "known") return "collapsed";
  if (
    FUNCTION_WORD_POS.has(input.pos) &&
    input.rank != null &&
    input.rank <= COLLAPSED_FUNCTION_WORD_RANK
  ) {
    return "collapsed";
  }
  return "expanded";
}

/**
 * Order the sentence's words for the sheet: the target word first, then the
 * rest in the order they appear in the sentence (so the list reads alongside
 * the sentence instead of being re-sorted into something the learner has to
 * re-find).
 *
 * Generic over the whole item, not just its entry, so a caller can carry extra
 * per-word display data through (the deck glosses, for instance) without this
 * function needing to know about it.
 */
export function orderExplainWords<T extends { density: ExplainDensity }>(words: T[]): T[] {
  const target = words.filter((w) => w.density === "target");
  const rest = words.filter((w) => w.density !== "target");
  return [...target, ...rest];
}

/** A sentence has an explanation only when a commentary entry exists for its
 * id. EN/TH/JA courses have none today, and even on RU a missing entry must
 * hide the button rather than open an empty sheet. */
export function hasExplanation(
  sentenceId: string,
  commentary: SentenceCommentary | null,
): boolean {
  return !!commentary && Object.prototype.hasOwnProperty.call(commentary, sentenceId);
}
