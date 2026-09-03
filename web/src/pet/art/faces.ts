// LINGO-028 — expression system. Every species shares one face vocabulary
// (consistent "franchise" look) stamped over its own silhouette. The base grid
// carries NO eyes/mouth — all four expressions draw their own, so switching
// expression never leaves stray pixels from another.

import { Canvas } from "./draw";
import type { Expression, SpeciesArt } from "./types";

/** Fixed colours for the face/effect layer, merged into every palette.
 * B eye, W shine, P mouth, p blush, S sweat drop, G dirt, o outline. */
export const FACE_COLORS: Record<string, string> = {
  B: "#2b2733",
  W: "#ffffff",
  P: "#d94f63",
  p: "#ff9ab0",
  S: "#7cc6ff",
  G: "#6b4f34",
  o: "#2b2733",
};

// Eyes — anchored top-left, 3 cols wide. 'B' dark, 'W' shine.
const EYES: Record<Expression, string[]> = {
  normal: ["BBB", "BWB", "BBB"],
  joy: [".B.", "B.B"], // ∧  closed happy eyes
  hungry: ["BWB", "BBB", "BBB"], // shine up = pleading / looking up
  dirty: ["ooo", "BBB"], // heavy drooping lid
};

// Mouths — anchored top-left. 'o' outline line, 'P' mouth/tongue.
const MOUTHS: Record<Expression, string[]> = {
  normal: ["o..o", ".oo."], // small content smile ⌣
  joy: ["oooo", "PPPP", ".PP."], // open laugh with tongue
  hungry: [".oo.", "oPPo", ".oo."], // round drooling "o"
  dirty: [".oo.", "o..o"], // wavy frown ⌢
};

function stampInto(grid: string[][], x0: number, y0: number, rows: string[]): void {
  rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch === ".") return;
      const x = x0 + dx;
      const y = y0 + dy;
      if (x >= 0 && x < grid[0].length && y >= 0 && y < grid.length) grid[y][x] = ch;
    });
  });
}

/** Compose a species' base grid with the face + per-expression extras. */
export function composite(art: SpeciesArt, expr: Expression): string[] {
  const grid = art.base.map((r) => [...r]);
  const { eyeY, eyeLx, eyeRx, mouthX, mouthY } = art.face;

  stampInto(grid, eyeLx, eyeY, EYES[expr]);
  stampInto(grid, eyeRx, eyeY, EYES[expr]);
  stampInto(grid, mouthX, mouthY, MOUTHS[expr]);

  if (expr === "joy") {
    // Blush just below each eye.
    stampInto(grid, eyeLx, eyeY + 3, ["pp"]);
    stampInto(grid, eyeRx + 1, eyeY + 3, ["pp"]);
  } else if (expr === "hungry") {
    // Sweat drop by the right temple.
    stampInto(grid, eyeRx + 4, eyeY, [".S", "SS"]);
  } else if (expr === "dirty") {
    for (const [dx, dy] of art.dirt ?? []) {
      stampInto(grid, dx, dy, ["GG", "GG"]);
    }
  }

  return grid.map((r) => r.join(""));
}

/** Helper for species modules: paint → outline → freeze into a SpeciesArt. */
export function build(
  paint: (c: Canvas) => void,
  palette: Record<string, string>,
  face: SpeciesArt["face"],
  dirt?: SpeciesArt["dirt"],
): SpeciesArt {
  const c = new Canvas();
  paint(c);
  c.outline("o");
  return { base: c.toGrid(), palette, face, dirt };
}
