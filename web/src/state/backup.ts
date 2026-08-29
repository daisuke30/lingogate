// Backup export/import wiring (LINGO-021): connects the pure engine
// (engine/backup.ts) to IndexedDB (db/idb.ts) and settings (state/settings.ts).
// The UI layer (SettingsView) only ever calls exportBackup()/downloadBackupFile()
// and importBackupText() — all IndexedDB reads/writes and the merge decision
// live here.

import { COURSES } from "../content/courses";
import type { Lang } from "../content/courses";
import {
  addGateSession,
  getAllGateSessions,
  getAllReviewStates,
  getAllWordKnowledge,
  putReviewStates,
  putWordKnowledge,
  resetAll,
} from "../db/idb";
import type { GateSessionRow } from "../db/idb";
import { buildBackupFile, mergeBackups, newGateSessions, validateBackupFile } from "../engine/backup";
import type {
  BackupCourseData,
  BackupFile,
  BackupGateSession,
  BackupSettings,
  CurrentBackupData,
} from "../engine/backup";
import type { QuizMode } from "./settings";
import {
  getActiveCourse,
  getAppLang,
  getFrontLang,
  getOnboardingSeen,
  getPlacementDone,
  getQuizMode,
  getTtsEnabled,
  getTtsRate,
  getUnlockMinutes,
  setActiveCourse,
  setAppLang,
  setFrontLang,
  setOnboardingSeen,
  setPlacementDone,
  setQuizMode,
  setTtsEnabled,
  setTtsRate,
  setUnlockMinutes,
} from "./settings";
import versionInfo from "../content/version.generated.json";

function toBackupSession(row: GateSessionRow, fallbackCourseId: string): BackupGateSession {
  return {
    courseId: row.courseId ?? fallbackCourseId,
    appKey: row.appKey,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    questions: row.questions,
    correct: row.correct,
    durationMs: row.durationMs,
    unlocked: row.unlocked,
  };
}

async function collectCourseData(courseId: string): Promise<BackupCourseData> {
  const [wordKnowledge, reviewStates, gateSessions] = await Promise.all([
    getAllWordKnowledge(courseId),
    getAllReviewStates(courseId),
    getAllGateSessions(courseId),
  ]);
  return {
    wordKnowledge,
    reviewStates,
    gateSessions: gateSessions.map((g) => toBackupSession(g, courseId)),
  };
}

async function collectAllCourses(): Promise<Record<string, BackupCourseData>> {
  const entries = await Promise.all(
    COURSES.map(async (c) => [c.courseId, await collectCourseData(c.courseId)] as const),
  );
  return Object.fromEntries(entries);
}

async function collectSettings(): Promise<BackupSettings> {
  const [appLang, activeCourse, unlockMinutes, quizMode, ttsEnabled, ttsRate, onboardingSeen] =
    await Promise.all([
      getAppLang(),
      getActiveCourse(),
      getUnlockMinutes(),
      getQuizMode(),
      getTtsEnabled(),
      getTtsRate(),
      getOnboardingSeen(),
    ]);
  const frontLangEntries = await Promise.all(
    COURSES.map(async (c) => [c.courseId, await getFrontLang(c.courseId)] as const),
  );
  const placementDoneEntries = await Promise.all(
    COURSES.map(async (c) => [c.courseId, await getPlacementDone(c.courseId)] as const),
  );
  return {
    appLang,
    activeCourse,
    frontLangByCourse: Object.fromEntries(frontLangEntries),
    unlockMinutes,
    quizMode,
    ttsEnabled,
    ttsRate,
    onboardingSeen,
    placementDoneByCourse: Object.fromEntries(placementDoneEntries),
  };
}

/** Gather every course's learning state + all settings into one backup file. */
export async function exportBackup(): Promise<BackupFile> {
  const [courses, settings] = await Promise.all([collectAllCourses(), collectSettings()]);
  return buildBackupFile(courses, settings, Date.now(), versionInfo.version);
}

/**
 * Trigger a browser download of the backup JSON via Blob + a hidden <a
 * download>. This is the one pattern that reliably works inside an iOS
 * Safari PWA's standalone webview (which has no "Save As" affordance of its
 * own) — tapping it surfaces the OS share sheet / "Save to Files" prompt,
 * same as a normal Safari tab.
 */
export function downloadBackupFile(file: BackupFile): void {
  const json = JSON.stringify(file, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date(file.exportedAt).toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lingogate-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function applySettings(settings: BackupSettings): Promise<void> {
  await Promise.all([
    setAppLang(settings.appLang as Lang),
    setActiveCourse(settings.activeCourse),
    setUnlockMinutes(settings.unlockMinutes),
    setQuizMode(settings.quizMode as QuizMode),
    setTtsEnabled(settings.ttsEnabled),
    setTtsRate(settings.ttsRate),
    setOnboardingSeen(settings.onboardingSeen),
    ...Object.entries(settings.frontLangByCourse).map(([courseId, lang]) =>
      setFrontLang(courseId, lang as Lang),
    ),
    ...Object.entries(settings.placementDoneByCourse).map(([courseId, done]) =>
      setPlacementDone(courseId, done),
    ),
  ]);
}

export interface ImportOutcome {
  ok: boolean;
  error?: "invalid-json" | "missing-schema-version" | "unsupported-schema-version";
}

/**
 * Parse, validate, and apply an imported backup.
 *  - replaceAll=true: wipe existing storage (db/idb.ts resetAll()) then write
 *    the backup's data + settings verbatim — an unambiguous full restore.
 *  - replaceAll=false (default): per-course merge (engine/backup.ts's
 *    newer-wins rules for wordKnowledge/reviewStates, dedupe-union for
 *    gateSessions) written back; settings are left untouched (see
 *    mergeBackups' MergeResult doc comment for why).
 * Never throws — parse/validation failures come back as a typed ImportOutcome
 * the UI maps to an i18n message.
 */
export async function importBackupText(text: string, replaceAll: boolean): Promise<ImportOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid-json" };
  }

  const validated = validateBackupFile(parsed);
  if (!validated.ok || !validated.file) {
    return { ok: false, error: validated.error ?? "invalid-json" };
  }
  const incoming = validated.file;

  if (replaceAll) {
    await resetAll();
    for (const [courseId, data] of Object.entries(incoming.courses)) {
      if (data.wordKnowledge.length) await putWordKnowledge(data.wordKnowledge, courseId);
      if (data.reviewStates.length) await putReviewStates(data.reviewStates, courseId);
      for (const g of data.gateSessions) await addGateSession(g, courseId);
    }
    await applySettings(incoming.settings);
    return { ok: true };
  }

  // Merge mode: engine/backup.ts's mergeBackups() is the single source of
  // truth for the merge semantics (newer-updatedAt/lastReview wins for
  // wordKnowledge/reviewStates). Its recomputed sets are safe to write back
  // wholesale via put() — both stores have a natural key. gateSessions is
  // different: the store has no natural upsert key (autoIncrement id only),
  // so mergeBackups' fully-unioned array (existing rows included) can't be
  // blindly re-added without duplicating what's already there — only the
  // genuinely-new rows (per newGateSessions) are ever written. Settings are
  // intentionally left untouched (see mergeBackups' MergeResult doc comment).
  const current: CurrentBackupData = {
    courses: await collectAllCourses(),
    settings: await collectSettings(),
  };
  const merged = mergeBackups(current, incoming, false);
  for (const [courseId, data] of Object.entries(merged.courses)) {
    if (data.wordKnowledge.length) await putWordKnowledge(data.wordKnowledge, courseId);
    if (data.reviewStates.length) await putReviewStates(data.reviewStates, courseId);
  }
  for (const courseId of Object.keys(incoming.courses)) {
    const currentCourse = current.courses[courseId] ?? emptyCourseData();
    const incomingCourse = incoming.courses[courseId] ?? emptyCourseData();
    for (const g of newGateSessions(currentCourse.gateSessions, incomingCourse.gateSessions)) {
      await addGateSession(g, courseId);
    }
  }
  return { ok: true };
}

function emptyCourseData(): BackupCourseData {
  return { wordKnowledge: [], reviewStates: [], gateSessions: [] };
}
