import { describe, it, expect } from "vitest";
import { ContentStore } from "./content";
import type { Deck, DeckWord, Sentence } from "./content";
import { FSRS, CardState, Rating } from "./fsrs";
import {
  scoreSentence,
  seedKnownReviewState,
  seedKnownReviewStatesForLemmas,
  knowledgeUpdatesFromOutcomes,
  findCollateralDemotions,
  REPAIR_RECENCY_MS,
  REPAIR_RANK_THRESHOLD,
  KNOWN_SEED_STABILITY_DAYS,
  MAX_UNKNOWN_FOR_NEW,
  UNLINKED_WEIGHT,
} from "./calibration";
import type { KnowledgeMap, WordKnowledge } from "./calibration";
import type { ReviewState } from "./fsrs";

const fsrs = new FSRS();
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function word(id: number): DeckWord {
  return { id, lemma: `w${id}`, rank: id, band: 1, pos: "noun" };
}

function sentence(
  id: string,
  wordIds: number[],
  targetLemma: string | null,
  minRank: number | null,
  tokenCount: number | null = null,
): Sentence {
  return {
    id,
    ru: `ру ${id}`,
    en: `en ${id}`,
    ja: null,
    kana: null,
    note: null,
    band: 1,
    difficulty: 1,
    source: "generated",
    kind: "sentence",
    targetLemma,
    wordIds,
    minRank,
    tokenCount,
  };
}

function deckOf(words: DeckWord[], sentences: Sentence[]): Deck {
  return { code: "T", name: "t", targetLang: "ru", sourceLang: "en", bands: [1], words, sentences };
}

/** A knowledge map marking w1..wN known (plus optional explicit overrides). */
function knownThrough(n: number, overrides: Record<string, "known" | "unknown"> = {}): KnowledgeMap {
  const m: KnowledgeMap = new Map();
  for (let i = 1; i <= n; i++) m.set(`w${i}`, "known");
  for (const [k, v] of Object.entries(overrides)) m.set(k, v);
  return m;
}

describe("seedKnownReviewState (FSRS mastered seed)", () => {
  it("produces a Review-state card ~60 days out with pinned values", () => {
    const st = seedKnownReviewState("s001", NOW, fsrs);
    expect(st.state).toBe(CardState.Review);
    expect(st.stability).toBe(KNOWN_SEED_STABILITY_DAYS); // 60
    expect(st.reps).toBe(1);
    expect(st.lapses).toBe(0);
    expect(st.lastReview).toBe(NOW);
    // difficulty == initialDifficulty(Good) (known anchor 4.490943335)
    expect(Math.abs(st.difficulty! - fsrs.initialDifficulty(Rating.Good))).toBeLessThan(1e-9);
    // interval(S)==S at 0.9 retention, so due is exactly 60 days out.
    expect(Math.abs(st.due! - (NOW + 60 * DAY))).toBeLessThan(DAY * 1e-6);
  });

  it("seeds only target sentences for the lemma, skipping already-studied ones", () => {
    const sentences = [
      sentence("T1", [1], "w1", 1),
      sentence("T2", [2], "w2", 2),
      sentence("T3", [1], "w1", 1), // second sentence teaching w1
    ];
    const seeds = seedKnownReviewStatesForLemmas(sentences, ["w1"], NOW, new Set(["T3"]), fsrs);
    expect(seeds.map((s) => s.sentenceId).sort()).toEqual(["T1"]);
  });
});

describe("scoreSentence (unknown weighting)", () => {
  const words = Array.from({ length: 110 }, (_, i) => word(i + 1));
  const wordById = new Map(words.map((w) => [w.id, w]));

  it("weights explicit unknown as 1.0 and unset as 0.5", () => {
    const knowledge = knownThrough(100, { w101: "unknown" }); // w102+ unset
    // covers w1(known) + w101(unknown) + w102(unset)
    const s = sentence("S", [1, 101, 102], "w101", 1);
    const sc = scoreSentence(s, knowledge, wordById);
    expect(sc.unknownScore).toBeCloseTo(1.5, 6);
    expect(sc.sortRank).toBe(101); // target lemma rank
  });

  it("all-known sentence scores 0 and sorts by target rank", () => {
    const knowledge = knownThrough(100);
    const s = sentence("S", [1, 2, 3], "w2", 1);
    const sc = scoreSentence(s, knowledge, wordById);
    expect(sc.unknownScore).toBe(0);
    expect(sc.sortRank).toBe(2);
  });

  // Bug report 2026-08-26: lesson/note sentences (low lemma-link rate) were
  // scoring as if they had almost no unknown words, because unlinked RU tokens
  // (real words that never resolved to a wordId) contributed nothing at all.
  it("counts RU tokens that never linked to a wordId against the score (unlinked weight)", () => {
    const knowledge = knownThrough(100); // both linked words known
    // 9-word RU sentence, only 2 lemmas successfully linked (lesson-style).
    const s = sentence("Long", [1, 2], "w2", 1, 9);
    const sc = scoreSentence(s, knowledge, wordById);
    // unknown=0, unset=0, unlinked=9-2=7 -> 7 * 0.75 = 5.25
    expect(sc.unknownScore).toBeCloseTo(7 * UNLINKED_WEIGHT, 6);
    expect(sc.unknownScore).toBeGreaterThan(MAX_UNKNOWN_FOR_NEW);
  });

  it("a fully-linked core sentence of the same length has no unlinked penalty", () => {
    const knowledge = knownThrough(100);
    // Same word count as tokenCount (every RU word linked) -> unlinked = 0.
    const s = sentence("Core", [1, 2, 3, 4], "w2", 1, 4);
    const sc = scoreSentence(s, knowledge, wordById);
    expect(sc.unknownScore).toBe(0); // all 4 words known, none unlinked
  });
});

describe("ContentStore.newSentences knowledge ordering", () => {
  const words = Array.from({ length: 110 }, (_, i) => word(i + 1));

  const sentences = [
    sentence("sD", [1, 2], "w2", 1), // all known -> score 0, rank 2
    sentence("sA", [1, 101], "w101", 1), // one unset -> 0.5, rank 101
    sentence("sB", [1, 2, 101, 102], "w101", 1), // two unset -> 1.0
    sentence("sC", [101, 102, 103, 104, 105], "w101", 101), // five unset -> 2.5 (excluded)
  ];

  it("filters to <=2 unknown score and orders by (score, rank)", () => {
    const store = new ContentStore(deckOf(words, sentences), [], knownThrough(100));
    const out = store.newSentences(1, new Set(), 10).map((s) => s.id);
    expect(out).toEqual(["sD", "sA", "sB"]); // sC excluded (score 2.5)
  });

  it("falls back to plain frequency order below the calibration threshold", () => {
    // Only 3 words judged -> under threshold -> minRank order, no filtering.
    const store = new ContentStore(deckOf(words, sentences), [], knownThrough(3));
    const out = store.newSentences(1, new Set(), 10).map((s) => s.id);
    // Every sentence present (sC not filtered) and ordered by minRank then id.
    expect(out).toContain("sC");
    expect(out.length).toBe(4);
    // sC has minRank 101, the others minRank 1 -> sC must be last.
    expect(out[out.length - 1]).toBe("sC");
  });

  it("a 9-word lesson sentence with only 2 linked lemmas is excluded (unlinked weight)", () => {
    const knowledge = knownThrough(100);
    const coreLike = sentence("sCoreLike", [1, 2], "w2", 1, 2); // fully linked, 2/2
    const lessonLike = sentence("sLessonLike", [3, 4], "w4", 3, 9); // 9 tokens, 2 linked
    const store = new ContentStore(deckOf(words, [coreLike, lessonLike]), [], knowledge);
    const out = store.newSentences(1, new Set(), 10).map((s) => s.id);
    expect(out).toEqual(["sCoreLike"]); // lessonLike's score (5.25) > MAX_UNKNOWN_FOR_NEW
  });

  it("orders a fully-linked core sentence before a lower-link-rate one with the same eligible score tier", () => {
    const knowledge = knownThrough(100); // w101/w102 are not in the map -> unset
    // sCore: 2 tokens, both linked; target unset -> score 0.5.
    const core = sentence("sCore", [1, 101], "w101", 1, 2);
    // sLong: 5 tokens, only 3 linked (2 unlinked); target unset -> 0.5 + 2*0.75 = 2.0.
    const long = sentence("sLong", [1, 2, 102], "w102", 1, 5);
    const store = new ContentStore(deckOf(words, [long, core]), [], knowledge);
    const out = store.newSentences(1, new Set(), 10).map((s) => s.id);
    expect(out).toEqual(["sCore", "sLong"]); // both eligible (<=2), core sorts first
  });
});

describe("knowledgeUpdatesFromOutcomes (review feedback)", () => {
  it("marks target lemma known on a clean Good pass", () => {
    const s = sentence("S", [1, 50], "w50", 1);
    const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: false }], NOW);
    expect(ups).toEqual([{ lemma: "w50", status: "known", updatedAt: NOW, source: "review" }]);
  });

  it("marks target lemma unknown on Again", () => {
    const s = sentence("S", [1, 50], "w50", 1);
    const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: true }], NOW);
    expect(ups[0]).toMatchObject({ lemma: "w50", status: "unknown", source: "review" });
  });

  it("does not update anything for a targetless clean Good pass", () => {
    const s = sentence("S", [1, 2], null, 1);
    const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: false }], NOW);
    expect(ups).toEqual([]);
  });

  it("unknown takes precedence when the same lemma collides in one batch", () => {
    const good = sentence("G", [50], "w50", 50);
    const bad = sentence("B", [50], "w50", 50);
    const ups = knowledgeUpdatesFromOutcomes(
      [
        { sentence: good, again: false },
        { sentence: bad, again: true },
      ],
      NOW,
    );
    expect(ups).toHaveLength(1);
    expect(ups[0].status).toBe("unknown");
  });

  // --- LINGO-055 (2026-10-17): targetless (imported notes/lessons) Again/Good
  // must NEVER touch wordKnowledge — no fallback, no collateral demotion.
  // Katsuta's report ("覚えた語が280→240に漸減、超基礎文が再出題される", and he
  // explicitly never marked those words unknown himself) traced to the old
  // "no target lemma -> demote the lowest-rank not-yet-known word, or (when
  // every word in the sentence is already known) the lowest-rank word
  // regardless of status" fallback. The reproduction below is the exact
  // shape of that bug: a targetless note sentence made ENTIRELY of
  // already-known basic words ("I"/"you"/"here"-class, lowest rank).
  describe("LINGO-055: a targetless sentence never changes ANY word's status", () => {
    it("REPRODUCTION (documents the fixed bug): Again on a note sentence of all-known words used to demote the lowest-rank one — now it demotes nobody", () => {
      const s = sentence("noteS", [1, 2, 3], null, null); // all known, no target — e.g. an imported/lessons note
      const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: true }], NOW);
      expect(ups).toEqual([]); // NOT [{ lemma: "w1", status: "unknown", ... }] (the pre-fix behaviour)
    });
    it("Again on a targetless sentence with some unset/unknown words still updates nothing", () => {
      // Pre-fix, this specific shape (one already-known word, two
      // never-judged) was the "intended" fallback case — it demoted the
      // lowest-rank NOT-known word (w3). LINGO-055 removes that path too:
      // only a word's OWN target sentence may ever touch its status.
      const s = sentence("S", [5, 8, 3], null, 3);
      const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: true }], NOW);
      expect(ups).toEqual([]);
    });
    it("Good (clean pass) on a targetless sentence updates nothing (unchanged — this half was already correct)", () => {
      const s = sentence("S", [1, 2, 3], null, null);
      const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: false }], NOW);
      expect(ups).toEqual([]);
    });
    it("a mixed batch: the targetless sentence contributes nothing, the targeted one still updates normally", () => {
      const targetless = sentence("Note", [1, 2, 3], null, null);
      const targeted = sentence("Core", [50], "w50", 50);
      const ups = knowledgeUpdatesFromOutcomes(
        [
          { sentence: targetless, again: true },
          { sentence: targeted, again: false },
        ],
        NOW,
      );
      expect(ups).toEqual([{ lemma: "w50", status: "known", updatedAt: NOW, source: "review" }]);
    });
  });
});

// --- LINGO-055 repair migration -----------------------------------------

function knowledgeRow(
  lemma: string,
  status: "known" | "unknown" | "unset",
  updatedAt: number,
  source: WordKnowledge["source"] = "review",
): WordKnowledge {
  return { lemma, status, updatedAt, source };
}

function reviewState(sentenceId: string, lapses: number): ReviewState {
  return {
    sentenceId,
    direction: "en2ru",
    stability: null,
    difficulty: null,
    due: null,
    reps: 0,
    lapses,
    lastReview: null,
    state: CardState.New,
  };
}

describe("findCollateralDemotions (LINGO-055 repair)", () => {
  // Common fixture: w1 is rank 1 (well under REPAIR_RANK_THRESHOLD), with one
  // target sentence "T1". w9999 is an artificially huge rank, to exercise the
  // rank cutoff.
  const sentences = [sentence("T1", [1], "w1", 1), sentence("T2", [9999], "w9999", 9999)];
  const wordByLemma = new Map([
    ["w1", word(1)],
    ["w9999", { ...word(9999), rank: 9999 }],
  ]);

  it("flags unknown/review, recent, low-rank, no-lapse-on-own-target-sentence rows", () => {
    const rows = [knowledgeRow("w1", "unknown", NOW)];
    const flagged = findCollateralDemotions(rows, [], sentences, wordByLemma, NOW);
    expect(flagged).toEqual(["w1"]);
  });

  it("does NOT flag a row with a real lapse recorded on its own target sentence", () => {
    const rows = [knowledgeRow("w1", "unknown", NOW)];
    const states = [reviewState("T1", 1)]; // a genuine Again on w1's own target sentence
    const flagged = findCollateralDemotions(rows, states, sentences, wordByLemma, NOW);
    expect(flagged).toEqual([]);
  });

  it("does NOT flag a row older than the recency window (直近1ヶ月 outside)", () => {
    const rows = [knowledgeRow("w1", "unknown", NOW - REPAIR_RECENCY_MS - 1)];
    const flagged = findCollateralDemotions(rows, [], sentences, wordByLemma, NOW);
    expect(flagged).toEqual([]);
  });

  it("does NOT flag a high-rank (rare) word", () => {
    const rows = [knowledgeRow("w9999", "unknown", NOW)];
    const flagged = findCollateralDemotions(rows, [], sentences, wordByLemma, NOW);
    expect(flagged).toEqual([]);
  });

  it("does NOT flag a row that isn't status=unknown", () => {
    const rows = [knowledgeRow("w1", "known", NOW)];
    expect(findCollateralDemotions(rows, [], sentences, wordByLemma, NOW)).toEqual([]);
  });

  it("does NOT flag a row that isn't source=review (e.g. calibration/placement)", () => {
    const rows = [knowledgeRow("w1", "unknown", NOW, "calibration")];
    expect(findCollateralDemotions(rows, [], sentences, wordByLemma, NOW)).toEqual([]);
  });

  it("lapses on a DIFFERENT word's target sentence don't exonerate this one", () => {
    const rows = [knowledgeRow("w1", "unknown", NOW)];
    const states = [reviewState("T2", 5)]; // lapses, but on w9999's sentence, not w1's
    const flagged = findCollateralDemotions(rows, states, sentences, wordByLemma, NOW);
    expect(flagged).toEqual(["w1"]);
  });

  it("a row right at the recency boundary is still flagged (inclusive)", () => {
    const rows = [knowledgeRow("w1", "unknown", NOW - REPAIR_RECENCY_MS)];
    expect(findCollateralDemotions(rows, [], sentences, wordByLemma, NOW)).toEqual(["w1"]);
  });

  it("a row right at the rank boundary is still flagged (inclusive)", () => {
    const boundaryWord = { ...word(500), rank: REPAIR_RANK_THRESHOLD };
    const byLemma = new Map([["w500", boundaryWord]]);
    const sents = [sentence("T500", [500], "w500", 500)];
    const rows = [knowledgeRow("w500", "unknown", NOW)];
    expect(findCollateralDemotions(rows, [], sents, byLemma, NOW)).toEqual(["w500"]);
  });
});
