// LINGO-028 — renders a 32×32 char grid as crisp SVG rects. Horizontal runs of
// the same colour are merged into a single <rect> (run-length) to keep the DOM
// light, and the viewBox is the 32-unit grid so the sprite scales to any size
// with no blur (shapeRendering="crispEdges").

import { useMemo } from "react";
import type { CSSProperties } from "react";
import { GRID } from "./draw";

interface Props {
  grid: string[];
  palette: Record<string, string>;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function PixelSprite({ grid, palette, size = 96, className, style, title }: Props) {
  const rects = useMemo(() => {
    const out: Array<{ x: number; y: number; w: number; fill: string }> = [];
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        if (ch === ".") {
          x++;
          continue;
        }
        let x2 = x + 1;
        while (x2 < row.length && row[x2] === ch) x2++;
        out.push({ x, y, w: x2 - x, fill: palette[ch] ?? "#ff00ff" });
        x = x2;
      }
    }
    return out;
  }, [grid, palette]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role="img"
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
