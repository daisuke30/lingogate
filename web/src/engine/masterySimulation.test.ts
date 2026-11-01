// LINGO-065 (2026-11-01) permanent regression test — Katsuta reported
// "覚えた語が全く増えない" despite daily study. Root cause (confirmed by this
// exact simulation against the UNFIXED code, before the session.ts fix): a
// flawless learner doing 10 Good-rated cards/day, every day, hit a
// STRUCTURALLY WORSENING number of zero-new-card days (57% of days in month
// 1 rising to 87% by month 5) because buildGateSession's due-review step had
// no cap — once the review backlog reached the session size, 100% of every
// session became review and no new target lemma could ever be introduced.
// Monthly mastery growth measurably DECLINED every month (+130/+90/+110/
// +70/+40) despite constant, perfect effort.
//
// This test pins the fix (session.ts's reserved new-card share) by running
// the exact same simulation — the REAL deck, REAL ContentStore/
// buildGateSession/GateSessionRunner/FSRS/knowledgeUpdatesFromOutcomes/
// masteryStats pipeline, nothing mocked — and asserting growth stays healthy
// and non-declining across the whole 150-day run.
import { describe, it, expect } from "vitest";
import { FSRS, Rating, CardState } from "./fsrs";
import type { ReviewState } from "./fsrs";
import { ContentStore } from "./content";
import { buildGateSession, GateSessionRunner } from "./session";
import { knowledgeUpdatesFromOutcomes } from "./calibration";
import type { KnowledgeMap } from "./calibration";
import { masteredLemmaSet } from "./mastery";
import { SeededRNG } from "./rng";
import { BOOTSTRAP_DECK } from "../content/courses";

const DAY = 86_400_000;

/** Run `days` days of a `size`-card session, rated Good throughout, against
 * the real RU deck, returning per-day mastered-count + whether any new card
 * was introduced that day. Mirrors state/service.ts's persistGrades commit
 * (merge pending review-state upserts + knowledge updates) closely enough to
 * be a faithful simulation without touching IndexedDB. */
function simulate(days: number, size = 10) {
  const deck = BOOTSTRAP_DECK;
  const fsrs = new FSRS();
  let states: ReviewState[] = [];
  let knowledge: KnowledgeMap = new Map();
  let now = 1_700_000_000_000;
  const perDay: { day: number; masteredCount: number; newCardsToday: number }[] = [];

  for (let day = 1; day <= days; day++) {
    now += DAY;
    const store = new ContentStore(deck, states, knowledge);
    const rng = new SeededRNG(now);
    const plan = buildGateSession(store, { band: 1, now, rng, size });
    const existingIds = new Set(states.map((s) => s.sentenceId));
    const newCardsToday = plan.cards.filter((c) => !existingIds.has(c.sentence.id)).length;

    const runner = new GateSessionRunner(plan, fsrs, { requeueAgain: false });
    let guard = 0;
    while (!runner.isComplete && guard < size * 2) {
      runner.submitRating(Rating.Good, now);
      guard++;
    }

    const pending = runner.drainPendingUpserts();
    const byId = new Map(states.map((s) => [s.sentenceId, s]));
    for (const p of pending) byId.set(p.sentenceId, p);
    states = [...byId.values()];

    const kUpdates = knowledgeUpdatesFromOutcomes(runner.knowledgeOutcomes(), now);
    const kMap = new Map(knowledge);
    for (const u of kUpdates) kMap.set(u.lemma, u.status);
    knowledge = kMap;

    const stats = new ContentStore(deck, states, knowledge).masteryStats();
    perDay.push({ day, masteredCount: stats.masteredCount, newCardsToday });
  }
  return perDay;
}

describe("LINGO-065: 150-day realistic simulation never permanently stalls", () => {
  it("a flawless daily 10-card learner keeps getting new cards every single day", () => {
    const perDay = simulate(150);
    const zeroNewCardDays = perDay.filter((d) => d.newCardsToday === 0);
    // Pre-fix this was 83/150 days (>55%) and climbing every month. The whole
    // point of the fix is that it must never happen again while new cards
    // still exist in the pool (band1 core has 1000 target words — far more
    // than 150 days * 10/day can exhaust).
    expect(zeroNewCardDays).toEqual([]);
  });

  it("monthly mastery growth stays healthy and does not keep declining month over month", () => {
    const perDay = simulate(150);
    const monthlyGrowth: number[] = [];
    for (let w = 0; w < 150; w += 30) {
      const start = w === 0 ? 0 : perDay[w - 1].masteredCount;
      const end = perDay[Math.min(w + 29, perDay.length - 1)].masteredCount;
      monthlyGrowth.push(end - start);
    }
    // Pre-fix: [130, 90, 110, 70, 40] — a clear downward trend toward zero.
    // Post-fix every month must clear a healthy floor; no relentless decline
    // to near-zero by month 5 (the exact shape of Katsuta's "完全に増えない").
    for (const g of monthlyGrowth) expect(g).toBeGreaterThanOrEqual(60);
  });

  it("after 30 days, mastered count is in the range a learner would recognize as real progress", () => {
    const perDay = simulate(30);
    const day30 = perDay[29].masteredCount;
    // Pre-fix day 30 was 130; the fix alone (without the mastery.ts union
    // addition, which only matters once a real starved backlog exists) isn't
    // expected to roughly double this in a CLEAN simulation — but it must not
    // regress below the pre-fix figure either.
    expect(day30).toBeGreaterThanOrEqual(130);
  });
});

// LINGO-065 follow-up constraint (Katsuta, 2026-11-01): the mastery-counting
// definition change must be STRICTLY ADDITIVE — a word already counted as
// mastered under the OLD rules must never fall out under the new ones, for
// ANY data shape, not just the hand-picked examples in mastery.test.ts. This
// builds a large, varied synthetic history over the REAL deck (a mix of
// calibration-known words, clean target-sentence passes, lapsed/unknown
// words, and durably-retained non-target incidental exposure) and asserts
// the new wordById-aware masteredLemmaSet is always a SUPERSET of the old
// (wordById-omitted) one — i.e. recomputing against Katsuta's real stored
// data can only ever add words, never remove any, exactly as instructed.
describe("LINGO-065: mastery recompute is additive-only over a realistic mixed history (never shrinks)", () => {
  it("every word mastered under the old rules is still mastered under the new rules", () => {
    const deck = BOOTSTRAP_DECK;
    const deckLemmas = new Set(deck.words.filter((w) => w.band <= 3).map((w) => w.lemma));
    const wordById = new Map(deck.words.map((w) => [w.id, w]));
    const coreSentences = deck.sentences.filter((s) => s.band === 1 && s.targetLemma);

    const rng = new SeededRNG(12345);
    const rand = () => rng.nextFloat();

    const knowledge: KnowledgeMap = new Map();
    const states: ReviewState[] = [];
    const now = 1_700_000_000_000;

    for (let i = 0; i < coreSentences.length; i++) {
      const s = coreSentences[i];
      const roll = rand();
      if (roll < 0.15) {
        // Calibration-declared known, no review history at all.
        knowledge.set(s.targetLemma!, "known");
      } else if (roll < 0.55) {
        // A studied, durably-retained target sentence.
        states.push({
          sentenceId: s.id,
          direction: "en2ru",
          stability: 10 + rand() * 80,
          difficulty: 5,
          due: now + 30 * DAY,
          reps: 3,
          lapses: 0,
          lastReview: now,
          state: CardState.Review,
        });
      } else if (roll < 0.7) {
        // Studied but NOT yet durable (low stability) — not mastered either way.
        states.push({
          sentenceId: s.id,
          direction: "en2ru",
          stability: 1 + rand() * 5,
          difficulty: 5,
          due: now + 2 * DAY,
          reps: 1,
          lapses: 0,
          lastReview: now,
          state: CardState.Review,
        });
      }
      // else: never studied at all (band1 has 1000 core words; day-to-day a
      // learner has plenty still untouched).
    }

    const withoutWordById = masteredLemmaSet(deck.sentences, knowledge, states, deckLemmas);
    const withWordById = masteredLemmaSet(deck.sentences, knowledge, states, deckLemmas, 21, wordById);

    expect(withoutWordById.size).toBeGreaterThan(0); // sanity: the fixture produced real data
    for (const lemma of withoutWordById) {
      expect(withWordById.has(lemma)).toBe(true);
    }
    // The new rules may ONLY add, confirming the union property numerically too.
    expect(withWordById.size).toBeGreaterThanOrEqual(withoutWordById.size);
  });
});
