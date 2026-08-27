// Pure step logic for the onboarding funnel (LINGO-017). Design ref:
// ai-org/Ideas/20260827-lingogate-multilang-design.md §3.5 (5 static screens,
// copy confirmed) + §4 (course-select step after the intro). Kept separate
// from the React layer (ui/OnboardingFlow.tsx) so the screen-advancing state
// machine is unit-testable without a DOM.

export const ONBOARDING_SCREEN_COUNT = 5;

export type OnboardingAction = "next" | "back" | "skip";

/** "skipped" = the learner bailed out early (any screen's skip link) — the
 * whole point of "いつでもスキップ可" is that this is a normal, expected exit,
 * not an error. "completed" = they went next through all 5 screens, which
 * hands off to the course-select step (§4), never straight to skipped's
 * behaviour (straight back to Home). A plain number is the next screen index. */
export type OnboardingStepResult = number | "skipped" | "completed";

/**
 * Advance (or abandon) the intro screens. `back` floors at screen 0 rather
 * than exiting — there is no "back past the start" concept, matching the
 * placement test's UI in spirit (no destructive edge behaviour from a stray
 * tap).
 */
export function advanceOnboarding(
  currentIndex: number,
  action: OnboardingAction,
): OnboardingStepResult {
  if (action === "skip") return "skipped";
  if (action === "back") return Math.max(0, currentIndex - 1);
  const next = currentIndex + 1;
  return next >= ONBOARDING_SCREEN_COUNT ? "completed" : next;
}
