// App service: loads the bundled deck, hydrates review state from IndexedDB,
// builds/commits gate sessions, and computes home-screen stats. The React layer
// talks only to this module (and settings.ts), never to the engine/db directly.

import type { Deck } from "../engine/content";
import type { DeckWord } from "../engine/content";
import { ContentStore } from "../engine/content";
import type { MasteryStats } from "../engine/mastery";
import { FSRS } from "../engine/fsrs";
import { buildGateSession, GateSessionRunner } from "../engine/session";
import { SeededRNG } from "../engine/rng";
import { knowledgeUpdatesFromOutcomes } from "../engine/calibration";
import { evaluateBandPromotion } from "../engine/bandPromotion";
import type { BandProgress } from "../engine/bandPromotion";
import { BOOTSTRAP_DECK, DEFAULT_COURSE_ID, resolveCourse } from "../content/courses";
import type { Lang } from "../content/courses";
import { getActiveCourse, getFrontLang, getUnlockedBand, setUnlockedBand } from "./settings";
import {
  getAllReviewStates,
  putReviewStates,
  addGateSession,
  getAllGateSessions,
  getAllWordKnowledge,
  putWordKnowledge,
} from "../db/idb";

// LINGO-014: the deck is now the *active course's* pack, loaded lazily. These
// are live bindings (mutable) so a course switch can swap them in place; they
// start on the bootstrap RU pack so synchronous consumers (WORD_BY_ID in the
// flashcard, DECK in HomeView's fallback) always have real data on first paint.
export let DECK: Deck = BOOTSTRAP_DECK;
export let PRIMARY_BAND: number = DECK.bands[0] ?? 1;
/** lemma-id -> DeckWord for the active course. Exported for the card-back word
 * breakdown (LINGO-012, engine/wordBreakdown.ts). Live binding — reassigned on
 * course switch, so importers see the current course's words. */
export let WORD_BY_ID: Map<number, DeckWord> = new Map(DECK.words.map((w) => [w.id, w]));

let activeCourseId: string = DEFAULT_COURSE_ID;
let activeFrontLang: Lang = resolveCourse(DEFAULT_COURSE_ID).defaultFrontLang;
let loadedCourseId: string | null = DEFAULT_COURSE_ID; // which course DECK currently holds
let ensuring: Promise<void> | null = null;

const fsrs = new FSRS();

/** Ensure DECK/WORD_BY_ID/etc. reflect the persisted active course. Cheap and
 * idempotent once loaded; every async entry point below awaits it first so the
 * React layer never has to think about course loading. */
export async function ensureCourse(): Promise<void> {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    const courseId = await getActiveCourse();
    const course = resolveCourse(courseId);
    activeCourseId = course.courseId;
    activeFrontLang = await getFrontLang(course.courseId);
    if (loadedCourseId !== course.courseId) {
      // Only load a pack we don't already have. The default RU pack is the
      // bootstrap deck (already loaded); other courses come from load().
      if (course.courseId !== DEFAULT_COURSE_ID && course.load) {
        const deck = await course.load();
        DECK = deck;
        PRIMARY_BAND = DECK.bands[0] ?? 1;
        WORD_BY_ID = new Map(DECK.words.map((w) => [w.id, w]));
      } else {
        DECK = BOOTSTRAP_DECK;
        PRIMARY_BAND = DECK.bands[0] ?? 1;
        WORD_BY_ID = new Map(DECK.words.map((w) => [w.id, w]));
      }
      loadedCourseId = course.courseId;
    }
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export function activeCourse(): string {
  return activeCourseId;
}

export function activeFrontLanguage(): Lang {
  return activeFrontLang;
}

// MARK: band promotion (LINGO-024)

/** Bands above this are never a promotion target, even if the deck ships
 * sentences for them (RU's band 4 does — see engine/content.ts's ContentStore
 * .masteryStats doc comment: band 4 is the "retired but retained" pool of
 * old band1-3 lemmas that fell out of the top-3000 frequency cut during the
 * LINGO-020 rebaseline, kept only so existing progress still resolves — never
 * a genuine curriculum band). Matches mastery.ts's 3000-word mastery frame. */
export const MAX_ACTIVE_BAND = 3;

/**
 * Evaluate `band`'s own coverage/retention against BandPromotion's
 * thresholds and, if it passes AND `band` is still the course's currently
 * unlocked band AND band+1 actually exists as real content in this course,
 * unlock band+1. Returns the progress either way (so a caller can show a
 * progress readout even when not promoted yet), or null when there's no next
 * band to evaluate at all (already at MAX_ACTIVE_BAND, or the course has no
 * band+1 sentences yet — e.g. EN today, band1-only).
 */
export async function checkBandPromotion(band: number): Promise<BandProgress | null> {
  const nextBand = band + 1;
  if (band >= MAX_ACTIVE_BAND || !DECK.bands.includes(nextBand)) return null;

  const store = await loadStore();
  const vocab = store.bandVocabStats(band);
  const ret = store.bandRetention(band);
  const progress = evaluateBandPromotion({
    band,
    seenWords: vocab.studied,
    totalWords: vocab.total,
    coverableWords: vocab.coverable,
    reps: ret.reps,
    lapses: ret.lapses,
    reviewCards: ret.reviewCards,
  });

  if (progress.promoted) {
    const current = await getUnlockedBand(activeCourseId);
    if (current === band) await setUnlockedBand(activeCourseId, nextBand);
  }
  return progress;
}

async function loadKnowledge(): Promise<Map<string, "known" | "unknown" | "unset">> {
  const rows = await getAllWordKnowledge(activeCourseId);
  const map = new Map<string, "known" | "unknown" | "unset">();
  for (const r of rows) map.set(r.lemma, r.status);
  return map;
}

export async function loadStore(): Promise<ContentStore> {
  await ensureCourse();
  const [states, knowledge] = await Promise.all([
    getAllReviewStates(activeCourseId),
    loadKnowledge(),
  ]);
  return new ContentStore(DECK, states, knowledge);
}

export interface StartedSession {
  runner: GateSessionRunner;
  startedAt: number;
}

/** `continuous: true` (Home's "ロシア語を解く") builds a runner that resolves
 * every card — Again included — after exactly one grade (see session.ts's
 * GateSessionRunner doc comment). Omitted/false (=/gate, and the default)
 * keeps the toll behaviour: a batch only completes once every card has a
 * non-Again grade.
 *
 * LINGO-024: the session pool ceiling is the course's persisted
 * `unlockedBand`, not the fixed PRIMARY_BAND (=band 1) — once band 2
 * promotes, new cards and due reviews are drawn from the whole 1..
 * unlockedBand pool (see engine/content.ts's dueReviews/newSentences pool-
 * ceiling doc comments). */
export async function startSession(
  opts: { seed?: number; continuous?: boolean } = {},
): Promise<StartedSession> {
  const store = await loadStore();
  const unlockedBand = await getUnlockedBand(activeCourseId);
  const now = Date.now();
  const rng = new SeededRNG(opts.seed ?? now);
  const plan = buildGateSession(store, { band: unlockedBand, now, rng });
  const runner = new GateSessionRunner(plan, fsrs, { requeueAgain: !opts.continuous });
  return { runner, startedAt: now };
}

/** Write buffered FSRS grades + word-knowledge feedback for whatever has been
 * graded so far (a full session or a partial/abandoned one — `drainPendingUpserts`
 * and `knowledgeOutcomes` both only ever reflect graded cards, so this is safe
 * to call on an in-progress runner). Idempotent: draining an empty buffer is a
 * no-op (see db/idb.ts putReviewStates/putWordKnowledge). */
async function persistGrades(runner: GateSessionRunner): Promise<void> {
  await putReviewStates(runner.drainPendingUpserts(), activeCourseId);

  // Feed review results back into the word-knowledge map: Again -> unknown,
  // clean Good pass on a target sentence -> known (source 'review').
  const knowledge = await loadKnowledge();
  const knowledgeUpdates = knowledgeUpdatesFromOutcomes(
    runner.knowledgeOutcomes(),
    WORD_BY_ID,
    knowledge,
    Date.now(),
  );
  await putWordKnowledge(knowledgeUpdates, activeCourseId);
}

/** Persist a finished gate session: commit buffered FSRS grades + knowledge
 * feedback, record the GateSession row (today's stats), and evaluate band
 * promotion (LINGO-024) for the course's currently unlocked band — this is
 * the "セッション完了時に評価" trigger. Returns the promotion progress (never
 * throws on a non-promotion; `.promoted` tells the caller whether to
 * celebrate) so the UI can show "band2解放！" — or null when there's no next
 * band to evaluate at all (see checkBandPromotion's doc comment). */
export async function commitSession(
  session: StartedSession,
  opts: { appKey: string | null; unlocked: boolean },
): Promise<BandProgress | null> {
  const { runner, startedAt } = session;
  const endedAt = Date.now();
  await persistGrades(runner);

  await addGateSession(
    {
      appKey: opts.appKey,
      startedAt,
      endedAt,
      questions: runner.totalCards,
      correct: runner.firstTryCorrect,
      durationMs: endedAt - startedAt,
      unlocked: opts.unlocked,
    },
    activeCourseId,
  );

  const unlockedBand = await getUnlockedBand(activeCourseId);
  return checkBandPromotion(unlockedBand);
}

/** Persist an early exit mid-batch (continuous home-practice mode): whatever
 * cards were graded before the learner tapped "終了" are committed exactly
 * like a normal completion, but no GateSession row is written — the batch was
 * never actually completed, so it shouldn't count toward today's gate/unlock
 * stats. Ungraded (still-queued) cards are simply dropped along with the
 * runner; nothing references them once this resolves. Band promotion is
 * still evaluated (LINGO-024) — whatever was graded before exiting still
 * counts toward it, same as any other persisted grade. */
export async function commitPartialSession(session: StartedSession): Promise<BandProgress | null> {
  await persistGrades(session.runner);
  const unlockedBand = await getUnlockedBand(activeCourseId);
  return checkBandPromotion(unlockedBand);
}

export interface HomeStats {
  todayGates: number;
  todayUnlocks: number;
  knownRatePct: number | null; // over today's answered questions
  /** LINGO-024: the course's currently unlocked band (1 = only band 1). */
  unlockedBand: number;
  coverage: { covered: number; total: number; pct: number };
  retentionPct: number | null;
  reviewCards: number;
  dueNow: number;
  mastery: MasteryStats; // "会話頻出3000語マスター" (LINGO-013)
  /** LINGO-024: progress toward promoting PAST `unlockedBand` — the actual
   * coverage/retention ratios BandPromotion gates on (coverable-word
   * denominator), distinct from `coverage` above (which uses a total-word
   * denominator for the general vocab-progress meter — a different, older
   * metric kept as-is). null once there's no next band to promote to (already
   * at MAX_ACTIVE_BAND, or the course has no band+1 content yet — e.g. EN). */
  bandPromotion: BandProgress | null;
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
  const store = await loadStore(); // also ensures the active course is loaded
  const sessions = await getAllGateSessions(activeCourseId);
  const today = sessions.filter((s) => isToday(s.startedAt, now));
  const todayGates = today.length;
  const todayUnlocks = today.filter((s) => s.unlocked).length;
  const q = today.reduce((a, s) => a + s.questions, 0);
  const c = today.reduce((a, s) => a + s.correct, 0);
  const knownRatePct = q > 0 ? Math.round((100 * c) / q) : null;

  const unlockedBand = await getUnlockedBand(activeCourseId);

  const vocab = store.bandVocabStats(unlockedBand);
  const coverage = {
    covered: vocab.studied,
    total: vocab.total,
    pct: vocab.total > 0 ? Math.round((100 * vocab.studied) / vocab.total) : 0,
  };
  const ret = store.bandRetention(unlockedBand);
  const retDenom = ret.reps + ret.lapses;
  const retentionPct = retDenom > 0 ? Math.round((100 * ret.reps) / retDenom) : null;

  const dueNow = store.dueReviews(unlockedBand, now, 9999).length;

  const mastery = store.masteryStats();

  // LINGO-024: read-only progress readout toward promoting past
  // `unlockedBand` — never writes/promotes here, Home only reports status.
  // null once there's no next band left to promote into.
  const nextBand = unlockedBand + 1;
  const bandPromotion =
    nextBand <= MAX_ACTIVE_BAND && DECK.bands.includes(nextBand)
      ? evaluateBandPromotion({
          band: unlockedBand,
          seenWords: vocab.studied,
          totalWords: vocab.total,
          coverableWords: vocab.coverable,
          reps: ret.reps,
          lapses: ret.lapses,
          reviewCards: ret.reviewCards,
        })
      : null;

  return {
    todayGates,
    todayUnlocks,
    knownRatePct,
    unlockedBand,
    coverage,
    retentionPct,
    reviewCards: ret.reviewCards,
    dueNow,
    mastery,
    bandPromotion,
  };
}
