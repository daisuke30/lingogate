// App service: loads the bundled deck, hydrates review state from IndexedDB,
// builds/commits gate sessions, and computes home-screen stats. The React layer
// talks only to this module (and settings.ts), never to the engine/db directly.

import deckJson from "../content/deck.generated.json";
import type { Deck } from "../engine/content";
import { ContentStore } from "../engine/content";
import { FSRS } from "../engine/fsrs";
import { buildGateSession, GateSessionRunner } from "../engine/session";
import { SeededRNG } from "../engine/rng";
import { knowledgeUpdatesFromOutcomes } from "../engine/calibration";
import {
  getAllReviewStates,
  putReviewStates,
  addGateSession,
  getAllGateSessions,
  getAllWordKnowledge,
  putWordKnowledge,
} from "../db/idb";

export const DECK = deckJson as unknown as Deck;
export const PRIMARY_BAND = DECK.bands[0] ?? 1;

const fsrs = new FSRS();
const WORD_BY_ID = new Map(DECK.words.map((w) => [w.id, w]));

async function loadKnowledge(): Promise<Map<string, "known" | "unknown" | "unset">> {
  const rows = await getAllWordKnowledge();
  const map = new Map<string, "known" | "unknown" | "unset">();
  for (const r of rows) map.set(r.lemma, r.status);
  return map;
}

export async function loadStore(): Promise<ContentStore> {
  const [states, knowledge] = await Promise.all([getAllReviewStates(), loadKnowledge()]);
  return new ContentStore(DECK, states, knowledge);
}

export interface StartedSession {
  runner: GateSessionRunner;
  startedAt: number;
}

export async function startSession(seed?: number): Promise<StartedSession> {
  const store = await loadStore();
  const now = Date.now();
  const rng = new SeededRNG(seed ?? now);
  const plan = buildGateSession(store, { band: PRIMARY_BAND, now, rng });
  const runner = new GateSessionRunner(plan, fsrs);
  return { runner, startedAt: now };
}

/** Persist a finished (or abandoned) gate session: commit buffered FSRS grades
 * and record the GateSession row. Returns nothing. */
export async function commitSession(
  session: StartedSession,
  opts: { appKey: string | null; unlocked: boolean },
): Promise<void> {
  const { runner, startedAt } = session;
  const endedAt = Date.now();
  await putReviewStates(runner.drainPendingUpserts());

  // Feed review results back into the word-knowledge map: Again -> unknown,
  // clean Good pass on a target sentence -> known (source 'review').
  const knowledge = await loadKnowledge();
  const knowledgeUpdates = knowledgeUpdatesFromOutcomes(
    runner.knowledgeOutcomes(),
    WORD_BY_ID,
    knowledge,
    endedAt,
  );
  await putWordKnowledge(knowledgeUpdates);

  await addGateSession({
    appKey: opts.appKey,
    startedAt,
    endedAt,
    questions: runner.totalCards,
    correct: runner.firstTryCorrect,
    durationMs: endedAt - startedAt,
    unlocked: opts.unlocked,
  });
}

export interface HomeStats {
  todayGates: number;
  todayUnlocks: number;
  knownRatePct: number | null; // over today's answered questions
  coverage: { covered: number; total: number; pct: number };
  retentionPct: number | null;
  reviewCards: number;
  dueNow: number;
}

function isToday(ts: number, now: number): boolean {
  const d = new Date(ts);
  const n = new Date(now);
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

export async function homeStats(): Promise<HomeStats> {
  const now = Date.now();
  const store = await loadStore();
  const sessions = await getAllGateSessions();
  const today = sessions.filter((s) => isToday(s.startedAt, now));
  const todayGates = today.length;
  const todayUnlocks = today.filter((s) => s.unlocked).length;
  const q = today.reduce((a, s) => a + s.questions, 0);
  const c = today.reduce((a, s) => a + s.correct, 0);
  const knownRatePct = q > 0 ? Math.round((100 * c) / q) : null;

  const vocab = store.bandVocabStats(PRIMARY_BAND);
  const coverage = {
    covered: vocab.studied,
    total: vocab.total,
    pct: vocab.total > 0 ? Math.round((100 * vocab.studied) / vocab.total) : 0,
  };
  const ret = store.bandRetention(PRIMARY_BAND);
  const retDenom = ret.reps + ret.lapses;
  const retentionPct = retDenom > 0 ? Math.round((100 * ret.reps) / retDenom) : null;

  const dueNow = store.dueReviews(PRIMARY_BAND, now, 9999).length;

  return {
    todayGates,
    todayUnlocks,
    knownRatePct,
    coverage,
    retentionPct,
    reviewCards: ret.reviewCards,
    dueNow,
  };
}
