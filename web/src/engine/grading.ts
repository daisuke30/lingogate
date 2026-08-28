// Pure grading logic shared by FlashcardCard's flick gesture AND its
// tap-to-grade buttons (LINGO-019), and by the analogous "can I submit a
// judgement right now" question elsewhere. Split out so the gating rule and
// the direction->Rating mapping are unit-testable without a DOM — this repo
// has no React component-render test setup (no @testing-library/react; every
// existing UI test targets a pure engine/state function instead), so this is
// the same pattern applied to the new tap-grading behaviour.

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
