// User settings + gate suppression windows, persisted in the IndexedDB `meta`
// store. Mirrors the iOS GateState surface (unlockMinutes, quizMode, per-app
// suppression) minus the shield-only bits, which have no web equivalent.

import { getMeta, setMeta } from "../db/idb";
import { DEFAULT_COURSE_ID, resolveCourse } from "../content/courses";
import type { Lang } from "../content/courses";

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
  // LINGO-014: the 3 language axes (design §1). All global (not course-scoped)
  // except frontLang, which is remembered per course.
  appLang: "i18n.appLang", // UI language
  activeCourse: "course.active", // = card-back language (the course)
  frontLangPrefix: "course.frontLang.", // + courseId; the card-front (prompt/hint) language
};

// MARK: i18n (app UI language) — LINGO-014

const LANGS: Lang[] = ["ja", "en", "ru"];

export async function getAppLang(): Promise<Lang> {
  const v = await getMeta<Lang>(K.appLang, "ja");
  return LANGS.includes(v) ? v : "ja";
}

export function setAppLang(lang: Lang): Promise<void> {
  return setMeta(K.appLang, lang);
}

// MARK: course + front language — LINGO-014

export async function getActiveCourse(): Promise<string> {
  const v = await getMeta<string>(K.activeCourse, DEFAULT_COURSE_ID);
  // Guard against a persisted id whose course was removed / is not selectable.
  const c = resolveCourse(v);
  return c.status === "available" ? c.courseId : DEFAULT_COURSE_ID;
}

export function setActiveCourse(courseId: string): Promise<void> {
  return setMeta(K.activeCourse, courseId);
}

/** The front (prompt/hint) language for a course. Defaults to the course's own
 * defaultFrontLang; falls back to it if a persisted value is no longer valid
 * for the course (e.g. availableFrontLangs changed). */
export async function getFrontLang(courseId: string): Promise<Lang> {
  const course = resolveCourse(courseId);
  const v = await getMeta<Lang>(K.frontLangPrefix + courseId, course.defaultFrontLang);
  return course.availableFrontLangs.includes(v) ? v : course.defaultFrontLang;
}

export function setFrontLang(courseId: string, lang: Lang): Promise<void> {
  return setMeta(K.frontLangPrefix + courseId, lang);
}

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
