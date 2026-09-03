// LINGO-028 — dev-only preview of the whole art set (all 16 species × 4 faces
// + care props). Reached at /pet-gallery; not linked from production nav. Used
// to eyeball silhouettes/expressions during authoring and regression.

import { PET_SPECIES } from "./index";
import { EXPRESSIONS } from "./types";
import type { Expression } from "./types";
import {
  EggSprite,
  EggCrackedSprite,
  PoopSprite,
  FoodSprite,
  StarSprite,
} from "./props";

const EXPR_LABEL: Record<Expression, string> = {
  normal: "通常",
  joy: "喜び",
  hungry: "空腹",
  dirty: "汚れ",
};

const STAGE_LABEL: Record<string, string> = {
  baby: "幼年",
  growth: "成長",
  mature: "成熟",
  perfect: "完全体",
  ultimate: "究極体",
};

const LINEAGE_COLOR: Record<string, string> = {
  good: "#3b82f6",
  neutral: "#10b981",
  bad: "#a855f7",
  rare: "#f59e0b",
};

export function PetGallery({ onBack }: { onBack?: () => void }) {
  return (
    <div style={{ padding: 16, maxWidth: 960, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        {onBack ? (
          <button onClick={onBack} style={{ padding: "6px 12px", cursor: "pointer" }}>
            ‹ 戻る
          </button>
        ) : null}
        <h1 style={{ fontSize: 20, margin: 0 }}>ペット図鑑プレビュー（{PET_SPECIES.length}種）</h1>
      </div>
      <p style={{ opacity: 0.7, fontSize: 13, marginTop: 0 }}>
        開発用。各種 通常 / 喜び / 空腹 / 汚れ の4表情。本番ナビには出しません。
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {PET_SPECIES.map((s) => (
          <div
            key={s.speciesId}
            style={{
              border: "1px solid rgba(128,128,128,0.3)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(128,128,128,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 15 }}>{s.name.ja}</strong>
              <span style={{ fontSize: 12, opacity: 0.6 }}>{s.name.en}</span>
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 999,
                  color: "#fff",
                  background: LINEAGE_COLOR[s.lineage],
                }}
              >
                {STAGE_LABEL[s.stage]} · {s.lineage}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
              {EXPRESSIONS.map((expr) => (
                <div key={expr} style={{ textAlign: "center" }}>
                  <s.Component expr={expr} size={60} />
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{EXPR_LABEL[expr]}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>{s.speciesId}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>共通素材</h2>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Prop label="タマゴ">
          <EggSprite size={72} />
        </Prop>
        <Prop label="タマゴ（ヒビ）">
          <EggCrackedSprite size={72} />
        </Prop>
        <Prop label="うんこ">
          <PoopSprite size={56} />
        </Prop>
        <Prop label="餌（肉まん）">
          <FoodSprite size={56} />
        </Prop>
        <Prop label="星">
          <StarSprite size={44} />
        </Prop>
      </div>
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center" }}>
      {children}
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
    </div>
  );
}
