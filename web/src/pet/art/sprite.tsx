// LINGO-028 — the species-aware sprite component. Given a speciesId + one of
// the four expressions, it composites the base grid with the face and renders
// it. This is the single entry point the育成 UI / gallery use for monsters.

import { useMemo } from "react";
import type { CSSProperties } from "react";
import { PixelSprite } from "./PixelSprite";
import { composite, FACE_COLORS } from "./faces";
import { ART } from "./catalog";
import type { Expression } from "./types";

interface Props {
  speciesId: string;
  expr?: Expression;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function PetSprite({ speciesId, expr = "normal", size = 96, className, style }: Props) {
  const art = ART[speciesId];
  const grid = useMemo(() => (art ? composite(art, expr) : []), [art, expr]);
  const palette = useMemo(() => (art ? { ...FACE_COLORS, ...art.palette } : {}), [art]);
  if (!art) return null;
  return (
    <PixelSprite
      grid={grid}
      palette={palette}
      size={size}
      className={className}
      style={style}
      title={`${speciesId}-${expr}`}
    />
  );
}
