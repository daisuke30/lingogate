import { describe, it, expect } from "vitest";
import { ONBOARDING_SCREEN_COUNT, advanceOnboarding } from "./onboarding";

describe("advanceOnboarding (LINGO-017 intro screen flow)", () => {
  it("has 5 screens per the confirmed design (§3.5)", () => {
    expect(ONBOARDING_SCREEN_COUNT).toBe(5);
  });

  it("next walks through screens 0..3, then completes on the 5th 'next' (from index 4)", () => {
    let idx: number | string = 0;
    for (let i = 0; i < ONBOARDING_SCREEN_COUNT - 1; i++) {
      idx = advanceOnboarding(idx as number, "next");
      expect(idx).toBe(i + 1);
    }
    // idx is now 4 (screen 5) — one more "next" (its CTA) completes the funnel.
    expect(advanceOnboarding(idx as number, "next")).toBe("completed");
  });

  it("skip exits immediately from any screen, including the very first", () => {
    expect(advanceOnboarding(0, "skip")).toBe("skipped");
    expect(advanceOnboarding(2, "skip")).toBe("skipped");
    expect(advanceOnboarding(4, "skip")).toBe("skipped");
  });

  it("back steps down by one and floors at screen 0 (no exit-via-back)", () => {
    expect(advanceOnboarding(3, "back")).toBe(2);
    expect(advanceOnboarding(1, "back")).toBe(0);
    expect(advanceOnboarding(0, "back")).toBe(0);
  });
});
