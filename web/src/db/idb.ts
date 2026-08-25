// Thin IndexedDB wrapper for LingoGate's learning state. Three object stores:
//   reviewStates  keyPath "sentenceId"  — FSRS state per card
//   gateSessions  autoIncrement          — one row per gate unlock event (stats)
//   meta          keyPath "key"          — settings + gate suppression windows
//
// Kept deliberately small (promisified request helpers, no external dep). All
// values are plain JSON-serialisable objects.

import type { ReviewState } from "../engine/fsrs";
import type { WordKnowledge } from "../engine/calibration";

const DB_NAME = "lingogate";
const DB_VERSION = 2;

export interface GateSessionRow {
  id?: number;
  appKey: string | null;
  startedAt: number;
  endedAt: number | null;
  questions: number;
  correct: number;
  durationMs: number | null;
  unlocked: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

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
    req.onsuccess = () => resolve(req.result);
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

// MARK: reviewStates

export function getAllReviewStates(): Promise<ReviewState[]> {
  return tx<ReviewState[]>("reviewStates", "readonly", (s) => s.getAll());
}

export function putReviewStates(states: ReviewState[]): Promise<void> {
  if (states.length === 0) return Promise.resolve();
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction("reviewStates", "readwrite");
        const store = t.objectStore("reviewStates");
        for (const st of states) store.put(st);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

// MARK: gateSessions

export function addGateSession(row: GateSessionRow): Promise<number> {
  return tx<IDBValidKey>("gateSessions", "readwrite", (s) => s.add(row)).then((k) => Number(k));
}

export function getAllGateSessions(): Promise<GateSessionRow[]> {
  return tx<GateSessionRow[]>("gateSessions", "readonly", (s) => s.getAll());
}

// MARK: wordKnowledge (LINGO-010 calibration map)

export function getAllWordKnowledge(): Promise<WordKnowledge[]> {
  return tx<WordKnowledge[]>("wordKnowledge", "readonly", (s) => s.getAll());
}

export function putWordKnowledge(rows: WordKnowledge[]): Promise<void> {
  if (rows.length === 0) return Promise.resolve();
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction("wordKnowledge", "readwrite");
        const store = t.objectStore("wordKnowledge");
        for (const r of rows) store.put(r);
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
