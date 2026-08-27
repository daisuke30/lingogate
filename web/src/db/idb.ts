// Thin IndexedDB wrapper for LingoGate's learning state. Three object stores:
//   reviewStates  keyPath "sentenceId"  — FSRS state per card
//   gateSessions  autoIncrement          — one row per gate unlock event (stats)
//   meta          keyPath "key"          — settings + gate suppression windows
//
// Kept deliberately small (promisified request helpers, no external dep). All
// values are plain JSON-serialisable objects.

import type { ReviewState } from "../engine/fsrs";
import type { WordKnowledge } from "../engine/calibration";
// LINGO-014 course dimension (additive-only key scoping — see courseScope.ts).
import { DEFAULT_COURSE, belongsToCourse, scopeKey, unscopeKey } from "./courseScope";

const DB_NAME = "lingogate";
const DB_VERSION = 2;

export interface GateSessionRow {
  id?: number;
  /** LINGO-014: which course this gate belonged to. Absent on pre-LINGO-014
   * rows → treated as the default RU course on read. */
  courseId?: string;
  appKey: string | null;
  startedAt: number;
  endedAt: number | null;
  questions: number;
  correct: number;
  durationMs: number | null;
  unlocked: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// LINGO-010 follow-up (2026-08-26): a PWA tab can stay alive in the background
// across a deploy (iOS "add to home screen" apps especially). If an old
// connection from a *previous* JS bundle is still open when a *new* bundle
// (with a bumped DB_VERSION) tries to open the DB, IndexedDB fires 'blocked'
// on the new open() and never resolves it — until the old connection closes.
// Symptom reported by Katsuta: a feature gated behind a promise that reads
// from a store added in a version bump (the wordKnowledge store, v1->v2)
// silently never showed up. Fix: every connection we open registers
// onversionchange and closes itself as soon as *another* open() elsewhere
// requests a newer version, so upgrades never hang.
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("reviewStates")) {
        db.createObjectStore("reviewStates", { keyPath: "sentenceId" });
      }
      if (!db.objectStoreNames.contains("gateSessions")) {
        db.createObjectStore("gateSessions", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      // v2 (LINGO-010): per-lemma known/unknown calibration map.
      if (!db.objectStoreNames.contains("wordKnowledge")) {
        db.createObjectStore("wordKnowledge", { keyPath: "lemma" });
      }
    };
    req.onblocked = () => {
      console.warn(
        "lingogate: IndexedDB upgrade blocked by another open connection (stale tab?)",
      );
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null; // next call reopens (and lets a pending upgrade elsewhere proceed)
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// MARK: reviewStates (course-scoped by sentenceId key, LINGO-014)

export function getAllReviewStates(courseId: string = DEFAULT_COURSE): Promise<ReviewState[]> {
  return tx<ReviewState[]>("reviewStates", "readonly", (s) => s.getAll()).then((rows) =>
    rows
      .filter((st) => belongsToCourse(courseId, st.sentenceId))
      // Hand the engine the bare sentenceId it expects (deck ids are un-prefixed).
      .map((st) => ({ ...st, sentenceId: unscopeKey(courseId, st.sentenceId) })),
  );
}

export function putReviewStates(
  states: ReviewState[],
  courseId: string = DEFAULT_COURSE,
): Promise<void> {
  if (states.length === 0) return Promise.resolve();
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction("reviewStates", "readwrite");
        const store = t.objectStore("reviewStates");
        // Never mutate the caller's objects; write a course-scoped copy.
        for (const st of states) {
          store.put({ ...st, sentenceId: scopeKey(courseId, st.sentenceId) });
        }
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

// MARK: gateSessions (course tagged via a field; autoIncrement key unchanged)

export function addGateSession(
  row: GateSessionRow,
  courseId: string = DEFAULT_COURSE,
): Promise<number> {
  return tx<IDBValidKey>("gateSessions", "readwrite", (s) => s.add({ ...row, courseId })).then((k) =>
    Number(k),
  );
}

/** Gate sessions for `courseId`. Pre-LINGO-014 rows have no courseId → counted
 * as the default RU course. Pass no argument to get every row (unfiltered). */
export function getAllGateSessions(courseId?: string): Promise<GateSessionRow[]> {
  return tx<GateSessionRow[]>("gateSessions", "readonly", (s) => s.getAll()).then((rows) =>
    courseId == null
      ? rows
      : rows.filter((r) => (r.courseId ?? DEFAULT_COURSE) === courseId),
  );
}

// MARK: wordKnowledge (course-scoped by lemma key, LINGO-010 + LINGO-014)

export function getAllWordKnowledge(courseId: string = DEFAULT_COURSE): Promise<WordKnowledge[]> {
  return tx<WordKnowledge[]>("wordKnowledge", "readonly", (s) => s.getAll()).then((rows) =>
    rows
      .filter((r) => belongsToCourse(courseId, r.lemma))
      .map((r) => ({ ...r, lemma: unscopeKey(courseId, r.lemma) })),
  );
}

export function putWordKnowledge(
  rows: WordKnowledge[],
  courseId: string = DEFAULT_COURSE,
): Promise<void> {
  if (rows.length === 0) return Promise.resolve();
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction("wordKnowledge", "readwrite");
        const store = t.objectStore("wordKnowledge");
        for (const r of rows) store.put({ ...r, lemma: scopeKey(courseId, r.lemma) });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

// MARK: meta (settings + suppression)

export function getMeta<T>(key: string, fallback: T): Promise<T> {
  return tx<{ key: string; value: T } | undefined>("meta", "readonly", (s) => s.get(key)).then(
    (row) => (row ? row.value : fallback),
  );
}

export function setMeta<T>(key: string, value: T): Promise<void> {
  return tx("meta", "readwrite", (s) => s.put({ key, value })).then(() => undefined);
}

/** Wipe all learning state — used by the dev "reset" affordance so a fresh
 * reproduction run starts from zero. */
export function resetAll(): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(
          ["reviewStates", "gateSessions", "meta", "wordKnowledge"],
          "readwrite",
        );
        t.objectStore("reviewStates").clear();
        t.objectStore("gateSessions").clear();
        t.objectStore("meta").clear();
        t.objectStore("wordKnowledge").clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}
