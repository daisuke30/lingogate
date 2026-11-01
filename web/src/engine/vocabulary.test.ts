// LINGO-067 — the vocabulary list's rules.
//
// The point of these tests is not that the filters filter. It is that the five
// states stay a PARTITION of the same data the home screen counts: if
// "申告済み + 定着" ever stops equalling mastery's masteredCount, the learner
// gets two different answers to "how many words do I know?" from two screens
// one tap apart. The last block asserts that against the real RU deck.

import { describe, it, expect } from "vitest";
import {
  buildVocabList,
  countByStatus,
  filterVocab,
  vocabStatus,
  RECENT_WINDOW_MS,
} from "./vocabulary";
import type { VocabWordInput } from "./vocabulary";
import { newReviewState, CardState } from "./fsrs";
import type { ReviewState } from "./fsrs";
import { MASTERY_STABILITY_DAYS, masteryStats, frameLemmas, masteredLemmaSet } from "./mastery";
import type { KnowledgeMap } from "./calibration";
import type { Deck } from "./content";
import ruDeck from "../content/deck.ru.json";

function word(lemma: string, rank: number, band = 1): VocabWordInput {
  return { lemma, rank, band, pos: "noun", enGloss: `${lemma}-en`, jaGloss: `${lemma}-ja` };
}

function reviewed(sentenceId: string, stability: number | null, lastReview: number | null) {
  const st = newReviewState(sentenceId);
  st.stability = stability;
  st.lastReview = lastReview;
  st.state = CardState.Review;
  return st;
}

const gloss = (w: VocabWordInput) => w.enGloss ?? "";

describe("vocabStatus", () => {
  const k: KnowledgeMap = new Map([
    ["declared", "known"],
    ["rejected", "unknown"],
  ]);

  it("treats a self-declaration as the strongest signal", () => {
    // A learner who says "I know this" is believed even when the card is in
    // the queue — otherwise a declared word would demote itself to 学習中 the
    // first time it came up, and the home screen's declared/learned split
    // would stop summing to its own total.
    const mastered = new Set(["declared"]);
    expect(vocabStatus("declared", k, mastered, reviewed("s1", 1, Date.now()))).toBe("declared");
  });

  it("reads 定着 from the mastered set rather than recomputing it", () => {
    // Crucially NOT "stability >= threshold": mastery.ts also credits a lemma
    // with enough incidental exposure in other durably-retained sentences, and
    // this screen must agree with that.
    expect(vocabStatus("x", k, new Set(["x"]), undefined)).toBe("mastered");
    expect(vocabStatus("x", k, new Set(), reviewed("s1", MASTERY_STABILITY_DAYS, null))).toBe(
      "learning",
    );
  });

  it("keeps 未習 and 未判定 apart", () => {
    expect(vocabStatus("rejected", k, new Set(), undefined)).toBe("unknown");
    expect(vocabStatus("never-seen", k, new Set(), undefined)).toBe("unjudged");
  });

  it("does not count a New card as study history", () => {
    // A card that exists but has never been graded is not "learning".
    expect(vocabStatus("never-seen", k, new Set(), newReviewState("s1"))).toBe("unjudged");
  });
});

describe("buildVocabList", () => {
  const base = {
    knowledge: new Map() as KnowledgeMap,
    reviewByLemma: new Map<string, ReviewState>(),
    judgedAtByLemma: new Map<string, number>(),
    masteredLemmas: new Set<string>(),
    gloss,
  };

  it("orders by frequency rank, not by insertion", () => {
    const rows = buildVocabList({ ...base, words: [word("c", 30), word("a", 10), word("b", 20)] });
    expect(rows.map((r) => r.lemma)).toEqual(["a", "b", "c"]);
  });

  it("takes the most recent of a judgement and a review as changedAt", () => {
    const rows = buildVocabList({
      ...base,
      words: [word("a", 1), word("b", 2), word("c", 3)],
      reviewByLemma: new Map([["b", reviewed("s-b", 1, 5_000)]]),
      judgedAtByLemma: new Map([
        ["a", 9_000],
        ["b", 1_000],
      ]),
    });
    const by = new Map(rows.map((r) => [r.lemma, r.changedAt]));
    expect(by.get("a")).toBe(9_000);
    expect(by.get("b")).toBe(5_000); // the review was later than the judgement
    expect(by.get("c")).toBeNull(); // never touched — not 0, which date maths
    //                                 would read as "changed in 1970"
  });

  it("assigns every word exactly one status", () => {
    const words = [word("a", 1), word("b", 2), word("c", 3), word("d", 4), word("e", 5)];
    const rows = buildVocabList({
      ...base,
      words,
      knowledge: new Map([
        ["a", "known"],
        ["d", "unknown"],
      ]),
      masteredLemmas: new Set(["a", "b"]),
      reviewByLemma: new Map([["c", reviewed("s-c", 2, null)]]),
    });
    expect(countByStatus(rows)).toEqual({
      declared: 1,
      mastered: 1,
      learning: 1,
      unknown: 1,
      unjudged: 1,
    });
  });
});

describe("filterVocab", () => {
  const rows = buildVocabList({
    words: [word("дом", 1, 1), word("стол", 2, 2), word("окно", 3, 3)],
    knowledge: new Map([["дом", "known"]]),
    reviewByLemma: new Map(),
    judgedAtByLemma: new Map([["дом", 1_000_000]]),
    masteredLemmas: new Set(["дом"]),
    gloss: (w) => (w.lemma === "дом" ? "house" : w.lemma === "стол" ? "table" : "window"),
  });

  it("filters by status and by step independently", () => {
    expect(filterVocab(rows, { status: "declared" }).map((r) => r.lemma)).toEqual(["дом"]);
    expect(filterVocab(rows, { band: 3 }).map((r) => r.lemma)).toEqual(["окно"]);
    expect(filterVocab(rows, { status: "all", band: "all" })).toHaveLength(3);
  });

  it("searches the lemma and the translation, case-insensitively", () => {
    expect(filterVocab(rows, { query: "СТО" }).map((r) => r.lemma)).toEqual(["стол"]);
    expect(filterVocab(rows, { query: "window" }).map((r) => r.lemma)).toEqual(["окно"]);
    expect(filterVocab(rows, { query: "  " })).toHaveLength(3); // blank is not a filter
  });

  it("holds the 7-day window at its boundary", () => {
    const at = 1_000_000;
    expect(filterVocab(rows, { recentOnly: true, now: at + RECENT_WINDOW_MS })).toHaveLength(1);
    expect(filterVocab(rows, { recentOnly: true, now: at + RECENT_WINDOW_MS + 1 })).toHaveLength(0);
  });

  it("never shows an untouched word as recently changed", () => {
    // changedAt === null must not be read as epoch 0 — which would be filtered
    // out by luck (56 years ago) rather than by rule.
    const recent = filterVocab(rows, { recentOnly: true, now: 1_000_001 });
    expect(recent.every((r) => r.changedAt != null)).toBe(true);
  });
});

describe("agreement with the home screen (real RU deck)", () => {
  const deck = ruDeck as unknown as Deck;
  const wordById = new Map(deck.words.map((w) => [w.id, w]));
  const lemmas = frameLemmas(deck.words);

  /** A plausible learner: a level check declared some words and rejected
   * others, and a slice of the deck has been studied to maturity. */
  function scenario() {
    const inFrame = deck.words.filter((w) => lemmas.has(w.lemma));
    const knowledge: KnowledgeMap = new Map();
    inFrame.slice(0, 300).forEach((w) => knowledge.set(w.lemma, "known"));
    inFrame.slice(300, 450).forEach((w) => knowledge.set(w.lemma, "unknown"));
    const states = deck.sentences
      .slice(0, 400)
      .map((s, i) => reviewed(s.id, i % 2 === 0 ? 40 : 3, 1_000_000 + i));
    return { knowledge, states };
  }

  it("declared + mastered equals masteryStats' own counts", () => {
    const { knowledge, states } = scenario();

    const stats = masteryStats(deck.sentences, knowledge, states, lemmas, undefined, wordById);
    const mastered = masteredLemmaSet(
      deck.sentences,
      knowledge,
      states,
      lemmas,
      undefined,
      wordById,
    );

    const reviewByLemma = new Map<string, ReviewState>();
    const stateBySentence = new Map(states.map((s) => [s.sentenceId, s]));
    for (const s of deck.sentences) {
      if (!s.targetLemma) continue;
      const st = stateBySentence.get(s.id);
      if (!st) continue;
      const prev = reviewByLemma.get(s.targetLemma);
      if (!prev || (st.stability ?? 0) > (prev.stability ?? 0)) {
        reviewByLemma.set(s.targetLemma, st);
      }
    }

    const rows = buildVocabList({
      words: deck.words
        .filter((w) => lemmas.has(w.lemma))
        .map((w) => ({
          lemma: w.lemma,
          rank: w.rank ?? Number.MAX_SAFE_INTEGER,
          band: w.band,
          pos: w.pos,
          enGloss: w.enGloss ?? null,
          jaGloss: w.jaGloss ?? null,
          ruGloss: w.ruGloss ?? null,
        })),
      knowledge,
      reviewByLemma,
      judgedAtByLemma: new Map(),
      masteredLemmas: mastered,
      gloss,
    });
    const counts = countByStatus(rows);

    // The whole reason this file exists.
    expect(counts.declared).toBe(stats.declaredCount);
    expect(counts.mastered).toBe(stats.learnedCount);
    expect(counts.declared + counts.mastered).toBe(stats.masteredCount);
    // And the unjudged pool the details sheet advertises ("a level check can
    // decide these") must be the same pool this screen's 未判定 chip filters to,
    // plus the words study has since picked up.
    expect(counts.unjudged + counts.learning).toBeLessThanOrEqual(stats.unjudgedCount);

    // Non-trivial scenario: a vacuous pass would make this test worthless.
    expect(counts.declared).toBeGreaterThan(100);
    expect(counts.mastered).toBeGreaterThan(0);
    expect(counts.learning).toBeGreaterThan(0);
  });

  it("lists exactly the 3,000-word frame, each word once", () => {
    const rows = buildVocabList({
      words: deck.words
        .filter((w) => lemmas.has(w.lemma))
        .map((w) => ({
          lemma: w.lemma,
          rank: w.rank ?? Number.MAX_SAFE_INTEGER,
          band: w.band,
          pos: w.pos,
        })),
      knowledge: new Map(),
      reviewByLemma: new Map(),
      judgedAtByLemma: new Map(),
      masteredLemmas: new Set(),
      gloss: () => "",
    });
    expect(rows).toHaveLength(lemmas.size);
    expect(new Set(rows.map((r) => r.lemma)).size).toBe(rows.length);
    expect(rows.every((r) => r.band >= 1 && r.band <= 3)).toBe(true);
    // Frequency order, strictly increasing rank.
    expect(rows.every((r, i) => i === 0 || rows[i - 1].rank <= r.rank)).toBe(true);
  });
});
