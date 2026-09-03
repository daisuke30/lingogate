// LINGO-028 — a tiny, dependency-free pixel-art drawing DSL.
//
// Everything here is pure and deterministic: a 32×32 char grid painted with
// simple geometric primitives, then given a thick 8-neighbour outline. Species
// silhouettes are composed from discs / ellipses / spikes / stamps so each
// monster is authored as a short paint() function instead of 1,024 hand-typed
// pixels. The output is a `string[]` (32 rows of 32 chars) where '.' is
// transparent and every other char is a palette key resolved at render time.

export const GRID = 32;

/** A small pixel patch: rows of chars, '.' = leave whatever is underneath. */
export type Stamp = string[];

export class Canvas {
  readonly cells: string[][];

  constructor() {
    this.cells = Array.from({ length: GRID }, () => Array<string>(GRID).fill("."));
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < GRID && y >= 0 && y < GRID;
  }

  set(x: number, y: number, ch: string): void {
    if (this.inBounds(x, y)) this.cells[y][x] = ch;
  }

  get(x: number, y: number): string {
    return this.inBounds(x, y) ? this.cells[y][x] : ".";
  }

  /** Filled axis-aligned ellipse centred at (cx,cy). */
  ellipse(cx: number, cy: number, rx: number, ry: number, fill: string): void {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1.02) this.set(x, y, fill);
      }
    }
  }

  disc(cx: number, cy: number, r: number, fill: string): void {
    this.ellipse(cx, cy, r, r, fill);
  }

  rect(x0: number, y0: number, w: number, h: number, fill: string): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) this.set(x, y, fill);
    }
  }

  /** Rounded rect (corners clipped) — reads softer than a bare rect. */
  roundRect(x0: number, y0: number, w: number, h: number, fill: string): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const corner =
          (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
        if (!corner) this.set(x, y, fill);
      }
    }
  }

  /** Upward spike/triangle: base at baseY, apex `height` rows above. */
  spikeUp(cx: number, baseY: number, height: number, halfBase: number, fill: string): void {
    for (let i = 0; i < height; i++) {
      const frac = 1 - i / height;
      const hw = Math.round(halfBase * frac);
      for (let x = cx - hw; x <= cx + hw; x++) this.set(x, baseY - i, fill);
    }
  }

  spikeDown(cx: number, topY: number, height: number, halfBase: number, fill: string): void {
    for (let i = 0; i < height; i++) {
      const frac = 1 - i / height;
      const hw = Math.round(halfBase * frac);
      for (let x = cx - hw; x <= cx + hw; x++) this.set(x, topY + i, fill);
    }
  }

  spikeSide(cx: number, cy: number, len: number, half: number, fill: string, dir: 1 | -1): void {
    for (let i = 0; i < len; i++) {
      const frac = 1 - i / len;
      const hh = Math.round(half * frac);
      for (let y = cy - hh; y <= cy + hh; y++) this.set(cx + dir * i, y, fill);
    }
  }

  /** Hollow ring (for halos). */
  ring(cx: number, cy: number, r: number, fill: string): void {
    this.disc(cx, cy, r, fill);
    this.disc(cx, cy, r - 1.6, ".");
  }

  /** Overlay a small pixel patch; '.' cells are skipped. */
  stamp(x0: number, y0: number, rows: Stamp, remap?: Record<string, string>): void {
    rows.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === ".") return;
        this.set(x0 + dx, y0 + dy, remap ? remap[ch] ?? ch : ch);
      });
    });
  }

  /** Thick 8-neighbour outline: every empty cell touching a filled cell. */
  outline(color = "o"): void {
    const src = this.cells.map((r) => r.slice());
    const solid = (x: number, y: number): boolean => {
      if (!this.inBounds(x, y)) return false;
      const c = src[y][x];
      return c !== "." && c !== color;
    };
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (src[y][x] !== ".") continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (solid(x + dx, y + dy)) {
              near = true;
              break;
            }
          }
        }
        if (near) this.cells[y][x] = color;
      }
    }
  }

  toGrid(): string[] {
    return this.cells.map((r) => r.join(""));
  }
}
