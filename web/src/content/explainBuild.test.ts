import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildWordChunk, buildSentenceChunk } from "../../scripts/build-explain.mjs";

// LINGO-056: the explain-content build is deliberately separate from
// build-content.mjs/deck.*.json (see build-explain.mjs's own header
// comment — this is lazy-loaded chunk data for LINGO-057's UI, served from
// public/explain/, never part of the initial app bundle). Generation is
// INCREMENTAL — this task's contract is 3000 word entries + 2135 sentence
// entries, produced over multiple sessions — so these tests assert
// STRUCTURAL correctness of whatever has been generated so far, not
// completeness. A 100%-coverage assertion belongs to a later task once
// generation actually finishes.
describe("explain content build (LINGO-056)", () => {
  for (const lang of ["ja", "en"] as const) {
    describe(`${lang} word dictionary chunk`, () => {
      const data = buildWordChunk(lang) as Record<string, any>;

      it("is non-empty (progress so far)", () => {
        expect(Object.keys(data).length).toBeGreaterThan(0);
      });

      it("every present entry is structurally complete", () => {
        for (const lemma of Object.keys(data)) {
          const w = data[lemma];
          expect(w.lemma).toBe(lemma);
          expect(typeof w.pos).toBe("string");
          expect(w.pos.length).toBeGreaterThan(0);
          expect(typeof w.etymology).toBe("string");
          expect(w.etymology.length).toBeGreaterThan(0);
          expect(typeof w.commonMistakes).toBe("string");
          expect(w.commonMistakes.length).toBeGreaterThan(0);
          expect(Array.isArray(w.related)).toBe(true);
          expect(w.related.length).toBeGreaterThanOrEqual(1);
          expect(Array.isArray(w.collocations)).toBe(true);
          expect(w.collocations.length).toBeGreaterThanOrEqual(2);
          expect(w.collocations.length).toBeLessThanOrEqual(3);
          // forms iff pos in {verb, noun, adj}; aspectUsage iff pos === verb
          if (["verb", "noun", "adj"].includes(w.pos)) {
            expect(w.forms).not.toBeNull();
          } else {
            expect(w.forms).toBeNull();
          }
          if (w.pos === "verb") {
            expect(typeof w.aspectUsage).toBe("string");
            expect(w.aspectUsage.length).toBeGreaterThan(0);
          } else {
            expect(w.aspectUsage).toBeNull();
          }
        }
      });
    });

    describe(`${lang} sentence commentary chunk`, () => {
      const data = buildSentenceChunk(lang) as Record<string, any>;

      it("is a valid object (may be empty if sentence generation hasn't started yet)", () => {
        expect(typeof data).toBe("object");
      });

      it("every present entry is structurally complete", () => {
        for (const id of Object.keys(data)) {
          const s = data[id];
          expect(s.id).toBe(id);
          expect(Array.isArray(s.skeleton)).toBe(true);
          expect(s.skeleton.length).toBeGreaterThan(0);
          for (const item of s.skeleton) {
            expect(typeof item.surface).toBe("string");
            expect(item.surface.length).toBeGreaterThan(0);
            expect(typeof item.note).toBe("string");
            expect(item.note.length).toBeGreaterThan(0);
          }
          expect(typeof s.keyPoint).toBe("string");
          expect(s.keyPoint.length).toBeGreaterThan(0);
          expect(Array.isArray(s.replies)).toBe(true);
          expect(s.replies.length).toBeGreaterThanOrEqual(2);
          expect(s.replies.length).toBeLessThanOrEqual(3);
          for (const reply of s.replies) {
            expect(typeof reply.ru).toBe("string");
            expect(reply.ru.length).toBeGreaterThan(0);
            expect(typeof reply.gloss).toBe("string");
            expect(reply.gloss.length).toBeGreaterThan(0);
          }
        }
      });
    });
  }
});
