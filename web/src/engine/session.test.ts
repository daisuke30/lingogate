import { describe, it, expect } from "vitest";
import { ContentStore } from "./content";
import type { Deck, Sentence } from "./content";
import { buildGateSession, GateSessionRunner } from "./session";
import { SeededRNG } from "./rng";
import { FSRS, Rating, CardState, newReviewState } from "./fsrs";
import type { ReviewState } from "./fsrs";

const fsrs = new FSRS();
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function sentence(i: number, band = 1, minRank = i): Sentence {
  const id = `s${String(i).padStart(3, "0")}`;
  return {
    id,
    ru: `предложение ${i}`,
    en: `sentence ${i}`,
    ja: `文 ${i}`,
    kana: null,
    note: null,
    band,
    difficulty: 1,
    source: "generated",
    kind: "sentence",
    targetLemma: null,
    wordIds: [i],
    minRank,
  };
}

function makeDeck(n: number): Deck {
  const sentences = Array.from({ length: n }, (_, k) => sentence(k + 1));
  const words = Array.from({ length: n }, (_, k) => ({
    id: k + 1,
    lemma: `w${k + 1}`,
    rank: k + 1,
    band: 1,
    pos: "noun",
  }));
  return { code: "T", name: "t", targetLang: "ru", sourceLang: "en", bands: [1], words, sentences };
}

describe("buildGateSession", () => {
  it("fills a 10-card plan from new sentences in frequency order", () => {
    const store = new ContentStore(makeDeck(50), []);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(42) });
    expect(plan.cards.length).toBe(10);
    // All new (no review states yet).
    expect(plan.cards.every((c) => !c.isReview)).toBe(true);
    // No duplicates.
    expect(new Set(plan.cards.map((c) => c.sentence.id)).size).toBe(10);
  });

  it("is reproducible for a fixed seed", () => {
    const store = new ContentStore(makeDeck(50), []);
    const a = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(7) });
    const b = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(7) });
    expect(a.cards.map((c) => c.sentence.id)).toEqual(b.cards.map((c) => c.sentence.id));
  });

  it("puts due reviews before new cards", () => {
    const deck = makeDeck(50);
    // Make s005 an overdue review.
    const due: ReviewState = {
      ...newReviewState("s005"),
      stability: 3,
      difficulty: 5,
      due: NOW - 2 * DAY,
      reps: 1,
      state: CardState.Review,
      lastReview: NOW - 5 * DAY,
    };
    const store = new ContentStore(deck, [due]);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
    expect(plan.cards[0].sentence.id).toBe("s005");
    expect(plan.cards[0].isReview).toBe(true);
    expect(plan.cards.length).toBe(10);
  });

  it("handles a deck smaller than the session size", () => {
    const store = new ContentStore(makeDeck(4), []);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
    expect(plan.cards.length).toBe(4);
  });
});

describe("GateSessionRunner (flashcard rating path)", () => {
  function runnerOf(n: number) {
    const store = new ContentStore(makeDeck(n), []);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
    return new GateSessionRunner(plan, fsrs);
  }

  it("completes when every card is rated non-Again", () => {
    const r = runnerOf(10);
    for (let i = 0; i < 10; i++) {
      const res = r.submitRating(Rating.Good, NOW);
      expect(res.sessionComplete).toBe(i === 9);
    }
    expect(r.isComplete).toBe(true);
    expect(r.firstTryCorrect).toBe(10);
    expect(r.resolvedCount).toBe(10);
  });

  it("re-queues an Again card to the end and needs a second pass", () => {
    const r = runnerOf(3);
    const first = r.currentCardID;
    const res1 = r.submitRating(Rating.Again, NOW);
    expect(res1.requeued).toBe(true);
    expect(res1.sessionComplete).toBe(false);
    // Next two cards Good.
    r.submitRating(Rating.Good, NOW);
    r.submitRating(Rating.Good, NOW);
    // The Again card is back at the head.
    expect(r.currentCardID).toBe(first);
    const final = r.submitRating(Rating.Good, NOW);
    expect(final.sessionComplete).toBe(true);
    // firstTryCorrect counts only the 2 that were right first time.
    expect(r.firstTryCorrect).toBe(2);
  });

  it("grades a card through FSRS exactly once (no re-grade on re-show)", () => {
    const r = runnerOf(1);
    r.submitRating(Rating.Again, NOW); // graded once -> lapse path (state Learning)
    // Buffered exactly one grade despite the card still being in the queue.
    expect(r.pendingRatingUpsertCount).toBe(1);
    r.submitRating(Rating.Good, NOW); // re-show, must not append a second grade
    expect(r.pendingRatingUpsertCount).toBe(1);
    expect(r.isComplete).toBe(true);
  });

  it("buffers grades and only exposes them on drain", () => {
    const r = runnerOf(10);
    for (let i = 0; i < 10; i++) r.submitRating(Rating.Good, NOW);
    expect(r.pendingRatingUpsertCount).toBe(10);
    const drained = r.drainPendingUpserts();
    expect(drained.length).toBe(10);
    expect(r.pendingRatingUpsertCount).toBe(0);
    // Each drained state is a real FSRS review (has stability/due set).
    expect(drained.every((s) => s.stability != null && s.due != null)).toBe(true);
  });
});
