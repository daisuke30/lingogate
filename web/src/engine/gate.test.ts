import { describe, it, expect } from "vitest";
import { suppressUntil, isSuppressed, returnTarget, returnDisplayName } from "./gate";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe("suppression window", () => {
  it("computes the window end from unlock minutes", () => {
    expect(suppressUntil(NOW, 10)).toBe(NOW + 10 * MIN);
    expect(suppressUntil(NOW, 5)).toBe(NOW + 5 * MIN);
  });

  it("is suppressed strictly inside the window", () => {
    const until = suppressUntil(NOW, 10);
    expect(isSuppressed(until, NOW)).toBe(true); // just unlocked
    expect(isSuppressed(until, NOW + 9 * MIN)).toBe(true); // 9 min in
    expect(isSuppressed(until, until - 1)).toBe(true); // 1ms before end
  });

  it("is not suppressed at or after the window end", () => {
    const until = suppressUntil(NOW, 10);
    expect(isSuppressed(until, until)).toBe(false); // boundary is exclusive
    expect(isSuppressed(until, until + 1)).toBe(false);
    expect(isSuppressed(until, NOW + 11 * MIN)).toBe(false);
  });

  it("treats null/undefined as never suppressed", () => {
    expect(isSuppressed(null, NOW)).toBe(false);
    expect(isSuppressed(undefined, NOW)).toBe(false);
  });
});

describe("return-app map", () => {
  it("resolves known apps case-insensitively", () => {
    expect(returnTarget("tiktok")?.urlCandidates[0]).toBe("tiktok://");
    expect(returnTarget("TikTok")?.displayName).toBe("TikTok");
    expect(returnDisplayName("youtube")).toBe("YouTube");
  });

  it("falls back to the raw key for unknown apps", () => {
    expect(returnTarget("myspace")).toBeUndefined();
    expect(returnDisplayName("myspace")).toBe("myspace");
  });
});
