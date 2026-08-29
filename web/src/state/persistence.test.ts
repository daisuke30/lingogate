import { describe, it, expect } from "vitest";
import { formatBytes } from "./persistence";

describe("formatBytes", () => {
  it("returns null unchanged", () => {
    expect(formatBytes(null)).toBeNull();
  });

  it("formats sub-KB counts as bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB/MB/GB with binary (1024-based) units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(Math.round(1.5 * 1024 * 1024 * 1024))).toBe("1.5 GB");
  });
});
