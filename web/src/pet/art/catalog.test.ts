// LINGO-028 — catalog completeness. Guards the design §3 contract (16 species,
// stage counts 1/2/7/3/3, unique ids, 3-language names) and — crucially — that
// every pixel of every expression resolves to a defined colour (catches a
// silhouette that references a palette key it never declared).

import { describe, expect, it } from "vitest";
import { SPECIES_META, ART } from "./catalog";
import { PET_SPECIES, PET_SPECIES_BY_ID } from "./index";
import { composite, FACE_COLORS } from "./faces";
import { EXPRESSIONS, type Stage } from "./types";

const EXPECTED_STAGE_COUNTS: Record<Stage, number> = {
  baby: 1,
  growth: 2,
  mature: 7,
  perfect: 3,
  ultimate: 3,
};

describe("pet species catalog", () => {
  it("has exactly 16 species", () => {
    expect(SPECIES_META).toHaveLength(16);
    expect(PET_SPECIES).toHaveLength(16);
  });

  it("matches the design §3 stage distribution (1/2/7/3/3)", () => {
    const counts: Record<string, number> = {};
    for (const s of SPECIES_META) counts[s.stage] = (counts[s.stage] ?? 0) + 1;
    expect(counts).toEqual(EXPECTED_STAGE_COUNTS);
  });

  it("has unique speciesIds", () => {
    const ids = SPECIES_META.map((s) => s.speciesId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has art registered for every speciesId", () => {
    for (const s of SPECIES_META) {
      expect(ART[s.speciesId], `missing ART for ${s.speciesId}`).toBeDefined();
    }
  });

  it("carries all three UI-language names", () => {
    for (const s of SPECIES_META) {
      for (const lang of ["ja", "en", "ru"] as const) {
        expect(s.name[lang], `${s.speciesId}.${lang}`).toBeTruthy();
      }
    }
  });

  it("exposes a lookup-by-id map covering every entry", () => {
    for (const s of SPECIES_META) {
      expect(PET_SPECIES_BY_ID[s.speciesId]?.speciesId).toBe(s.speciesId);
    }
  });
});

describe("sprite integrity", () => {
  it("every base grid is 32×32", () => {
    for (const [id, art] of Object.entries(ART)) {
      expect(art.base, `${id} rows`).toHaveLength(32);
      for (const row of art.base) expect(row, `${id} row width`).toHaveLength(32);
    }
  });

  it("renders all 4 expressions with only defined colours and visible pixels", () => {
    for (const [id, art] of Object.entries(ART)) {
      const palette = { ...FACE_COLORS, ...art.palette };
      for (const expr of EXPRESSIONS) {
        const grid = composite(art, expr);
        expect(grid, `${id}/${expr} rows`).toHaveLength(32);
        let painted = 0;
        for (const row of grid) {
          for (const ch of row) {
            if (ch === ".") continue;
            painted++;
            expect(palette[ch], `${id}/${expr} undefined colour '${ch}'`).toBeDefined();
          }
        }
        // a real monster fills a meaningful chunk of the canvas
        expect(painted, `${id}/${expr} too sparse`).toBeGreaterThan(120);
      }
    }
  });
});
