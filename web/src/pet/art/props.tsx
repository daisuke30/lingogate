// LINGO-028 — shared care props: egg (whole + cracked), poop, food (steamed
// bun), and a simple depart-effect star. Same 32×32 pixel pipeline as monsters.

import { Canvas } from "./draw";
import { PixelSprite } from "./PixelSprite";

function grid(paint: (c: Canvas) => void): string[] {
  const c = new Canvas();
  paint(c);
  c.outline("o");
  return c.toGrid();
}

const EGG = grid((c) => {
  c.ellipse(16, 18, 7, 9, "a");
  c.ellipse(16, 21, 4.5, 5, "c"); // sheen
  c.ellipse(12, 22, 1.2, 1, "d"); // speckles
  c.ellipse(19, 16, 1, 1, "d");
  c.ellipse(15, 25, 1, 0.8, "d");
});

const EGG_CRACKED = grid((c) => {
  c.ellipse(16, 18, 7, 9, "a");
  c.ellipse(16, 21, 4.5, 5, "c");
  // jagged crack across the middle
  c.stamp(9, 17, ["oo......", "..o.o..o", ".o.o.oo.", "o......o"], { o: "o" });
  c.ellipse(12, 22, 1.2, 1, "d");
  c.ellipse(19, 24, 1, 1, "d");
});

const POOP = grid((c) => {
  c.ellipse(16, 26, 6.5, 2.6, "a"); // stacked swirl
  c.ellipse(16, 22, 5, 2.6, "a");
  c.ellipse(16, 19, 3.4, 2.4, "a");
  c.ellipse(16, 16, 1.4, 2, "a"); // tip
  c.ellipse(14, 24, 2, 1.2, "c"); // sheen
});

const FOOD = grid((c) => {
  c.ellipse(16, 19, 8, 6.5, "a"); // bun
  c.ellipse(16, 20, 6, 4.5, "c"); // light front
  c.spikeUp(16, 13, 3, 2, "d"); // top twist
  c.set(16, 19, "d"); // pleat marks
  c.set(11, 21, "d");
  c.set(21, 21, "d");
});

const STAR = grid((c) => {
  c.stamp(11, 6, [
    "...d...",
    "...d...",
    "..ddd..",
    "ddddddd",
    "..ddd..",
    "...d...",
    "...d...",
  ]);
  c.set(16, 15, "d");
});

const EGG_PALETTE = { a: "#f6ecd9", c: "#fffaf0", d: "#c9a86e", o: "#8a7a5f" };
const POOP_PALETTE = { a: "#7a5a3a", c: "#9a744c", o: "#3f2c18" };
const FOOD_PALETTE = { a: "#f2e6cf", c: "#fff6e6", d: "#caa46a", o: "#9a7a4e" };
const STAR_PALETTE = { d: "#ffe27a", o: "#e0a92e" };

interface PropProps {
  size?: number;
  className?: string;
}

export function EggSprite({ size = 64, className }: PropProps) {
  return <PixelSprite grid={EGG} palette={EGG_PALETTE} size={size} className={className} title="egg" />;
}
export function EggCrackedSprite({ size = 64, className }: PropProps) {
  return (
    <PixelSprite grid={EGG_CRACKED} palette={EGG_PALETTE} size={size} className={className} title="egg-cracked" />
  );
}
export function PoopSprite({ size = 48, className }: PropProps) {
  return <PixelSprite grid={POOP} palette={POOP_PALETTE} size={size} className={className} title="poop" />;
}
export function FoodSprite({ size = 48, className }: PropProps) {
  return <PixelSprite grid={FOOD} palette={FOOD_PALETTE} size={size} className={className} title="food" />;
}
export function StarSprite({ size = 32, className }: PropProps) {
  return <PixelSprite grid={STAR} palette={STAR_PALETTE} size={size} className={className} title="star" />;
}
