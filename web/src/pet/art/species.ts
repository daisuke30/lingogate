// LINGO-028 — the 16 original monsters (design §3 lineage tree). Each is a
// short paint() over the 32×32 canvas; `build` adds the thick outline and
// freezes the base grid. Faces are added at render time (see faces.ts), so the
// silhouette below carries NO eyes/mouth. Palette keys: a=body, b=shade,
// c=light/belly, d=accent(差し色), o=outline. B/W/P/p/S/G come from FACE_COLORS.
//
// Naming is original common-noun-based (モチモ/Braylo/…) — no existing IP.

import { build } from "./faces";
import type { SpeciesArt } from "./types";

// ── 1. baby: モチ系 — Mochimo (cream squish blob + sprout) ─────────────────
export const mochi: SpeciesArt = build(
  (c) => {
    c.ellipse(16, 25, 3, 1.5, "a"); // settle shadow foot merge
    c.ellipse(12, 25, 2.5, 2, "a");
    c.ellipse(20, 25, 2.5, 2, "a");
    c.ellipse(16, 17, 9, 8, "a"); // body blob
    c.ellipse(16, 20, 6, 4.5, "c"); // belly light
    c.ellipse(16, 7, 1.4, 2, "d"); // sprout stem
    c.ellipse(18, 6, 2, 1.2, "d"); // leaf
  },
  { a: "#f6ecd9", c: "#fff8ec", d: "#8ed081", o: "#a08a68" },
  { eyeY: 14, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 19 },
  [[9, 20], [21, 15]],
);

// ── 2. growth good: キュート系 — Punilin (round pastel + ears + tail) ───────
export const cutie: SpeciesArt = build(
  (c) => {
    c.ellipse(10, 9, 3, 4, "a"); // ears
    c.ellipse(22, 9, 3, 4, "a");
    c.ellipse(10, 10, 1.4, 2, "d");
    c.ellipse(22, 10, 1.4, 2, "d");
    c.ellipse(25, 22, 2.2, 2, "a"); // tail
    c.ellipse(16, 18, 8, 8, "a"); // body
    c.ellipse(16, 21, 5.5, 4.5, "c"); // belly
    c.ellipse(13, 27, 2.5, 2, "a"); // feet
    c.ellipse(19, 27, 2.5, 2, "a");
  },
  { a: "#ffc4d6", c: "#fff2f7", d: "#ff92bd", o: "#c26688" },
  { eyeY: 15, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 20 },
  [[9, 21], [22, 16]],
);

// ── 3. growth bad: ヨゴレ系 — Yogolen (drab, messy tufts, grime) ────────────
export const grimy: SpeciesArt = build(
  (c) => {
    c.spikeUp(11, 12, 4, 2, "a"); // messy hair tufts
    c.spikeUp(16, 10, 5, 2, "a");
    c.spikeUp(21, 12, 4, 2, "a");
    c.ellipse(16, 18, 8, 7, "a"); // body
    c.ellipse(16, 21, 5, 4, "c"); // dull belly
    c.ellipse(11, 20, 2, 1.5, "d"); // baked grime patches
    c.ellipse(21, 21, 2, 1.5, "d");
    c.ellipse(13, 26, 2.5, 2, "a"); // feet
    c.ellipse(19, 26, 2.5, 2, "a");
  },
  { a: "#8f9470", c: "#abae8c", d: "#5f6347", o: "#3f412e" },
  { eyeY: 15, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 20 },
  [[10, 15], [20, 19], [15, 23]],
);

// ── 4. mature good/N: 勇者系 — Braylo (upright hero, crest, cape emblem) ────
export const hero: SpeciesArt = build(
  (c) => {
    c.spikeUp(16, 6, 4, 2, "d"); // red crest
    c.disc(16, 11, 6, "a"); // head
    c.ellipse(16, 20, 6, 8, "a"); // torso
    c.ellipse(16, 22, 4, 5.5, "c"); // belly
    c.ellipse(9, 19, 2, 3, "a"); // arms
    c.ellipse(23, 19, 2, 3, "a");
    c.ellipse(13, 28, 2.5, 2, "a"); // feet
    c.ellipse(19, 28, 2.5, 2, "a");
    c.ellipse(16, 19, 2, 2, "d"); // chest emblem
  },
  { a: "#5c8fd6", c: "#cfe0f7", d: "#e0574f", o: "#2b3f6b" },
  { eyeY: 9, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 13 },
  [[10, 20], [21, 20]],
);

// ── 5. mature good/R: 賢者系 — Sophio (wizard, pointy hat, beard) ───────────
export const sage: SpeciesArt = build(
  (c) => {
    c.spikeUp(16, 11, 9, 6, "a"); // hat cone
    c.ellipse(16, 3, 1.6, 1.6, "d"); // hat tip pom
    c.rect(10, 10, 12, 2, "d"); // gold band
    c.disc(16, 15, 5, "a"); // face
    c.ellipse(16, 22, 7, 7, "a"); // robe
    c.ellipse(16, 24, 5, 4.5, "c"); // robe front
    c.ellipse(12, 19, 2, 2, "c"); // beard tufts
    c.ellipse(20, 19, 2, 2, "c");
    c.ellipse(16, 20, 3.5, 2, "c");
  },
  { a: "#7b5cc4", c: "#e6ddf6", d: "#ffd94a", o: "#3d2b66" },
  { eyeY: 13, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 17 },
  [[9, 24], [22, 24]],
);

// ── 6. mature neutral/N: わんぱく系 — Wampa (spiky, grin, arms up) ──────────
export const rascal: SpeciesArt = build(
  (c) => {
    c.spikeUp(11, 8, 4, 2, "a"); // spiky hair
    c.spikeUp(16, 6, 5, 2, "a");
    c.spikeUp(21, 8, 4, 2, "a");
    c.disc(16, 12, 6, "a"); // head
    c.ellipse(16, 20, 6, 7, "a"); // body
    c.ellipse(16, 22, 4, 4.5, "c"); // belly
    c.ellipse(8, 15, 2, 3, "a"); // arms up
    c.ellipse(24, 15, 2, 3, "a");
    c.ellipse(13, 27, 2.5, 2, "a"); // feet
    c.ellipse(19, 27, 2.5, 2, "a");
  },
  { a: "#ff9a3c", c: "#ffdba6", d: "#e8622e", o: "#7a3a12" },
  { eyeY: 10, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 14 },
  [[9, 20], [22, 20]],
);

// ── 7. mature neutral/R: まったり系 — Toron (wide low relaxed blob) ─────────
export const mellow: SpeciesArt = build(
  (c) => {
    c.ellipse(16, 20, 10, 6, "a"); // wide body
    c.ellipse(16, 22, 7.5, 4, "c"); // belly
    c.ellipse(6, 21, 2, 2, "a"); // stubby arms
    c.ellipse(26, 21, 2, 2, "a");
    c.ellipse(20, 11, 2, 1, "d"); // leaf on head
    c.ellipse(21, 12, 0.8, 1.4, "d");
  },
  { a: "#7fd0c4", c: "#c4ece6", d: "#7bc86a", o: "#2f6f66" },
  { eyeY: 16, eyeLx: 12, eyeRx: 18, mouthX: 14, mouthY: 21 },
  [[9, 21], [23, 21], [16, 24]],
);

// ── 8. mature bad: ドロ系 — Doron (dripping mud blob) ───────────────────────
export const mud: SpeciesArt = build(
  (c) => {
    c.ellipse(11, 11, 3, 2, "a"); // top lumps
    c.ellipse(21, 12, 3, 2, "a");
    c.ellipse(16, 17, 9, 7, "a"); // body
    c.spikeDown(10, 22, 4, 1.4, "a"); // drips
    c.spikeDown(16, 23, 5, 1.8, "a");
    c.spikeDown(22, 22, 4, 1.4, "a");
    c.ellipse(13, 14, 3, 2, "c"); // glossy highlight
  },
  { a: "#6b4f34", c: "#8a6a44", d: "#4f3a26", o: "#332616" },
  { eyeY: 13, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 18 },
  [[9, 19], [22, 14], [15, 21]],
);

// ── 9. mature bad: イガイガ系 — Togero (spike-burr) ─────────────────────────
export const spiky: SpeciesArt = build(
  (c) => {
    // radial spikes first, core covers their bases
    c.spikeUp(16, 11, 5, 2, "d");
    c.spikeUp(10, 13, 4, 2, "d");
    c.spikeUp(22, 13, 4, 2, "d");
    c.spikeDown(16, 23, 5, 2, "d");
    c.spikeDown(10, 21, 4, 2, "d");
    c.spikeDown(22, 21, 4, 2, "d");
    c.spikeSide(9, 17, 5, 2, "d", -1);
    c.spikeSide(23, 17, 5, 2, "d", 1);
    c.disc(16, 17, 6, "a"); // core
    c.ellipse(16, 19, 4, 3.5, "c"); // core light
  },
  { a: "#7a5aa8", c: "#a583d4", d: "#48356e", o: "#241a3c" },
  { eyeY: 14, eyeLx: 12, eyeRx: 18, mouthX: 14, mouthY: 18 },
  [[11, 19], [20, 19]],
);

// ── 10. mature rare: 天使系 — Lumina (halo, wings, gold) ────────────────────
export const angel: SpeciesArt = build(
  (c) => {
    c.ellipse(7, 15, 4, 6, "c"); // wings behind
    c.ellipse(25, 15, 4, 6, "c");
    c.ellipse(7, 15, 1, 5, "d"); // feather line
    c.ellipse(25, 15, 1, 5, "d");
    c.ellipse(16, 18, 7, 8, "a"); // body
    c.ellipse(16, 21, 5, 5, "c"); // belly
    c.ring(16, 5, 3.2, "d"); // halo
    c.ellipse(13, 27, 2.3, 2, "a"); // feet
    c.ellipse(19, 27, 2.3, 2, "a");
  },
  { a: "#fbfcff", c: "#e4eefc", d: "#ffd94a", o: "#8a93b8" },
  { eyeY: 15, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 20 },
  [[10, 21], [22, 15]],
);

// ── 11. perfect good: 騎士系 — Garda (armored knight, plume) ────────────────
export const knight: SpeciesArt = build(
  (c) => {
    c.spikeUp(16, 5, 5, 2, "d"); // red plume
    c.disc(16, 12, 6, "a"); // helmet head
    c.rect(10, 9, 12, 2, "b"); // helmet brow
    c.ellipse(16, 20, 7, 8, "a"); // torso armor
    c.ellipse(16, 22, 4.5, 5, "c"); // breastplate light
    c.ellipse(8, 17, 3, 3, "a"); // shoulder pads
    c.ellipse(24, 17, 3, 3, "a");
    c.ellipse(8, 17, 2, 2, "b");
    c.ellipse(24, 17, 2, 2, "b");
    c.rect(12, 27, 3, 3, "b"); // legs
    c.rect(17, 27, 3, 3, "b");
    c.stamp(15, 18, [".d.", "ddd", ".d."]); // chest cross
  },
  { a: "#8fa3bf", b: "#5f7192", c: "#c7d3e6", d: "#e0574f", o: "#33405c" },
  { eyeY: 11, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 15 },
  [[10, 22], [21, 22]],
);

// ── 12. perfect neutral: 獣王系 — Gaoru (maned beast) ──────────────────────
export const beastKing: SpeciesArt = build(
  (c) => {
    c.disc(16, 13, 8, "d"); // mane
    c.spikeUp(16, 4, 4, 2, "d"); // mane spikes
    c.spikeUp(9, 8, 3, 2, "d");
    c.spikeUp(23, 8, 3, 2, "d");
    c.spikeSide(7, 13, 4, 2, "d", -1);
    c.spikeSide(25, 13, 4, 2, "d", 1);
    c.spikeDown(10, 19, 3, 2, "d");
    c.spikeDown(22, 19, 3, 2, "d");
    c.disc(16, 13, 5, "a"); // face
    c.ellipse(16, 23, 6, 5, "a"); // body
    c.ellipse(16, 24, 4, 3.5, "c");
    c.spikeSide(21, 25, 5, 1, "a", 1); // tail
    c.ellipse(27, 25, 1.6, 1.6, "d"); // tail tuft
    c.rect(11, 28, 3, 2, "a"); // paws
    c.rect(18, 28, 3, 2, "a");
    c.set(13, 17, "W"); // fangs
    c.set(19, 17, "W");
  },
  { a: "#f0a63c", c: "#ffd9a0", d: "#a8642a", o: "#5f3410" },
  { eyeY: 11, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 15 },
  [[10, 23], [21, 23]],
);

// ── 13. perfect bad: 暴走系 — Bersa (hulking, jagged, glowing cracks) ───────
export const berserk: SpeciesArt = build(
  (c) => {
    c.spikeUp(9, 12, 5, 2, "b"); // back spikes
    c.spikeUp(23, 11, 6, 2, "b");
    c.spikeUp(16, 7, 4, 2, "b");
    c.spikeUp(12, 9, 3, 1, "b"); // horns
    c.spikeUp(20, 9, 3, 1, "b");
    c.ellipse(16, 19, 9, 8, "a"); // bulky body
    c.ellipse(6, 18, 3, 4, "a"); // arms (asymmetric)
    c.ellipse(26, 20, 3, 4, "a");
    c.ellipse(16, 21, 5, 4, "b"); // dark chest
    c.stamp(15, 17, ["..d.", ".d..", "..d.", ".d.."]); // glow crack
    c.rect(12, 27, 3, 2, "b"); // feet
    c.rect(18, 27, 3, 2, "b");
  },
  { a: "#8a3a55", b: "#5a2740", c: "#b8556f", d: "#e8e04a", o: "#2e1526" },
  { eyeY: 13, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 18 },
  [[9, 20], [22, 15], [16, 22]],
);

// ── 14. ultimate good: 聖竜系 — Horyu (holy dragon, wings, horns) ───────────
export const holyDragon: SpeciesArt = build(
  (c) => {
    c.ellipse(6, 14, 4, 7, "c"); // wings
    c.ellipse(26, 14, 4, 7, "c");
    c.ellipse(6, 14, 1, 6, "d");
    c.ellipse(26, 14, 1, 6, "d");
    c.ellipse(16, 20, 7, 8, "a"); // body
    c.ellipse(16, 22, 5, 5, "c"); // belly
    c.rect(14, 12, 4, 5, "a"); // neck
    c.disc(16, 10, 5, "a"); // head
    c.spikeUp(12, 5, 4, 1, "d"); // horns
    c.spikeUp(20, 5, 4, 1, "d");
    c.spikeSide(23, 25, 5, 1, "a", 1); // tail
    c.ellipse(29, 25, 1.4, 1.4, "d");
    c.ellipse(16, 21, 2, 2, "d"); // chest gem
    c.ellipse(13, 28, 2.3, 2, "a"); // feet
    c.ellipse(19, 28, 2.3, 2, "a");
  },
  { a: "#6fd0e8", c: "#e6fbff", d: "#ffd94a", o: "#2b6f80" },
  { eyeY: 8, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 12 },
  [[10, 21], [22, 21]],
);

// ── 15. ultimate neutral: 機神系 — Mekagami (angular robot god) ─────────────
export const mechGod: SpeciesArt = build(
  (c) => {
    c.rect(15, 3, 2, 3, "b"); // antenna
    c.ellipse(16, 3, 1.5, 1.5, "d"); // antenna light
    c.roundRect(11, 7, 10, 8, "a"); // head
    c.rect(10, 10, 12, 3, "d"); // visor band
    c.roundRect(9, 16, 14, 12, "a"); // torso
    c.rect(9, 20, 14, 1, "b"); // panel line
    c.ellipse(16, 24, 2.6, 2.6, "d"); // core light
    c.rect(6, 17, 3, 7, "a"); // arms
    c.rect(23, 17, 3, 7, "a");
    c.rect(11, 28, 3, 3, "b"); // legs
    c.rect(18, 28, 3, 3, "b");
  },
  { a: "#9aa7b5", b: "#67727f", c: "#c9d3dd", d: "#3fd0e0", o: "#333c45" },
  { eyeY: 9, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 13 },
  [[10, 22], [21, 15]],
);

// ── 16. ultimate bad: 魔王系 — Maouga (horned demon lord, wings) ────────────
export const demonLord: SpeciesArt = build(
  (c) => {
    c.ellipse(6, 13, 4, 6, "b"); // bat wings
    c.ellipse(26, 13, 4, 6, "b");
    c.spikeDown(6, 19, 4, 3, "b"); // wing points
    c.spikeDown(26, 19, 4, 3, "b");
    c.spikeUp(9, 8, 7, 2, "b"); // big horns
    c.spikeUp(23, 8, 7, 2, "b");
    c.spikeUp(13, 6, 4, 1, "b"); // crown spikes
    c.spikeUp(19, 6, 4, 1, "b");
    c.spikeUp(16, 5, 5, 1, "b");
    c.ellipse(16, 19, 8, 8, "a"); // body
    c.ellipse(16, 21, 5.5, 5, "c"); // belly
    c.ellipse(16, 21, 2.2, 2, "d"); // ember gem
    c.stamp(20, 15, [".d.", "d..", ".d."]); // ember spark
    c.ellipse(13, 28, 2.3, 2, "a"); // feet
    c.ellipse(19, 28, 2.3, 2, "a");
  },
  { a: "#4a2f66", b: "#2f1d45", c: "#6b4a8f", d: "#ff6a3c", o: "#170e24" },
  { eyeY: 13, eyeLx: 11, eyeRx: 18, mouthX: 14, mouthY: 18 },
  [[10, 21], [22, 15], [16, 24]],
);
