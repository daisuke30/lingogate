// LINGO-030 — pure presentation logic for the 育成 (pet) tab. Kept free of
// React / IndexedDB so the face-selection, button-enable and tab-visibility
// rules are deterministically unit-testable (petDisplay.test.ts). The 育成 UI
// (PetView.tsx) and the tab bar (TabBar.tsx) consume these; the growth model
// itself lives in the pure engine (engine.ts).

import type { Expression } from "./art/types";
import type { PetSnapshot } from "./engine";

/** Below this 満腹度 the pet looks 空腹 (hungry face). */
export const HUNGRY_AT = 30;
/** At/above this 満腹度 (and clean) the pet looks 喜び (joy face). */
export const JOY_AT = 70;

/** Face selection, in the design's strict priority order:
 *  空腹 (hungry) > 汚れ (dirty) > 喜び (joy) > 通常 (normal).
 * Driven entirely by the engine snapshot so the face never lies about the
 * pet's real state (design §1: state = a mapping of the learning data). */
export function chooseExpression(s: Pick<PetSnapshot, "satiety" | "poop">): Expression {
  if (s.satiety < HUNGRY_AT) return "hungry";
  if (s.poop > 0) return "dirty";
  if (s.satiety >= JOY_AT) return "joy";
  return "normal";
}

/** 餌をあげる is disabled with no food, or when the belly is already full
 * (満腹時は無効 — a feed would be wasted). */
export function feedDisabled(s: Pick<PetSnapshot, "foodCount" | "satiety">): boolean {
  return s.foodCount <= 0 || s.satiety >= 100;
}

/** 掃除する is disabled with no clean points, or nothing to clean (うんこ0). */
export function cleanDisabled(s: Pick<PetSnapshot, "cleanPoints" | "poop">): boolean {
  return s.cleanPoints <= 0 || s.poop <= 0;
}

/** The bottom tab bar is only shown on the two top-level tabs (学習 / 育成).
 * Every immersive or single-purpose flow — the gate toll (/gate), the quiz,
 * the placement test, onboarding, and the leaf settings/guide screens — hides
 * it to preserve the current, focused動線 (design §5). */
export function showTabBar(routeName: string): boolean {
  return routeName === "home" || routeName === "pet";
}

/** Which tab is active for a given route (only meaningful when showTabBar). */
export function activeTab(routeName: string): "learn" | "raise" | null {
  if (routeName === "home") return "learn";
  if (routeName === "pet") return "raise";
  return null;
}

// MARK: LINGO-031 — study-session earnings wiring & Home's mini status

/** A finished/partial session only "counts" toward pet care (studied flag +
 * streak, not just food/掃除P) when it actually graded something — guards a
 * zero-card open-and-immediately-exit from silently bumping the study streak
 * (see state/service.ts commitSession/commitPartialSession). */
export function sessionEarnedPetRewards(counts: { newCount: number; reviewCount: number }): boolean {
  return counts.newCount + counts.reviewCount > 0;
}

export interface PetAttention {
  /** 満腹度 has dropped into the 空腹 range — the same threshold chooseExpression uses. */
  hungry: boolean;
  /** Any うんこ present. */
  dirty: boolean;
}

/** Home's mini status (design "学習完了サマリ…育成タブへの導線" + neglect
 * awareness): which attention marks to show next to the pet's face icon.
 * Mirrors chooseExpression's own thresholds so the mini row never disagrees
 * with the 育成 screen's face. */
export function petAttention(s: Pick<PetSnapshot, "satiety" | "poop">): PetAttention {
  return { hungry: s.satiety < HUNGRY_AT, dirty: s.poop > 0 };
}
