// LINGO-028 — the pure-data catalog (no React, so tests/engine can import it
// freely). `ART` maps speciesId → the authored sprite; `SPECIES_META` is the
// ordered 16-entry table the engine references by speciesId. index.ts wraps
// each row with a ready-to-render `Component`.

import {
  mochi,
  cutie,
  grimy,
  hero,
  sage,
  rascal,
  mellow,
  mud,
  spiky,
  angel,
  knight,
  beastKing,
  berserk,
  holyDragon,
  mechGod,
  demonLord,
} from "./species";
import type { Lineage, LocalizedName, SpeciesArt, Stage } from "./types";

export interface SpeciesMeta {
  speciesId: string;
  stage: Stage;
  lineage: Lineage;
  name: LocalizedName;
}

/** speciesId → sprite art. Keys are the design §3 lineage names in kebab-case. */
export const ART: Record<string, SpeciesArt> = {
  mochi,
  cutie,
  grimy,
  hero,
  sage,
  rascal,
  mellow,
  mud,
  spiky,
  angel,
  knight,
  "beast-king": beastKing,
  berserk,
  "holy-dragon": holyDragon,
  "mech-god": mechGod,
  "demon-lord": demonLord,
};

/** Ordered catalog. Stage counts are fixed by design §3: 1 / 2 / 7 / 3 / 3. */
export const SPECIES_META: SpeciesMeta[] = [
  // baby (1)
  { speciesId: "mochi", stage: "baby", lineage: "neutral", name: { ja: "モチモ", en: "Mochimo", ru: "Мотимо" } },
  // growth (2)
  { speciesId: "cutie", stage: "growth", lineage: "good", name: { ja: "プニリン", en: "Punilin", ru: "Пунилин" } },
  { speciesId: "grimy", stage: "growth", lineage: "bad", name: { ja: "ヨゴレン", en: "Yogolen", ru: "Йоголен" } },
  // mature (7)
  { speciesId: "hero", stage: "mature", lineage: "good", name: { ja: "ブレイロ", en: "Braylo", ru: "Брэйло" } },
  { speciesId: "sage", stage: "mature", lineage: "good", name: { ja: "ソフィオ", en: "Sophio", ru: "Софио" } },
  { speciesId: "rascal", stage: "mature", lineage: "neutral", name: { ja: "ワンパ", en: "Wampa", ru: "Вампа" } },
  { speciesId: "mellow", stage: "mature", lineage: "neutral", name: { ja: "トロン", en: "Toron", ru: "Торон" } },
  { speciesId: "mud", stage: "mature", lineage: "bad", name: { ja: "ドロン", en: "Doron", ru: "Дорон" } },
  { speciesId: "spiky", stage: "mature", lineage: "bad", name: { ja: "トゲロ", en: "Togero", ru: "Тогеро" } },
  { speciesId: "angel", stage: "mature", lineage: "rare", name: { ja: "ルミナ", en: "Lumina", ru: "Люмина" } },
  // perfect (3)
  { speciesId: "knight", stage: "perfect", lineage: "good", name: { ja: "ガーダ", en: "Garda", ru: "Гарда" } },
  { speciesId: "beast-king", stage: "perfect", lineage: "neutral", name: { ja: "ガオル", en: "Gaoru", ru: "Гаору" } },
  { speciesId: "berserk", stage: "perfect", lineage: "bad", name: { ja: "バーサ", en: "Bersa", ru: "Берса" } },
  // ultimate (3)
  { speciesId: "holy-dragon", stage: "ultimate", lineage: "good", name: { ja: "ホーリュ", en: "Horyu", ru: "Хорю" } },
  { speciesId: "mech-god", stage: "ultimate", lineage: "neutral", name: { ja: "メカガミ", en: "Mekagami", ru: "Мекагами" } },
  { speciesId: "demon-lord", stage: "ultimate", lineage: "bad", name: { ja: "マオウガ", en: "Maouga", ru: "Маоуга" } },
];
