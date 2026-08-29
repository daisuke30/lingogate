// Pure backup export/merge logic (LINGO-021): a JSON export/import format for
// all learning state, guarding against Safari's evictable-storage eviction or
// a "clear website data" tap wiping IndexedDB with no way back. Deliberately
// decoupled from db/idb.ts (the IO layer) — this file only knows about plain
// data shapes, never IndexedDB itself, so every serialize/validate/merge
// decision is unit-testable without a browser. state/backup.ts wires it to
// storage; ui/SettingsView.tsx wires that to the export/import buttons.

import type { ReviewState } from "./fsrs";
import type { WordKnowledge } from "./calibration";

/** Bump when the shape below changes in a way older app versions can't read.
 * validateBackupFile() rejects any schemaVersion greater than this (a backup
 * from a NEWER app than the one importing it) but accepts anything <= this
 * (older backups degrade gracefully via the same missing-field defaults used
 * for partial data — see validateBackupFile). */
export const BACKUP_SCHEMA_VERSION = 1;

/** gateSessions row shape as it appears in a backup file. Structurally
 * compatible with db/idb.ts's GateSessionRow (minus the DB's own
 * autoIncrement `id`, which is never portable across devices/exports) — kept
 * as an independent type rather than importing GateSessionRow so this module
 * has zero dependency on the IndexedDB layer. */
export interface BackupGateSession {
  courseId: string;
  appKey: string | null;
  startedAt: number;
  endedAt: number | null;
  questions: number;
  correct: number;
  durationMs: number | null;
  unlocked: boolean;
}

export interface BackupCourseData {
  wordKnowledge: WordKnowledge[];
  reviewStates: ReviewState[];
  gateSessions: BackupGateSession[];
}

/** Flat snapshot of every setting worth restoring. Deliberately typed with
 * plain `string` for language/mode fields (not the app's Lang/QuizMode union
 * types) so this module never needs to import UI-layer types either —
 * state/backup.ts casts back to the narrow types when applying settings. */
export interface BackupSettings {
  appLang: string;
  activeCourse: string;
  frontLangByCourse: Record<string, string>;
  unlockMinutes: number;
  quizMode: string;
  ttsEnabled: boolean;
  ttsRate: number;
  onboardingSeen: boolean;
  placementDoneByCourse: Record<string, boolean>;
}

export interface BackupFile {
  schemaVersion: number;
  exportedAt: number;
  appVersion: string;
  courses: Record<string, BackupCourseData>;
  settings: BackupSettings;
}

/** Build a backup file from already-collected data. `now`/`appVersion` are
 * parameters (not read from Date.now()/build info internally) so this stays
 * deterministic and testable — state/backup.ts supplies the real values. */
export function buildBackupFile(
  courses: Record<string, BackupCourseData>,
  settings: BackupSettings,
  now: number,
  appVersion: string,
): BackupFile {
  return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: now, appVersion, courses, settings };
}

export interface ValidationResult {
  ok: boolean;
  file?: BackupFile;
  /** Machine-readable reason, i18n-mapped by the UI layer — not a message. */
  error?: "invalid-json" | "missing-schema-version" | "unsupported-schema-version";
}

const DEFAULT_SETTINGS: BackupSettings = {
  appLang: "ja",
  activeCourse: "ru",
  frontLangByCourse: {},
  unlockMinutes: 10,
  quizMode: "flashcard",
  ttsEnabled: true,
  ttsRate: 1.0,
  onboardingSeen: false,
  placementDoneByCourse: {},
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate + normalise a parsed-JSON value into a BackupFile. Two distinct
 * failure modes:
 *  - schemaVersion missing/non-numeric, or greater than BACKUP_SCHEMA_VERSION
 *    (a backup from a future app version whose fields we can't safely
 *    interpret) -> rejected.
 *  - Anything else missing or malformed (a whole course, a single array, an
 *    individual settings field) is treated as PARTIAL DATA, not corruption:
 *    every gap is filled with an empty array / a sane default rather than
 *    failing the import, since a backup taken by an older app build, or hand-
 *    edited, should still restore whatever it does contain.
 */
export function validateBackupFile(data: unknown): ValidationResult {
  if (!isPlainObject(data)) return { ok: false, error: "invalid-json" };

  const schemaVersion = data.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { ok: false, error: "missing-schema-version" };
  }
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: "unsupported-schema-version" };
  }

  const courses: Record<string, BackupCourseData> = {};
  if (isPlainObject(data.courses)) {
    for (const [courseId, raw] of Object.entries(data.courses)) {
      const c = isPlainObject(raw) ? raw : {};
      courses[courseId] = {
        wordKnowledge: Array.isArray(c.wordKnowledge) ? (c.wordKnowledge as WordKnowledge[]) : [],
        reviewStates: Array.isArray(c.reviewStates) ? (c.reviewStates as ReviewState[]) : [],
        gateSessions: Array.isArray(c.gateSessions) ? (c.gateSessions as BackupGateSession[]) : [],
      };
    }
  }

  const s = isPlainObject(data.settings) ? data.settings : {};
  const settings: BackupSettings = {
    appLang: typeof s.appLang === "string" ? s.appLang : DEFAULT_SETTINGS.appLang,
    activeCourse: typeof s.activeCourse === "string" ? s.activeCourse : DEFAULT_SETTINGS.activeCourse,
    frontLangByCourse: isPlainObject(s.frontLangByCourse)
      ? (s.frontLangByCourse as Record<string, string>)
      : {},
    unlockMinutes: typeof s.unlockMinutes === "number" ? s.unlockMinutes : DEFAULT_SETTINGS.unlockMinutes,
    quizMode: typeof s.quizMode === "string" ? s.quizMode : DEFAULT_SETTINGS.quizMode,
    ttsEnabled: typeof s.ttsEnabled === "boolean" ? s.ttsEnabled : DEFAULT_SETTINGS.ttsEnabled,
    ttsRate: typeof s.ttsRate === "number" ? s.ttsRate : DEFAULT_SETTINGS.ttsRate,
    onboardingSeen: typeof s.onboardingSeen === "boolean" ? s.onboardingSeen : DEFAULT_SETTINGS.onboardingSeen,
    placementDoneByCourse: isPlainObject(s.placementDoneByCourse)
      ? (s.placementDoneByCourse as Record<string, boolean>)
      : {},
  };

  const exportedAt = typeof data.exportedAt === "number" ? data.exportedAt : Date.now();
  const appVersion = typeof data.appVersion === "string" ? data.appVersion : "";

  return { ok: true, file: { schemaVersion, exportedAt, appVersion, courses, settings } };
}

/** Merge wordKnowledge rows: newer `updatedAt` wins per lemma. An exact tie
 * favours `incoming` (the imported row) — arbitrary but deterministic, and
 * matches "importing should have *some* effect on a dead heat" over
 * silently no-op-ing. */
export function mergeWordKnowledge(
  existing: WordKnowledge[],
  incoming: WordKnowledge[],
): WordKnowledge[] {
  const byLemma = new Map<string, WordKnowledge>();
  for (const row of existing) byLemma.set(row.lemma, row);
  for (const row of incoming) {
    const cur = byLemma.get(row.lemma);
    if (!cur || row.updatedAt >= cur.updatedAt) byLemma.set(row.lemma, row);
  }
  return [...byLemma.values()];
}

/** Merge FSRS review states: newer `lastReview` wins per sentenceId.
 * ReviewState has no explicit updatedAt field — lastReview (epoch ms of the
 * most recent grade) is the closest proxy for "which record reflects more
 * recent learning progress"; a never-reviewed state (lastReview=null) is
 * treated as older than any reviewed one so a real review always wins over a
 * bare "new" placeholder for the same card. */
export function mergeReviewStates(existing: ReviewState[], incoming: ReviewState[]): ReviewState[] {
  const byId = new Map<string, ReviewState>();
  for (const row of existing) byId.set(row.sentenceId, row);
  for (const row of incoming) {
    const cur = byId.get(row.sentenceId);
    if (!cur || (row.lastReview ?? -Infinity) >= (cur.lastReview ?? -Infinity)) {
      byId.set(row.sentenceId, row);
    }
  }
  return [...byId.values()];
}

function gateSessionKey(s: BackupGateSession): string {
  return `${s.courseId}|${s.startedAt}|${s.appKey ?? ""}`;
}

/** Which `incoming` gate-session rows are genuinely new relative to
 * `existing`, by identity (courseId+startedAt+appKey — a session can't start
 * twice in the same app at the same millisecond). Exported separately from
 * mergeGateSessions because the IndexedDB gateSessions store has no natural
 * upsert key (autoIncrement id only) — the import wiring layer can only ever
 * ADD rows, never overwrite one by key, so it needs exactly this "what's
 * missing" list rather than a full merged array to write back. */
export function newGateSessions(
  existing: BackupGateSession[],
  incoming: BackupGateSession[],
): BackupGateSession[] {
  const existingKeys = new Set(existing.map(gateSessionKey));
  return incoming.filter((row) => !existingKeys.has(gateSessionKey(row)));
}

/** Full merged gate-session history (existing + whatever's new from
 * incoming) — these are immutable historical log rows, so "merge" is a
 * dedupe-by-identity union, not a pick-the-newer-value comparison. */
export function mergeGateSessions(
  existing: BackupGateSession[],
  incoming: BackupGateSession[],
): BackupGateSession[] {
  return [...existing, ...newGateSessions(existing, incoming)];
}

export interface CurrentBackupData {
  courses: Record<string, BackupCourseData>;
  settings: BackupSettings;
}

export interface MergeResult {
  courses: Record<string, BackupCourseData>;
  /**
   * Settings to apply. In merge mode this is always null: an imported
   * settings blob has no per-field timestamp to compare (unlike
   * wordKnowledge/reviewStates), so blindly overwriting the CURRENT device's
   * active preferences (unlock minutes, TTS rate, UI language...) during a
   * "merge my old backup's progress in" import would be surprising — the
   * learner is actively using this device's settings. In replace-all mode the
   * backup is an unambiguous full restore, so its settings apply verbatim.
   */
  settingsToApply: BackupSettings | null;
}

/** Merge an entire imported backup into the current device's data.
 * replaceAll=true short-circuits to "the backup wins entirely" (both data
 * and settings) — the caller is responsible for actually clearing existing
 * storage first in that case; this function only computes what the end
 * state should look like. */
export function mergeBackups(
  current: CurrentBackupData,
  incoming: BackupFile,
  replaceAll: boolean,
): MergeResult {
  if (replaceAll) {
    return { courses: incoming.courses, settingsToApply: incoming.settings };
  }
  const courseIds = new Set([...Object.keys(current.courses), ...Object.keys(incoming.courses)]);
  const emptyCourse: BackupCourseData = { wordKnowledge: [], reviewStates: [], gateSessions: [] };
  const courses: Record<string, BackupCourseData> = {};
  for (const id of courseIds) {
    const cur = current.courses[id] ?? emptyCourse;
    const inc = incoming.courses[id] ?? emptyCourse;
    courses[id] = {
      wordKnowledge: mergeWordKnowledge(cur.wordKnowledge, inc.wordKnowledge),
      reviewStates: mergeReviewStates(cur.reviewStates, inc.reviewStates),
      gateSessions: mergeGateSessions(cur.gateSessions, inc.gateSessions),
    };
  }
  return { courses, settingsToApply: null };
}
