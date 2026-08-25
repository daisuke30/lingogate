import { describe, it, expect } from "vitest";
import { FSRS, DEFAULT_PARAMS, Rating, CardState, newReviewState, ALL_RATINGS } from "./fsrs";

// Mirror of ios/QuizEngine/Tests/QuizEngineTests/FSRSTests.swift. The same
// known FSRS-4.5 anchors must hold in the TS port (S=3.0412 after first Good,
// S≈13.216 after second Good, S≈2.702 after an Again, etc).

const fsrs = new FSRS();
const DAY = 86_400_000;
const t0 = 1_700_000_000_000; // epoch ms

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("FSRS building blocks / known anchors", () => {
  it("initial stability equals the weights", () => {
    const w = DEFAULT_PARAMS.w;
    near(fsrs.initialStability(Rating.Again), w[0], 1e-9);
    near(fsrs.initialStability(Rating.Hard), w[1], 1e-9);
    near(fsrs.initialStability(Rating.Good), w[2], 1e-9); // 3.0412
    near(fsrs.initialStability(Rating.Easy), w[3], 1e-9);
  });

  it("initial stability is monotonic in rating", () => {
    expect(fsrs.initialStability(Rating.Again)).toBeLessThan(fsrs.initialStability(Rating.Hard));
    expect(fsrs.initialStability(Rating.Hard)).toBeLessThan(fsrs.initialStability(Rating.Good));
    expect(fsrs.initialStability(Rating.Good)).toBeLessThan(fsrs.initialStability(Rating.Easy));
  });

  it("initial difficulty known values, clamped to [1,10]", () => {
    near(fsrs.initialDifficulty(Rating.Good), 4.490943335, 1e-6);
    near(fsrs.initialDifficulty(Rating.Easy), 1.163043430, 1e-6);
    for (const g of ALL_RATINGS) {
      const d = fsrs.initialDifficulty(g);
      expect(d).toBeGreaterThanOrEqual(1.0);
      expect(d).toBeLessThanOrEqual(10.0);
    }
  });

  it("interval equals stability at 0.9 retention", () => {
    for (const s of [0.5, 3.0412, 13.216, 100.0]) near(fsrs.interval(s), s, 1e-6);
  });

  it("forgetting curve is 0.9 at elapsed==stability and strictly decreasing", () => {
    const s = 10.0;
    near(fsrs.forgettingCurve(s, s), 0.9, 1e-9);
    let prev = 1.0;
    for (let t = 0; t <= 40; t += 2) {
      const r = fsrs.forgettingCurve(t, s);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });
});

describe("FSRS review() wiring & state machine", () => {
  it("first Good seeds state and schedules", () => {
    const card = newReviewState("s001");
    const out = fsrs.review(card, Rating.Good, t0);
    near(out.stability!, 3.0412, 1e-9); // w[2]
    near(out.difficulty!, 4.490943335, 1e-6);
    expect(out.state).toBe(CardState.Review);
    expect(out.reps).toBe(1);
    expect(out.lapses).toBe(0);
    expect(out.lastReview).toBe(t0);
    near(out.due! - t0, 3.0412 * DAY, DAY * 1e-4);
  });

  it("first Again goes to Learning", () => {
    const out = fsrs.review(newReviewState("s001"), Rating.Again, t0);
    expect(out.state).toBe(CardState.Learning);
    expect(out.reps).toBe(0);
    near(out.stability!, fsrs.initialStability(Rating.Again), 1e-9);
  });

  it("second Good grows stability to the known value", () => {
    const r1 = fsrs.review(newReviewState("s001"), Rating.Good, t0);
    const r2 = fsrs.review(r1, Rating.Good, r1.due!); // review exactly when due (R==0.9)
    near(r2.stability!, 13.2160305565, 1e-6);
    near(r2.difficulty!, 4.2666428817, 1e-6);
    expect(r2.reps).toBe(2);
    expect(r2.state).toBe(CardState.Review);
    expect(r2.stability!).toBeGreaterThan(r1.stability!);
  });

  it("repeated Good intervals strictly increase", () => {
    let card = fsrs.review(newReviewState("s001"), Rating.Good, t0);
    let last = card.due! - card.lastReview!;
    for (let i = 0; i < 5; i++) {
      const next = fsrs.review(card, Rating.Good, card.due!);
      const ivl = next.due! - next.lastReview!;
      expect(ivl).toBeGreaterThan(last);
      last = ivl;
      card = next;
    }
  });

  it("Again after review increments lapses and decays stability (known value)", () => {
    let card = fsrs.review(newReviewState("s001"), Rating.Good, t0);
    card = fsrs.review(card, Rating.Good, card.due!);
    const sBefore = card.stability!;
    const lapsesBefore = card.lapses;
    const lapsed = fsrs.review(card, Rating.Again, card.due!);
    expect(lapsed.lapses).toBe(lapsesBefore + 1);
    expect(lapsed.state).toBe(CardState.Relearning);
    expect(lapsed.stability!).toBeLessThan(sBefore);
    near(lapsed.stability!, 2.7021483251, 1e-6);
  });

  it("stability never drops below the minimum", () => {
    let card = fsrs.review(newReviewState("s001"), Rating.Again, t0);
    for (let i = 1; i <= 5; i++) {
      card = fsrs.review(card, Rating.Again, t0 + i * DAY);
      expect(card.stability!).toBeGreaterThanOrEqual(DEFAULT_PARAMS.minimumStability);
    }
  });
});
