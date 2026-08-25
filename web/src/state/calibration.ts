// Calibration service: wires the pure knowledge logic (engine/calibration.ts) to
// IndexedDB and the bundled deck. The React layer talks only to this module.

import { DECK, PRIMARY_BAND } from "./service";
import { FSRS } from "../engine/fsrs";
import type { DeckWord, Sentence } from "../engine/content";
import { judgedCount, seedKnownReviewStatesForLemmas } from "../engine/calibration";
import type { KnowledgeMap, WordKnowledge } from "../engine/calibration";
import {
  getAllWordKnowledge,
  putWordKnowledge,
  getAllReviewStates,
  putReviewStates,
} from "../db/idb";

const fsrs = new FSRS();

export const CALIBRATION_BATCH_SIZE = 50;

/** All band1 words, ascending frequency rank (the triage order). */
function bandWordsByRank(): DeckWord[] {
  return DECK.words
    .filter((w) => w.band === PRIMARY_BAND)
    .slice()
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

export async function loadKnowledgeMap(): Promise<KnowledgeMap> {
  const rows = await getAllWordKnowledge();
  const map: KnowledgeMap = new Map();
  for (const r of rows) map.set(r.lemma, r.status);
  return map;
}

export interface CalibrationProgress {
  total: number;
  judged: number;
  known: number;
  unknown: number;
  done: boolean;
}

export async function calibrationProgress(): Promise<CalibrationProgress> {
  const rows = await getAllWordKnowledge();
  const total = bandWordsByRank().length;
  let known = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.status === "known") known += 1;
    else if (r.status === "unknown") unknown += 1;
  }
  const judged = known + unknown;
  return { total, judged, known, unknown, done: judged >= total };
}

export interface CalibrationBatch {
  words: DeckWord[];
  total: number;
  judged: number;
}

/** Next up-to-`size` un-judged band1 words in rank order. */
export async function nextCalibrationBatch(
  size = CALIBRATION_BATCH_SIZE,
): Promise<CalibrationBatch> {
  const map = await loadKnowledgeMap();
  const all = bandWordsByRank();
  const words: DeckWord[] = [];
  for (const w of all) {
    const st = map.get(w.lemma);
    if (st === "known" || st === "unknown") continue;
    words.push(w);
    if (words.length >= size) break;
  }
  return { words, total: all.length, judged: judgedCount(map) };
}

/** Example sentence teaching each band1 target lemma — used as the "meaning"
 * reveal on the calibration card (words have no standalone gloss). */
export function targetSentenceByLemma(): Map<string, Sentence> {
  const out = new Map<string, Sentence>();
  for (const s of DECK.sentences) {
    if (s.targetLemma && !out.has(s.targetLemma)) out.set(s.targetLemma, s);
  }
  return out;
}

/** Record one calibration judgement. When known, seed "already mastered" FSRS
 * states for the sentences that teach that lemma (skipping any already studied). */
export async function submitCalibration(lemma: string, known: boolean): Promise<void> {
  const now = Date.now();
  const row: WordKnowledge = {
    lemma,
    status: known ? "known" : "unknown",
    updatedAt: now,
    source: "calibration",
  };
  await putWordKnowledge([row]);

  if (known) {
    const existing = await getAllReviewStates();
    const have = new Set(existing.map((s) => s.sentenceId));
    const seeds = seedKnownReviewStatesForLemmas(DECK.sentences, [lemma], now, have, fsrs);
    if (seeds.length) await putReviewStates(seeds);
  }
}
