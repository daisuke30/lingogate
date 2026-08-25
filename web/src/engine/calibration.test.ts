import { describe, it, expect } from "vitest";
import { ContentStore } from "./content";
import type { Deck, DeckWord, Sentence } from "./content";
import { FSRS, CardState, Rating } from "./fsrs";
import {
  scoreSentence,
  seedKnownReviewState,
  seedKnownReviewStatesForLemmas,
  knowledgeUpdatesFromOutcomes,
  KNOWN_SEED_STABILITY_DAYS,
} from "./calibration";
import type { KnowledgeMap } from "./calibration";

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
});

describe("knowledgeUpdatesFromOutcomes (review feedback)", () => {
  const words = Array.from({ length: 110 }, (_, i) => word(i + 1));
  const wordById = new Map(words.map((w) => [w.id, w]));

  it("marks target lemma known on a clean Good pass", () => {
    const s = sentence("S", [1, 50], "w50", 1);
    const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: false }], wordById, new Map(), NOW);
    expect(ups).toEqual([{ lemma: "w50", status: "known", updatedAt: NOW, source: "review" }]);
  });

  it("marks target lemma unknown on Again", () => {
    const s = sentence("S", [1, 50], "w50", 1);
    const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: true }], wordById, new Map(), NOW);
    expect(ups[0]).toMatchObject({ lemma: "w50", status: "unknown", source: "review" });
  });

  it("without a target lemma, Again marks the lowest-rank not-known word", () => {
    const knowledge = knownThrough(0, { w5: "known" }); // w5 known, others unset
    const s = sentence("S", [5, 8, 3], null, 3);
    const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: true }], wordById, knowledge, NOW);
    // w5 is known so skipped; lowest-rank of {w8,w3} is w3.
    expect(ups[0].lemma).toBe("w3");
    expect(ups[0].status).toBe("unknown");
  });

  it("does not update anything for a targetless clean Good pass", () => {
    const s = sentence("S", [1, 2], null, 1);
    const ups = knowledgeUpdatesFromOutcomes([{ sentence: s, again: false }], wordById, new Map(), NOW);
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
      wordById,
      new Map(),
      NOW,
    );
    expect(ups).toHaveLength(1);
    expect(ups[0].status).toBe("unknown");
  });
});
