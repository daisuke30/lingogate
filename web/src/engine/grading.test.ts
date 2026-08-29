import { describe, it, expect } from "vitest";
import { Rating } from "./fsrs";
import { applyFlipToggle, canGradeNow, ratingForDirection } from "./grading";

// LINGO-019: tap-to-grade buttons share this exact gate + mapping with the
// flick gesture (FlashcardCard.tsx delegates to both instead of re-deriving
// them), so pinning these pins the button behaviour too.

describe("ratingForDirection", () => {
  it("maps each direction to its FSRS Rating", () => {
    expect(ratingForDirection("again")).toBe(Rating.Again);
    expect(ratingForDirection("hard")).toBe(Rating.Hard);
    expect(ratingForDirection("good")).toBe(Rating.Good);
  });
});

// LINGO-019 follow-up (Katsuta 2026-08-30, explicit instruction): grading is
// now available on EITHER face — the front-face-only restriction is gone.
// canGradeNow's only input is "has the anti-gate-skip timer elapsed", counted
// from when the card was shown (component mount), not from any flip.
describe("canGradeNow (the tap-button + flick shared gate, mount-timer only)", () => {
  it("is exactly the elapsed-lock flag — flip state is no longer a factor", () => {
    expect(canGradeNow(false)).toBe(false); // still within the 1.5s freeze
    expect(canGradeNow(true)).toBe(true); // freeze elapsed -> gradable, front or back
  });
});

// LINGO-019 follow-up: tap flips the card either direction, any number of
// times. The flip toggle itself no longer has any lock-arming side effect
// (canGradeNow doesn't consult `flipped` at all anymore) — this pure function
// only decides the next `flipped` value and whether to speak.
describe("applyFlipToggle (repeatable flip, no lock-arming side effect)", () => {
  it("flips front -> back and says to speak", () => {
    const r = applyFlipToggle(false);
    expect(r).toEqual({ flipped: true, shouldSpeak: true });
  });

  it("flips back -> front and says not to speak", () => {
    const r = applyFlipToggle(true);
    expect(r).toEqual({ flipped: false, shouldSpeak: false });
  });

  it("alternates indefinitely across repeated toggles", () => {
    let flipped = false;
    for (let i = 0; i < 8; i++) {
      const r = applyFlipToggle(flipped);
      expect(r.flipped).toBe(!flipped);
      expect(r.shouldSpeak).toBe(r.flipped); // speaks iff the new state is "back"
      flipped = r.flipped;
    }
  });
});
