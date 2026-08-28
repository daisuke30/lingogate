import { describe, it, expect } from "vitest";
import { Rating } from "./fsrs";
import { canGradeNow, ratingForDirection } from "./grading";

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
