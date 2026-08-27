import { describe, it, expect } from "vitest";
import { ContentStore } from "./content";
import type { Deck, Sentence } from "./content";
import { buildGateSession } from "./session";
import { SeededRNG } from "./rng";
import { CardState, newReviewState } from "./fsrs";
import type { ReviewState } from "./fsrs";

// LINGO-010 follow-up (2026-08-26): build-content.mjs now drops overlong
// sentences from the deck entirely, but a learner's IndexedDB can still hold a
// ReviewState for a sentenceId that predates the rebuild — an "orphan" state
// pointing at a sentence that no longer exists in the bundled deck. These
// tests pin that ContentStore (and buildGateSession, which is built on top of
// it) tolerate orphans: no crash, and the orphaned card never surfaces.

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function sentence(id: string, minRank: number | null = 1): Sentence {
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
    targetLemma: null,
    wordIds: [],
    minRank,
    tokenCount: 2,
  };
}

function makeDeck(sentences: Sentence[]): Deck {
  return { code: "T", name: "t", targetLang: "ru", sourceLang: "en", bands: [1], words: [], sentences };
}

function orphanState(sentenceId: string, due: number): ReviewState {
  return {
    ...newReviewState(sentenceId),
    stability: 3,
    difficulty: 5,
    due,
    reps: 2,
    lapses: 1,
    state: CardState.Review,
    lastReview: due - 5 * DAY,
  };
}

describe("ContentStore tolerates orphan ReviewStates (sentence removed from deck)", () => {
  it("dueReviews skips an orphan (overdue) and still returns the real due card", () => {
    const deck = makeDeck([sentence("s001")]);
    const real = orphanState("s001", NOW - DAY);
    const orphan = orphanState("ghost-long-sentence", NOW - 2 * DAY); // more overdue, but gone from deck
    const store = new ContentStore(deck, [real, orphan]);
    expect(() => store.dueReviews(1, NOW, 10)).not.toThrow();
    const out = store.dueReviews(1, NOW, 10);
    expect(out.map((c) => c.sentence.id)).toEqual(["s001"]);
  });

  it("upcomingReviews skips an orphan (not yet due)", () => {
    const deck = makeDeck([sentence("s001")]);
    const real = orphanState("s001", NOW + DAY);
    const orphan = orphanState("ghost-long-sentence", NOW + DAY);
    const store = new ContentStore(deck, [real, orphan]);
    expect(() => store.upcomingReviews(1, new Set(), 10)).not.toThrow();
    const out = store.upcomingReviews(1, new Set(), 10);
    expect(out.map((c) => c.sentence.id)).toEqual(["s001"]);
  });

  it("bandRetention excludes an orphan's reps/lapses", () => {
    const deck = makeDeck([sentence("s001")]);
    const real = orphanState("s001", NOW - DAY);
    const orphan = orphanState("ghost-long-sentence", NOW - DAY);
    const store = new ContentStore(deck, [real, orphan]);
    const ret = store.bandRetention(1);
    // Only s001's counters (reps 2, lapses 1); the orphan's are not double-counted.
    expect(ret).toEqual({ reps: 2, lapses: 1, reviewCards: 1 });
  });

  it("masteryStats: counts known-judged deck words + stable targets, dedup, deck-scoped", () => {
    const s = sentence("T1");
    s.targetLemma = "мир";
    const deck: Deck = {
      code: "T",
      name: "t",
      targetLang: "ru",
      sourceLang: "en",
      bands: [1],
      words: [
        { id: 1, lemma: "дом", rank: 1, band: 1, pos: "noun" },
        { id: 2, lemma: "мир", rank: 2, band: 1, pos: "noun" },
        { id: 3, lemma: "рука", rank: 3, band: 1, pos: "noun" },
      ],
      sentences: [s],
    };
    const stable = orphanState("T1", NOW + 30 * DAY);
    stable.stability = 30; // ≥ 21d threshold → "мир" mastered via learning
    const knowledge = new Map<string, "known" | "unknown" | "unset">([
      ["дом", "known"],
      ["мир", "known"], // also judged known — must dedup with the stable target
      ["собака", "known"], // not a deck word — must be ignored
    ]);
    const store = new ContentStore(deck, [stable], knowledge);
    const m = store.masteryStats();
    expect(m.masteredCount).toBe(2); // дом + мир (once)
    expect(m.targetWords).toBe(3000);
    expect(m.level).toBe("完全初心者");
  });

  it("buildGateSession never surfaces an orphaned sentenceId and does not crash", () => {
    const deck = makeDeck([sentence("s001"), sentence("s002"), sentence("s003")]);
    const orphan = orphanState("ghost-long-sentence", NOW - DAY); // most overdue of all
    const store = new ContentStore(deck, [orphan]);
    expect(() =>
      buildGateSession(store, { band: 1, now: NOW, size: 3, rng: new SeededRNG(1) }),
    ).not.toThrow();
    const plan = buildGateSession(store, { band: 1, now: NOW, size: 3, rng: new SeededRNG(1) });
    expect(plan.cards.map((c) => c.sentence.id)).not.toContain("ghost-long-sentence");
    expect(plan.cards.length).toBe(3); // filled entirely from real new sentences
  });
});
