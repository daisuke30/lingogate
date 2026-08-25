// User settings + gate suppression windows, persisted in the IndexedDB `meta`
// store. Mirrors the iOS GateState surface (unlockMinutes, quizMode, per-app
// suppression) minus the shield-only bits, which have no web equivalent.

import { getMeta, setMeta } from "../db/idb";

export const UNLOCK_CHOICES = [5, 10, 15, 30] as const;
export type QuizMode = "flashcard" | "strict";

const K = {
  unlockMinutes: "gate.unlockMinutes",
  quizMode: "gate.quizMode",
  suppressPrefix: "gate.suppressUntil.",
};

export async function getUnlockMinutes(): Promise<number> {
  const v = await getMeta<number>(K.unlockMinutes, 10);
  return (UNLOCK_CHOICES as readonly number[]).includes(v) ? v : 10;
}

export function setUnlockMinutes(m: number): Promise<void> {
  return setMeta(K.unlockMinutes, m);
}

export async function getQuizMode(): Promise<QuizMode> {
  return getMeta<QuizMode>(K.quizMode, "flashcard");
}

export function setQuizMode(m: QuizMode): Promise<void> {
  return setMeta(K.quizMode, m);
}

export function getSuppressUntil(appKey: string): Promise<number | null> {
  return getMeta<number | null>(K.suppressPrefix + appKey, null);
}

export function setSuppressUntil(appKey: string, until: number): Promise<void> {
  return setMeta(K.suppressPrefix + appKey, until);
}
