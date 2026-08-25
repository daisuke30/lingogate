// User settings + gate suppression windows, persisted in the IndexedDB `meta`
// store. Mirrors the iOS GateState surface (unlockMinutes, quizMode, per-app
// suppression) minus the shield-only bits, which have no web equivalent.

import { getMeta, setMeta } from "../db/idb";

export const UNLOCK_CHOICES = [5, 10, 15, 30] as const;
export type QuizMode = "flashcard" | "strict";

/** Speech rates offered in Settings; 1.0 = normal, 0.8 = slower for new words. */
export const TTS_RATE_CHOICES = [0.8, 1.0] as const;

const K = {
  unlockMinutes: "gate.unlockMinutes",
  quizMode: "gate.quizMode",
  suppressPrefix: "gate.suppressUntil.",
  ttsEnabled: "tts.enabled",
  ttsRate: "tts.rate",
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

// MARK: TTS (Web Speech read-aloud)

export function getTtsEnabled(): Promise<boolean> {
  return getMeta<boolean>(K.ttsEnabled, true);
}

export function setTtsEnabled(on: boolean): Promise<void> {
  return setMeta(K.ttsEnabled, on);
}

export async function getTtsRate(): Promise<number> {
  const v = await getMeta<number>(K.ttsRate, 1.0);
  return (TTS_RATE_CHOICES as readonly number[]).includes(v) ? v : 1.0;
}

export function setTtsRate(rate: number): Promise<void> {
  return setMeta(K.ttsRate, rate);
}

export interface TtsSettings {
  enabled: boolean;
  rate: number;
}

export async function getTtsSettings(): Promise<TtsSettings> {
  const [enabled, rate] = await Promise.all([getTtsEnabled(), getTtsRate()]);
  return { enabled, rate };
}
