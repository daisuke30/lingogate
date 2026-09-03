// LINGO-028 — shared art types (kept dependency-free so the engine/tests can
// import them without pulling in React).

/** Evolution stage. Counts are fixed by the design doc §3: 1/2/7/3/3. */
export type Stage = "baby" | "growth" | "mature" | "perfect" | "ultimate";

/** Care-path lineage (design §3): 良→good, 並→neutral, 怠→bad, ボーナス→rare. */
export type Lineage = "good" | "neutral" | "bad" | "rare";

/** The four faces every species must provide (design §4). */
export type Expression = "normal" | "joy" | "hungry" | "dirty";

export const EXPRESSIONS: Expression[] = ["normal", "joy", "hungry", "dirty"];

/** The three UI languages (mirrors content/courses `Lang`, kept local so
 * pet/art stays self-contained and low-conflict). */
export type PetLang = "ja" | "en" | "ru";
export type LocalizedName = Record<PetLang, string>;

/** Where the eyes/mouth sit on a given silhouette (top-left anchors). */
export interface FaceAnchor {
  eyeY: number;
  eyeLx: number;
  eyeRx: number;
  mouthX: number;
  mouthY: number;
}

/** A fully-authored species sprite: a precomputed base grid + its colours +
 * where the face goes + optional dirt-spot anchors for the "dirty" face. */
export interface SpeciesArt {
  base: string[];
  palette: Record<string, string>;
  face: FaceAnchor;
  dirt?: Array<[number, number]>;
}
