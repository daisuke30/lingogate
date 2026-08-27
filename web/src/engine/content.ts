// In-memory content store over the build-time deck (deck.generated.json),
// mirroring the query logic of the Swift ContentStore that the flashcard flow
// relies on: dueReviews / newSentences / upcomingReviews, plus band coverage
// stats for the home screen. No SQLite at runtime — the whole band1 deck is a
// few hundred rows, so plain array scans are instant.

import type { ReviewState } from "./fsrs";
import { CardState } from "./fsrs";
import {
  CALIBRATION_FALLBACK_THRESHOLD,
  MAX_UNKNOWN_FOR_NEW,
  judgedCount,
  scoreSentence,
} from "./calibration";
import type { KnowledgeMap } from "./calibration";
import { masteryStats as computeMasteryStats, MASTERY_STABILITY_DAYS } from "./mastery";
import type { MasteryStats } from "./mastery";

export interface Sentence {
  id: string;
  ru: string;
  en: string;
  ja: string | null;
  kana: string | null;
  note: string | null;
  band: number;
  difficulty: number;
  source: string;
  kind: "sentence" | "word";
  /** The lemma this sentence is built to teach (LINGO-011); null for legacy rows. */
  targetLemma: string | null;
  /** Word ids this sentence covers (matched lemmas only). */
  wordIds: number[];
  /** Min frequency rank among covered words; null if none. New-card ordering key. */
  minRank: number | null;
  /** Real RU content-word count (LINGO-010 fix), vs. wordIds.length which only
   * counts lemmas that resolved to a deck word. undefined/null for synthetic
   * test sentences that don't set it — treated as "no unlinked words". */
  tokenCount?: number | null;
}

export interface DeckWord {
  id: number;
  lemma: string;
  rank: number | null;
  band: number;
  pos: string;
  /** English / Japanese / Russian gloss (LINGO-012 + LINGO-014); undefined/null
   * for synthetic test decks or glosses a course doesn't ship. ruGloss is only
   * populated for courses whose availableFrontLangs include "ru". */
  enGloss?: string | null;
  jaGloss?: string | null;
  ruGloss?: string | null;
  /** Verb aspect (LINGO-012): "pf" (perfective) | "impf" (imperfective) |
   * null for non-verbs and verbs with no true telic partner. */
  aspect?: "pf" | "impf" | null;
  /** The paired verb's lemma (opposite aspect), if one exists. */
  aspectPair?: string | null;
}

export interface Deck {
  code: string;
  name: string;
  targetLang: string;
  sourceLang: string;
  /** LINGO-014 course config (optional; absent on synthetic test decks). */
  courseId?: string;
  availableFrontLangs?: string[];
  defaultFrontLang?: string;
  grammarMeta?: string;
  bands: number[];
  words: DeckWord[];
  sentences: Sentence[];
}

export interface DueCard {
  state: ReviewState;
  sentence: Sentence;
}

export class ContentStore {
  readonly deck: Deck;
  private byId: Map<string, Sentence>;
  private states: Map<string, ReviewState>;
  private knowledge: KnowledgeMap;
  private wordById: Map<number, DeckWord>;
  private judged: number;

  constructor(deck: Deck, states: ReviewState[] = [], knowledge?: KnowledgeMap) {
    this.deck = deck;
    this.byId = new Map(deck.sentences.map((s) => [s.id, s]));
    this.states = new Map(states.map((s) => [s.sentenceId, s]));
    this.knowledge = knowledge ?? new Map();
    this.wordById = new Map(deck.words.map((w) => [w.id, w]));
    this.judged = judgedCount(this.knowledge);
  }

  sentence(id: string): Sentence | undefined {
    return this.byId.get(id);
  }

  reviewState(sentenceId: string): ReviewState | undefined {
    return this.states.get(sentenceId);
  }

  /** Due reviews for a band: state != new and due <= now, most overdue first. */
  dueReviews(band: number, now: number, limit: number): DueCard[] {
    const out: DueCard[] = [];
    for (const st of this.states.values()) {
      if (st.state === CardState.New) continue;
      if (st.due == null || st.due > now) continue;
      const s = this.byId.get(st.sentenceId);
      if (!s || s.band !== band) continue;
      out.push({ state: st, sentence: s });
    }
    out.sort((a, b) => (a.state.due! - b.state.due!) || cmp(a.sentence.id, b.sentence.id));
    return out.slice(0, limit);
  }

  /** New (never-studied) sentences for a band. Once the learner has judged enough
   * words (>= CALIBRATION_FALLBACK_THRESHOLD) the order is driven by the known-map:
   * only sentences with few unknown words are eligible, ordered by (unknown score,
   * target/lowest-unknown rank). Before that it falls back to plain frequency order
   * (the sentence teaching the most frequent not-yet-covered word first). */
  newSentences(band: number, excluding: Set<string>, limit: number): Sentence[] {
    const candidates = this.deck.sentences.filter(
      (s) => s.band === band && !this.states.has(s.id) && !excluding.has(s.id),
    );

    if (this.judged < CALIBRATION_FALLBACK_THRESHOLD) {
      candidates.sort((a, b) => {
        const ar = a.minRank ?? Number.MAX_SAFE_INTEGER;
        const br = b.minRank ?? Number.MAX_SAFE_INTEGER;
        return ar - br || cmp(a.id, b.id);
      });
      return candidates.slice(0, limit);
    }

    const scored = candidates
      .map((s) => ({ s, ...scoreSentence(s, this.knowledge, this.wordById) }))
      .filter((x) => x.unknownScore <= MAX_UNKNOWN_FOR_NEW);
    scored.sort(
      (a, b) => a.unknownScore - b.unknownScore || a.sortRank - b.sortRank || cmp(a.s.id, b.s.id),
    );
    return scored.slice(0, limit).map((x) => x.s);
  }

  /** Not-yet-due review cards, earliest due first — only to top up a short deck. */
  upcomingReviews(band: number, excluding: Set<string>, limit: number): DueCard[] {
    const out: DueCard[] = [];
    for (const st of this.states.values()) {
      if (st.state === CardState.New) continue;
      const s = this.byId.get(st.sentenceId);
      if (!s || s.band !== band || excluding.has(s.id)) continue;
      out.push({ state: st, sentence: s });
    }
    out.sort((a, b) => {
      const anull = a.state.due == null ? 1 : 0;
      const bnull = b.state.due == null ? 1 : 0;
      return anull - bnull || (a.state.due ?? 0) - (b.state.due ?? 0) || cmp(a.sentence.id, b.sentence.id);
    });
    return out.slice(0, limit);
  }

  // MARK: band coverage / retention stats (home screen)

  /** total band words, coverable (in ≥1 band sentence), studied (covered by a
   * sentence that has a ReviewState). Mirrors ContentStore.bandVocabStats. */
  bandVocabStats(band: number): { total: number; coverable: number; studied: number } {
    const bandWords = this.deck.words.filter((w) => w.band === band);
    const total = bandWords.length;
    const coverableIds = new Set<number>();
    const studiedIds = new Set<number>();
    for (const s of this.deck.sentences) {
      if (s.band !== band) continue;
      const studied = this.states.has(s.id);
      for (const wid of s.wordIds) {
        coverableIds.add(wid);
        if (studied) studiedIds.add(wid);
      }
    }
    // Restrict to band words only.
    const bandIds = new Set(bandWords.map((w) => w.id));
    let coverable = 0;
    let studied = 0;
    coverableIds.forEach((id) => bandIds.has(id) && coverable++);
    studiedIds.forEach((id) => bandIds.has(id) && studied++);
    return { total, coverable, studied };
  }

  /** "会話頻出3000語マスター" figures (LINGO-013): distinct mastered lemmas
   * (judged-known ∪ target words whose review stability ≥ threshold) across the
   * whole deck (all bands = the 3000-word universe), plus the interpolated
   * conversation-coverage % and level label. Delegates to the pure engine in
   * mastery.ts. */
  masteryStats(stabilityThresholdDays: number = MASTERY_STABILITY_DAYS): MasteryStats {
    const deckLemmas = new Set(this.deck.words.map((w) => w.lemma));
    return computeMasteryStats(
      this.deck.sentences,
      this.knowledge,
      this.states.values(),
      deckLemmas,
      stabilityThresholdDays,
    );
  }

  /** Retention proxy over band cards in the Review state: reps / (reps+lapses). */
  bandRetention(band: number): { reps: number; lapses: number; reviewCards: number } {
    let reps = 0;
    let lapses = 0;
    let reviewCards = 0;
    for (const st of this.states.values()) {
      if (st.state !== CardState.Review) continue;
      const s = this.byId.get(st.sentenceId);
      if (!s || s.band !== band) continue;
      reps += st.reps;
      lapses += st.lapses;
      reviewCards++;
    }
    return { reps, lapses, reviewCards };
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
