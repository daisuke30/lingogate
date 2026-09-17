import { describe, it, expect } from "vitest";
import { ONBOARDING_SCREEN_COUNT, advanceOnboarding } from "./onboarding";

describe("advanceOnboarding (LINGO-017 intro screen flow)", () => {
  it("has 6 screens per the confirmed design (§3.5)", () => {
    // LINGO-052 added the "sentences you can actually say" screen after the
    // one-new-word-per-sentence screen.
    expect(ONBOARDING_SCREEN_COUNT).toBe(6);
  });

  it("next walks through every screen, then completes on the last one's CTA", () => {
    let idx: number | string = 0;
    for (let i = 0; i < ONBOARDING_SCREEN_COUNT - 1; i++) {
      idx = advanceOnboarding(idx as number, "next");
      expect(idx).toBe(i + 1);
    }
    // idx is now the last screen — one more "next" (its CTA) completes the funnel.
    expect(advanceOnboarding(idx as number, "next")).toBe("completed");
  });

  it("skip exits immediately from any screen, including the very first", () => {
    expect(advanceOnboarding(0, "skip")).toBe("skipped");
    expect(advanceOnboarding(2, "skip")).toBe("skipped");
    expect(advanceOnboarding(ONBOARDING_SCREEN_COUNT - 1, "skip")).toBe("skipped");
  });

  it("back steps down by one and floors at screen 0 (no exit-via-back)", () => {
    expect(advanceOnboarding(3, "back")).toBe(2);
    expect(advanceOnboarding(1, "back")).toBe(0);
    expect(advanceOnboarding(0, "back")).toBe(0);
  });
});
