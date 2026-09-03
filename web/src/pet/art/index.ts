// LINGO-028 — public art surface. `PET_SPECIES` is the contract the pet engine
// (LINGO-029) consumes: it looks up a row by speciesId, reads stage/lineage/
// name, and renders `Component` with an expression + size.

import { createElement } from "react";
import type { FC } from "react";
import { PetSprite } from "./sprite";
import { SPECIES_META } from "./catalog";
import type { Expression, Lineage, LocalizedName, Stage } from "./types";

export interface PetSpeciesEntry {
  speciesId: string;
  stage: Stage;
  lineage: Lineage;
  name: LocalizedName;
  Component: FC<{ expr?: Expression; size?: number; className?: string }>;
}

export const PET_SPECIES: PetSpeciesEntry[] = SPECIES_META.map((m) => ({
  ...m,
  Component: (props) => createElement(PetSprite, { speciesId: m.speciesId, ...props }),
}));

/** speciesId → entry, for O(1) engine lookups. */
export const PET_SPECIES_BY_ID: Record<string, PetSpeciesEntry> = Object.fromEntries(
  PET_SPECIES.map((s) => [s.speciesId, s]),
);

export { PetSprite } from "./sprite";
export { ART, SPECIES_META } from "./catalog";
export {
  EggSprite,
  EggCrackedSprite,
  PoopSprite,
  FoodSprite,
  StarSprite,
} from "./props";
export { EXPRESSIONS } from "./types";
export type { Expression, Lineage, Stage, LocalizedName, PetLang, SpeciesArt, FaceAnchor } from "./types";
