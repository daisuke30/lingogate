// LINGO-067 — assembling the vocabulary list from storage.
//
// Maps the course's words, the learner's judgements and their review states
// into the flat rows engine/vocabulary.ts defines. Lives here (not in the
// component) so the screen can stay a renderer, and so the two expensive
// steps — walking every sentence once for each lemma's review state, and
// deriving the mastered set — happen in one place.
//
// Read-only throughout: this screen never writes a judgement or a review
// state. It is a window onto existing data, and nothing a learner does here
// can alter what the level check decided or what study recorded.

import { DECK, loadStore, activeCourse, activeFrontLanguage } from "./service";
import { getAllWordKnowledge } from "../db/idb";
import { buildVocabList } from "../engine/vocabulary";
import type { VocabRow, VocabWordInput } from "../engine/vocabulary";
import type { ReviewState } from "../engine/fsrs";
import { MASTERY_FRAME_MAX_BAND } from "../engine/mastery";
import type { Lang } from "../content/courses";

/**
 * The steps the list covers: bands 1-3, i.e. exactly the 3000-word frame the
 * home screen measures against (mastery.ts MASTERY_FRAME_MAX_BAND). Band 4 is
 * the retired pool and is deliberately absent — listing it would show the
 * learner words the app itself does not count.
 */
export const VOCAB_BANDS = Array.from({ length: MASTERY_FRAME_MAX_BAND }, (_, i) => i + 1);

/**
 * Glosses, mixed the way the explanation sheet mixes them (LINGO-062): the
 * front language first, the UI language after, so Katsuta — who learns words
 * in English and reads the app in Japanese — gets "check / 確認する" rather
 * than one or the other.
 */
function glossFor(w: VocabWordInput, frontLang: string, uiLang: string): string {
  const pick = (l: string) =>
    l === "en" ? w.enGloss : l === "ja" ? w.jaGloss : l === "ru" ? w.ruGloss : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of [frontLang, uiLang, "en"]) {
    const g = pick(l);
    if (g && g.trim() && !seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out.join(" / ");
}

export async function loadVocabList(uiLang: Lang): Promise<VocabRow[]> {
  const frontLang = activeFrontLanguage();
  // The store already holds the knowledge map and every review state, and it
  // owns the mastered-set definition. Only `updatedAt` — when a word was
  // judged, which the list needs for "最近変化した語" — is not in it, so the
  // raw rows are read alongside.
  const [store, knowledgeRows] = await Promise.all([
    loadStore(),
    getAllWordKnowledge(activeCourse()),
  ]);

  const knowledge = new Map(knowledgeRows.map((r) => [r.lemma, r.status]));
  const judgedAtByLemma = new Map(knowledgeRows.map((r) => [r.lemma, r.updatedAt]));
  const masteredLemmas = store.masteredLemmas();

  // A lemma's study progress lives on the sentences that teach it. One pass
  // over the deck builds lemma -> its most mature state; asking per word would
  // be 3,000 x 2,983 on the RU deck.
  const reviewByLemma = new Map<string, ReviewState>();
  for (const s of DECK.sentences) {
    if (!s.targetLemma) continue;
    const st = store.reviewState(s.id);
    if (!st) continue;
    const prev = reviewByLemma.get(s.targetLemma);
    if (!prev || (st.stability ?? 0) > (prev.stability ?? 0)) {
      reviewByLemma.set(s.targetLemma, st);
    }
  }

  const words: VocabWordInput[] = DECK.words
    .filter((w) => w.band <= MASTERY_FRAME_MAX_BAND)
    .map((w) => ({
      lemma: w.lemma,
      // Every band 1-3 word in every shipped deck carries a rank (verified
      // across ru/en/ja/th); the fallback only keeps an unranked word from
      // sorting to the front if that ever changes.
      rank: w.rank ?? Number.MAX_SAFE_INTEGER,
      band: w.band,
      pos: w.pos,
      enGloss: w.enGloss ?? null,
      jaGloss: w.jaGloss ?? null,
      ruGloss: w.ruGloss ?? null,
    }));

  return buildVocabList({
    words,
    knowledge,
    reviewByLemma,
    judgedAtByLemma,
    masteredLemmas,
    gloss: (w) => glossFor(w, frontLang, uiLang),
  });
}

/** The target sentence that teaches a lemma, for opening its explanation. */
export function targetSentenceIdFor(lemma: string): string | null {
  for (const s of DECK.sentences) {
    if (s.targetLemma === lemma) return s.id;
  }
  return null;
}
