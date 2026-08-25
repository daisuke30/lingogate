import { describe, it, expect } from "vitest";
import { ContentStore } from "./content";
import type { Deck, Sentence } from "./content";
import { buildGateSession, GateSessionRunner } from "./session";
import { SeededRNG } from "./rng";
import { FSRS, Rating } from "./fsrs";

const fsrs = new FSRS();
const NOW = 1_700_000_000_000;

function deck(n: number): Deck {
  const sentences: Sentence[] = Array.from({ length: n }, (_, k) => ({
    id: `s${String(k + 1).padStart(3, "0")}`,
    ru: `ру ${k + 1}`,
    en: `en ${k + 1}`,
    ja: null,
    kana: null,
    note: null,
    band: 1,
    difficulty: 1,
    source: "generated",
    kind: "sentence",
    targetLemma: null,
    wordIds: [],
    minRank: k + 1,
  }));
  return { code: "T", name: "t", targetLang: "ru", sourceLang: "en", bands: [1], words: [], sentences };
}

function runnerOf(n: number) {
  const store = new ContentStore(deck(n), []);
  const plan = buildGateSession(store, { band: 1, now: NOW, rng: new SeededRNG(1) });
  return new GateSessionRunner(plan, fsrs);
}

describe("undo (single level, LINGO-007)", () => {
  it("cannot undo before any rating", () => {
    const r = runnerOf(10);
    expect(r.canUndo).toBe(false);
    expect(r.undoLastRating()).toBe(false);
  });

  it("restores head card, counters, and drops the buffered grade", () => {
    const r = runnerOf(10);
    const firstId = r.currentCardID;
    r.submitRating(Rating.Good, NOW);
    expect(r.currentCardID).not.toBe(firstId);
    expect(r.firstTryCorrect).toBe(1);
    expect(r.pendingRatingUpsertCount).toBe(1);

    expect(r.canUndo).toBe(true);
    expect(r.undoLastRating()).toBe(true);

    expect(r.currentCardID).toBe(firstId); // card back at the front, ready to re-rate
    expect(r.firstTryCorrect).toBe(0);
    expect(r.totalAnswers).toBe(0);
    expect(r.pendingRatingUpsertCount).toBe(0);
    expect(r.canUndo).toBe(false); // only one level deep
  });

  it("undoes an Again re-queue (card comes back to the head)", () => {
    const r = runnerOf(3);
    const firstId = r.currentCardID;
    r.submitRating(Rating.Again, NOW); // requeued to the back
    expect(r.currentCardID).not.toBe(firstId);
    r.undoLastRating();
    expect(r.currentCardID).toBe(firstId);
    expect(r.pendingRatingUpsertCount).toBe(0);
  });

  it("only the most recent rating can be undone", () => {
    const r = runnerOf(10);
    r.submitRating(Rating.Good, NOW);
    r.submitRating(Rating.Good, NOW);
    expect(r.undoLastRating()).toBe(true);
    expect(r.undoLastRating()).toBe(false); // second consecutive undo not allowed
    expect(r.firstTryCorrect).toBe(1);
  });
});
