import { describe, it, expect } from "vitest";
import { Rating } from "./fsrs";
import { INITIAL_FLIP_STATE, applyFlipToggle, canGradeNow, ratingForDirection } from "./grading";
import type { FlipLockState } from "./grading";

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

describe("canGradeNow (the tap-button + flick shared gate)", () => {
  it("requires BOTH flipped and the post-flip lock elapsed", () => {
    expect(canGradeNow(false, false)).toBe(false);
    expect(canGradeNow(false, true)).toBe(false); // not flipped yet -> never gradable
    expect(canGradeNow(true, false)).toBe(false); // flipped but still within the 1.5s freeze
    expect(canGradeNow(true, true)).toBe(true);
  });
});

// LINGO-019 follow-up (Katsuta 2026-08-28): tap flips the card either
// direction, any number of times, but the reveal-lock timer must arm only
// once — flipping back to the front and back again must NOT re-lock canEval.
describe("applyFlipToggle (repeatable flip, one-shot lock arming)", () => {
  it("first flip to the back: arms the lock and speaks", () => {
    const { next, shouldArmLock, shouldSpeak } = applyFlipToggle(INITIAL_FLIP_STATE);
    expect(next).toEqual({ flipped: true, lockArmed: true });
    expect(shouldArmLock).toBe(true);
    expect(shouldSpeak).toBe(true);
  });

  it("flipping back to the front arms/speaks nothing, and does not reset lockArmed", () => {
    const backState: FlipLockState = { flipped: true, lockArmed: true };
    const { next, shouldArmLock, shouldSpeak } = applyFlipToggle(backState);
    expect(next).toEqual({ flipped: false, lockArmed: true }); // lockArmed survives
    expect(shouldArmLock).toBe(false);
    expect(shouldSpeak).toBe(false);
  });

  it("a second (and third) flip to the back never re-arms the lock, but still speaks each time", () => {
    let state = INITIAL_FLIP_STATE;
    let r = applyFlipToggle(state); // -> back, 1st time
    expect(r.shouldArmLock).toBe(true);
    state = r.next;

    r = applyFlipToggle(state); // -> front
    state = r.next;

    r = applyFlipToggle(state); // -> back, 2nd time
    expect(r.shouldArmLock).toBe(false); // THE regression this test guards against
    expect(r.shouldSpeak).toBe(true); // read-aloud still repeats
    expect(r.next).toEqual({ flipped: true, lockArmed: true });
    state = r.next;

    r = applyFlipToggle(state); // -> front again
    state = r.next;
    r = applyFlipToggle(state); // -> back, 3rd time
    expect(r.shouldArmLock).toBe(false);
  });

  it("toggling many times in a row always alternates flipped and never unsets lockArmed once true", () => {
    let state = INITIAL_FLIP_STATE;
    for (let i = 0; i < 8; i++) {
      const before = state.flipped;
      state = applyFlipToggle(state).next;
      expect(state.flipped).toBe(!before);
      if (before === false && state.flipped === true) {
        // any transition to the back leaves (or keeps) the lock armed
        expect(state.lockArmed).toBe(true);
      }
    }
  });
});
