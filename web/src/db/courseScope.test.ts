import { describe, it, expect } from "vitest";
import { belongsToCourse, scopeKey, unscopeKey } from "./courseScope";

// LINGO-014: per-course learning-state separation. These pin the two guarantees
// the Task Contract calls out: (1) courseId-separated progress never mixes, and
// (2) pre-LINGO-014 records (bare keys) read back as the default RU course.

describe("course key scoping (LINGO-014 progress separation)", () => {
  it("leaves RU keys bare — old records are read back unchanged as RU", () => {
    // A legacy row was stored with a bare sentenceId / lemma (no courseId).
    const legacyKey = "T0001";
    expect(scopeKey("ru", legacyKey)).toBe("T0001"); // RU writes stay bare
    expect(belongsToCourse("ru", legacyKey)).toBe(true); // and are owned by RU
    expect(unscopeKey("ru", legacyKey)).toBe("T0001"); // read back verbatim
  });

  it("namespaces non-RU courses so their keys can't collide with RU's", () => {
    expect(scopeKey("en", "T0001")).toBe("en::T0001");
    expect(unscopeKey("en", scopeKey("en", "T0001"))).toBe("T0001"); // round-trips
  });

  it("keeps two courses' identically-named cards in separate namespaces", () => {
    const ruKey = scopeKey("ru", "T0001"); // "T0001"
    const enKey = scopeKey("en", "T0001"); // "en::T0001"
    expect(ruKey).not.toBe(enKey);
    // RU only owns bare keys; EN only owns its own prefix. No overlap.
    expect(belongsToCourse("ru", ruKey)).toBe(true);
    expect(belongsToCourse("ru", enKey)).toBe(false);
    expect(belongsToCourse("en", enKey)).toBe(true);
    expect(belongsToCourse("en", ruKey)).toBe(false);
  });

  it("a getAll()-then-filter read returns only the active course's rows, unscoped", () => {
    // Simulate the raw store contents after RU has been used AND an EN course row exists.
    const stored = ["T0001", "T0002", "en::T0001", "en::T0050"]; // mixed bare + en::
    const ruView = stored.filter((k) => belongsToCourse("ru", k)).map((k) => unscopeKey("ru", k));
    const enView = stored.filter((k) => belongsToCourse("en", k)).map((k) => unscopeKey("en", k));
    expect(ruView).toEqual(["T0001", "T0002"]); // no EN leakage
    expect(enView).toEqual(["T0001", "T0050"]); // bare deck ids, prefix stripped
  });

  it("Cyrillic lemmas (RU) never look like a namespaced key", () => {
    // wordKnowledge is keyed by lemma; RU lemmas are Cyrillic and contain no "::".
    expect(belongsToCourse("ru", "делать")).toBe(true);
    expect(belongsToCourse("en", "делать")).toBe(false);
  });
});
