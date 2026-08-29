// Pure interaction logic for FlashcardCard (LINGO-019): the rating gate +
// direction->Rating mapping shared by the flick gesture and the tap-to-grade
// buttons, plus the repeatable flip-toggle state machine (tap flips either
// direction, any number of times, but the 1.5s reveal-lock timer arms only
// once). Split out because this repo has no component-render test setup (no
// @testing-library/react — every existing UI test targets a pure engine/state
// function instead), so this is how these behaviours get tested at all.

import { Rating } from "./fsrs";

export type FlickDirection = "again" | "hard" | "good";

/** Maps a flick/tap direction to the FSRS Rating it grades as — the single
 * place this mapping is defined, so the flick release and the tap-to-grade
 * button are guaranteed to always agree. */
export function ratingForDirection(dir: FlickDirection): Rating {
  return dir === "again" ? Rating.Again : dir === "hard" ? Rating.Hard : Rating.Good;
}

/**
 * Can the learner submit a rating right now? LINGO-019 follow-up (Katsuta
 * 2026-08-30, explicit instruction): grading is now available on EITHER
 * face — flipping to the back is no longer a precondition. The only gate
 * left is the anti-gate-skip freeze (LINGO-007's FLICK_LOCK_MS), counted
 * from when the card itself was shown (component mount), not from any flip
 * event. Applies uniformly to practice mode and the toll gate alike — a
 * deliberate loosening of the gate's friction, per Katsuta's own call, not
 * an oversight.
 */
export function canGradeNow(lockElapsed: boolean): boolean {
  return lockElapsed;
}

// -- Repeatable flip toggle (LINGO-019 follow-up: tap flips either direction,
// any number of times) --------------------------------------------------

export interface FlipToggleResult {
  flipped: boolean;
  /** True exactly when this toggle transitions TO the back — the flip tap is
   * the user gesture iOS requires for audio, and it fires every time,
   * including re-flips (each tap is its own valid gesture). */
  shouldSpeak: boolean;
}

/**
 * Pure state transition for one tap-to-toggle: flips to the opposite face,
 * any number of times. (As of the 2026-08-30 follow-up this no longer also
 * arms a reveal-lock timer — canGradeNow doesn't depend on `flipped` at all
 * anymore, so the only thing left to decide here is the toggle itself and
 * whether to speak.)
 */
export function applyFlipToggle(flipped: boolean): FlipToggleResult {
  const next = !flipped;
  return { flipped: next, shouldSpeak: next };
}
