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
 * Can the learner submit a rating right now? Both input methods (flick
 * release and the tap-to-grade legend buttons) are gated by the exact same
 * rule: the card must be flipped, AND the post-flip anti-gate-skip freeze
 * (LINGO-007's FLICK_LOCK_MS) must have elapsed. A tap button that bypassed
 * this would silently reopen the gate-skip hole the flick-only design closed.
 */
export function canGradeNow(flipped: boolean, lockElapsed: boolean): boolean {
  return flipped && lockElapsed;
}

// -- Repeatable flip toggle (LINGO-019 follow-up: tap flips either direction,
// any number of times) --------------------------------------------------

export interface FlipLockState {
  flipped: boolean;
  /** Has the once-only reveal-lock timer ever been started for this card? */
  lockArmed: boolean;
}

export interface FlipToggleResult {
  next: FlipLockState;
  /** True exactly once per card: the very first transition to the back.
   * FlashcardCard starts its 1.5s anti-gate-skip timer only when this is
   * true — flipping back to the front and back again must NOT re-lock
   * (canEval, once unlocked, stays unlocked for the rest of the card). */
  shouldArmLock: boolean;
  /** True on every transition to the back (including re-flips) — each tap is
   * its own valid user gesture, so the read-aloud repeats on request. */
  shouldSpeak: boolean;
}

export const INITIAL_FLIP_STATE: FlipLockState = { flipped: false, lockArmed: false };

/** Pure state transition for one tap-to-toggle. See FlipToggleResult's field
 * docs for exactly what each flag means and why. */
export function applyFlipToggle(state: FlipLockState): FlipToggleResult {
  const flipped = !state.flipped;
  if (!flipped) {
    // Flipping back to the front arms/speaks nothing; lockArmed is a one-way
    // latch and is never reset by going back to the front.
    return { next: { flipped, lockArmed: state.lockArmed }, shouldArmLock: false, shouldSpeak: false };
  }
  return {
    next: { flipped, lockArmed: true },
    shouldArmLock: !state.lockArmed,
    shouldSpeak: true,
  };
}
