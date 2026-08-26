import { describe, it, expect } from "vitest";
import { ContentStore } from "./content";
import type { Deck, Sentence } from "./content";
import { buildGateSession, GateSessionRunner } from "./session";
import { SeededRNG } from "./rng";
import { FSRS, Rating, CardState, newReviewState, AGAIN_STEP_MS } from "./fsrs";
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

// LINGO-010 follow-up (2026-08-26): Home's "10問を解く" became a continuous
// loop that can be exited at any point via commitPartialSession (state/service.ts),
// which is just drainPendingUpserts()+knowledgeOutcomes() on whatever's been
// graded so far. These tests pin the underlying runner mechanics that back it:
// an early exit only ever persists graded cards, the rest are silently
// dropped, and repeating the "exit" action (double-tap) never double-commits.
describe("GateSessionRunner partial exit (continuous mode early exit)", () => {
  function runnerOf(n: number) {
    const store = new ContentStore(makeDeck(n), []);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
    return new GateSessionRunner(plan, fsrs);
  }

  it("drains only the graded cards mid-batch; ungraded ones are dropped, not crashed on", () => {
    const r = runnerOf(10);
    expect(() => {
      r.submitRating(Rating.Good, NOW);
      r.submitRating(Rating.Good, NOW);
      r.submitRating(Rating.Again, NOW); // re-queued, but already graded once
    }).not.toThrow();
    expect(r.isComplete).toBe(false); // 7 cards never seen this "batch"
    expect(r.resolvedCount).toBe(2); // Again card isn't resolved (back in queue)

    // "Exit now": drain whatever's graded (mirrors commitPartialSession).
    const drained = r.drainPendingUpserts();
    expect(drained.length).toBe(3); // 2 Good + 1 Again, each graded exactly once
    expect(drained.every((s) => s.stability != null && s.due != null)).toBe(true);
  });

  it("knowledgeOutcomes() reflects only graded cards after a partial exit", () => {
    const r = runnerOf(10);
    r.submitRating(Rating.Good, NOW);
    r.submitRating(Rating.Again, NOW);
    const outcomes = r.knowledgeOutcomes();
    expect(outcomes.length).toBe(2); // the other 8 were never graded
    const byId = new Map(outcomes.map((o) => [o.sentence.id, o.again]));
    expect([...byId.values()].filter(Boolean).length).toBe(1); // exactly one Again
  });

  it("a repeated exit (double-tap) never double-commits: second drain is empty", () => {
    const r = runnerOf(10);
    r.submitRating(Rating.Good, NOW);
    r.submitRating(Rating.Good, NOW);
    const first = r.drainPendingUpserts();
    expect(first.length).toBe(2);
    // Simulate a double-tap on "終了" (or a race between finish() and exitNow()):
    // draining again — with no new ratings in between — must not crash and must
    // not resurface anything already committed.
    const second = r.drainPendingUpserts();
    expect(second).toEqual([]);
  });

  it("exiting with zero cards graded is a safe no-op drain", () => {
    const r = runnerOf(10);
    expect(() => r.drainPendingUpserts()).not.toThrow();
    expect(r.drainPendingUpserts()).toEqual([]);
  });
});

describe("continuous mode: cross-batch continuity (LINGO-010 follow-up)", () => {
  it("a second batch built after committing the first batch's grades has no overlap and doesn't crash", () => {
    const deck = makeDeck(40); // more than one batch's worth of new sentences
    const store1 = new ContentStore(deck, []);
    const plan1 = buildGateSession(store1, { band: 1, now: NOW, size: 10, rng: new SeededRNG(1) });
    const runner1 = new GateSessionRunner(plan1, fsrs);
    for (let i = 0; i < 10; i++) runner1.submitRating(Rating.Good, NOW);
    expect(runner1.isComplete).toBe(true);
    const committed1 = runner1.drainPendingUpserts();
    expect(committed1.length).toBe(10);

    // "続ける": reload the store with the just-committed states (mirrors
    // startSession() re-reading IndexedDB after commitSession/persistGrades)
    // and build the next batch.
    const store2 = new ContentStore(deck, committed1);
    expect(() =>
      buildGateSession(store2, { band: 1, now: NOW, size: 10, rng: new SeededRNG(2) }),
    ).not.toThrow();
    const plan2 = buildGateSession(store2, { band: 1, now: NOW, size: 10, rng: new SeededRNG(2) });
    const batch1Ids = new Set(plan1.cards.map((c) => c.sentence.id));
    const batch2Ids = plan2.cards.map((c) => c.sentence.id);
    expect(batch2Ids.length).toBe(10);
    for (const id of batch2Ids) expect(batch1Ids.has(id)).toBe(false);
  });
});

// LINGO-010 follow-up (2026-08-26, Katsuta bug report): continuous practice
// mode was still requeuing Again cards within the batch (the gate's toll
// rule), so "10 correct in a row" was effectively required before the next
// *new* card ever appeared — the opposite of what a fast-repetition practice
// mode should feel like. Fix: GateSessionRunner({requeueAgain: false}) — every
// card, Again included, resolves after exactly one grade; the Again'd card
// comes back later via FSRS's own ~5min due (AGAIN_STEP_MS), not immediately.
describe("GateSessionRunner: continuous mode (requeueAgain:false) — Again resolves, doesn't hold the batch hostage", () => {
  function continuousRunnerOf(n: number) {
    const store = new ContentStore(makeDeck(n), []);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
    return new GateSessionRunner(plan, fsrs, { requeueAgain: false });
  }

  it("an Again resolves the card immediately — no requeue, no second look this batch", () => {
    const r = continuousRunnerOf(3);
    const first = r.currentCardID;
    const res = r.submitRating(Rating.Again, NOW);
    expect(res.requeued).toBe(false);
    expect(r.currentCardID).not.toBe(first); // moved straight on to the next card
    expect(r.resolvedCount).toBe(1);
  });

  it("a 10-card batch completes after exactly 10 gradings, Again included — never stuck waiting for 10 corrects", () => {
    const r = continuousRunnerOf(10);
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const id = r.currentCardID!;
      expect(seen.has(id)).toBe(false); // no card is ever shown twice in this batch
      seen.add(id);
      const rating = i % 3 === 0 ? Rating.Again : Rating.Good; // mix in several Again grades
      const res = r.submitRating(rating, NOW);
      expect(res.sessionComplete).toBe(i === 9);
    }
    expect(r.isComplete).toBe(true);
    expect(seen.size).toBe(10);
  });

  it("ratingSummary tallies each card's first (and only) grading", () => {
    const r = continuousRunnerOf(4);
    r.submitRating(Rating.Again, NOW);
    r.submitRating(Rating.Hard, NOW);
    r.submitRating(Rating.Good, NOW);
    r.submitRating(Rating.Good, NOW);
    expect(r.ratingSummary).toEqual({ again: 1, hard: 1, good: 2, total: 4 });
  });

  it("an Again'd card's persisted due is ~5 minutes out, not requeued in this batch", () => {
    const r = continuousRunnerOf(1);
    r.submitRating(Rating.Again, NOW);
    const [state] = r.drainPendingUpserts();
    expect(state.due! - NOW).toBe(AGAIN_STEP_MS);
  });

  it("a later batch's dueReviews surfaces the Again'd card ahead of brand-new ones once its ~5min due has passed", () => {
    const deck = makeDeck(20);
    const store1 = new ContentStore(deck, []);
    const plan1 = buildGateSession(store1, { band: 1, now: NOW, size: 5, rng: new SeededRNG(3) });
    const runner1 = new GateSessionRunner(plan1, fsrs, { requeueAgain: false });
    const againId = runner1.currentCardID!;
    runner1.submitRating(Rating.Again, NOW);
    for (let i = 0; i < 4; i++) runner1.submitRating(Rating.Good, NOW);
    const committed1 = runner1.drainPendingUpserts();

    // A future "続ける" batch, built after the ~5min learning step has passed.
    const later = NOW + AGAIN_STEP_MS + 1000;
    const store2 = new ContentStore(deck, committed1);
    const plan2 = buildGateSession(store2, { band: 1, now: later, size: 5, rng: new SeededRNG(4) });
    expect(plan2.cards[0].sentence.id).toBe(againId);
    expect(plan2.cards[0].isReview).toBe(true);
  });
});

describe("GateSessionRunner: gate mode (default) keeps the requeue-until-clear toll", () => {
  function gateRunnerOf(n: number) {
    const store = new ContentStore(makeDeck(n), []);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
    return new GateSessionRunner(plan, fsrs); // no opts -> requeueAgain defaults to true
  }

  it("does not complete until every Again'd card gets a second, non-Again look", () => {
    const r = gateRunnerOf(3);
    r.submitRating(Rating.Again, NOW);
    r.submitRating(Rating.Good, NOW);
    r.submitRating(Rating.Good, NOW);
    expect(r.isComplete).toBe(false); // the Again card is still owed a look
    const final = r.submitRating(Rating.Good, NOW);
    expect(final.sessionComplete).toBe(true);
  });

  it("{requeueAgain: true} explicitly behaves the same as the default (unchanged /gate behaviour)", () => {
    const store = new ContentStore(makeDeck(3), []);
    const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
    const r = new GateSessionRunner(plan, fsrs, { requeueAgain: true });
    const res = r.submitRating(Rating.Again, NOW);
    expect(res.requeued).toBe(true);
    expect(r.isComplete).toBe(false);
  });
});
