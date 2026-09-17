import { describe, it, expect } from "vitest";
import { ContentStore, isStudyable, sentencePool } from "./content";
import type { Deck, Sentence } from "./content";
import { buildGateSession } from "./session";
import { SeededRNG } from "./rng";
import { CardState, newReviewState } from "./fsrs";
import type { ReviewState } from "./fsrs";

// LINGO-010 follow-up (2026-08-26): build-content.mjs now drops overlong
// sentences from the deck entirely, but a learner's IndexedDB can still hold a
// ReviewState for a sentenceId that predates the rebuild — an "orphan" state
// pointing at a sentence that no longer exists in the bundled deck. These
// tests pin that ContentStore (and buildGateSession, which is built on top of
// it) tolerate orphans: no crash, and the orphaned card never surfaces.

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function sentence(id: string, minRank: number | null = 1, band = 1): Sentence {
  return {
    id,
    ru: `ру ${id}`,
    en: `en ${id}`,
    ja: null,
    kana: null,
    note: null,
    band,
    difficulty: 1,
    source: "generated",
    kind: "sentence",
    // LINGO-050: a core row by default — carrying a targetLemma is exactly what
    // makes a sentence part of the curriculum, and these fixtures stand in for
    // real deck rows. Tests that need a note/lesson import override it to null.
    targetLemma: `lemma-${id}`,
    wordIds: [],
    minRank,
    tokenCount: 2,
  };
}

function makeDeck(sentences: Sentence[]): Deck {
  return { code: "T", name: "t", targetLang: "ru", sourceLang: "en", bands: [1], words: [], sentences };
}

function orphanState(sentenceId: string, due: number): ReviewState {
  return {
    ...newReviewState(sentenceId),
    stability: 3,
    difficulty: 5,
    due,
    reps: 2,
    lapses: 1,
    state: CardState.Review,
    lastReview: due - 5 * DAY,
  };
}

describe("ContentStore tolerates orphan ReviewStates (sentence removed from deck)", () => {
  it("dueReviews skips an orphan (overdue) and still returns the real due card", () => {
    const deck = makeDeck([sentence("s001")]);
    const real = orphanState("s001", NOW - DAY);
    const orphan = orphanState("ghost-long-sentence", NOW - 2 * DAY); // more overdue, but gone from deck
    const store = new ContentStore(deck, [real, orphan]);
    expect(() => store.dueReviews(1, NOW, 10)).not.toThrow();
    const out = store.dueReviews(1, NOW, 10);
    expect(out.map((c) => c.sentence.id)).toEqual(["s001"]);
  });

  it("upcomingReviews skips an orphan (not yet due)", () => {
    const deck = makeDeck([sentence("s001")]);
    const real = orphanState("s001", NOW + DAY);
    const orphan = orphanState("ghost-long-sentence", NOW + DAY);
    const store = new ContentStore(deck, [real, orphan]);
    expect(() => store.upcomingReviews(1, new Set(), 10)).not.toThrow();
    const out = store.upcomingReviews(1, new Set(), 10);
    expect(out.map((c) => c.sentence.id)).toEqual(["s001"]);
  });

  it("bandRetention excludes an orphan's reps/lapses", () => {
    const deck = makeDeck([sentence("s001")]);
    const real = orphanState("s001", NOW - DAY);
    const orphan = orphanState("ghost-long-sentence", NOW - DAY);
    const store = new ContentStore(deck, [real, orphan]);
    const ret = store.bandRetention(1);
    // Only s001's counters (reps 2, lapses 1); the orphan's are not double-counted.
    expect(ret).toEqual({ reps: 2, lapses: 1, reviewCards: 1 });
  });

  it("masteryStats: counts known-judged deck words + stable targets, dedup, deck-scoped", () => {
    const s = sentence("T1");
    s.targetLemma = "мир";
    const deck: Deck = {
      code: "T",
      name: "t",
      targetLang: "ru",
      sourceLang: "en",
      bands: [1],
      words: [
        { id: 1, lemma: "дом", rank: 1, band: 1, pos: "noun" },
        { id: 2, lemma: "мир", rank: 2, band: 1, pos: "noun" },
        { id: 3, lemma: "рука", rank: 3, band: 1, pos: "noun" },
      ],
      sentences: [s],
    };
    const stable = orphanState("T1", NOW + 30 * DAY);
    stable.stability = 30; // ≥ 21d threshold → "мир" mastered via learning
    const knowledge = new Map<string, "known" | "unknown" | "unset">([
      ["дом", "known"],
      ["мир", "known"], // also judged known — must dedup with the stable target
      ["собака", "known"], // not a deck word — must be ignored
    ]);
    const store = new ContentStore(deck, [stable], knowledge);
    const m = store.masteryStats();
    expect(m.masteredCount).toBe(2); // дом + мир (once)
    expect(m.targetWords).toBe(3000);
    expect(m.level).toBe("完全初心者");
  });

  it("buildGateSession never surfaces an orphaned sentenceId and does not crash", () => {
    const deck = makeDeck([sentence("s001"), sentence("s002"), sentence("s003")]);
    const orphan = orphanState("ghost-long-sentence", NOW - DAY); // most overdue of all
    const store = new ContentStore(deck, [orphan]);
    expect(() =>
      buildGateSession(store, { band: 1, now: NOW, size: 3, rng: new SeededRNG(1) }),
    ).not.toThrow();
    const plan = buildGateSession(store, { band: 1, now: NOW, size: 3, rng: new SeededRNG(1) });
    expect(plan.cards.map((c) => c.sentence.id)).not.toContain("ghost-long-sentence");
    expect(plan.cards.length).toBe(3); // filled entirely from real new sentences
  });
});

// LINGO-024: `band` on dueReviews/newSentences/upcomingReviews became a POOL
// CEILING (1..band), not an exact match — the whole point of band promotion
// unlocking band 2 is that band 1 AND band 2 content both become eligible.
describe("ContentStore band-pool ceiling (LINGO-024 band promotion wiring)", () => {
  it("newSentences(1) only offers band-1 sentences; newSentences(2) offers band-1 AND band-2", () => {
    const deck = makeDeck([sentence("b1a", 1, 1), sentence("b1b", 2, 1), sentence("b2a", 1001, 2)]);
    const store = new ContentStore(deck);
    expect(store.newSentences(1, new Set(), 10).map((s) => s.id).sort()).toEqual(["b1a", "b1b"]);
    expect(store.newSentences(2, new Set(), 10).map((s) => s.id).sort()).toEqual(["b1a", "b1b", "b2a"]);
  });

  it("newSentences never offers a band ABOVE the ceiling, even with room to spare", () => {
    const deck = makeDeck([sentence("b1a", 1, 1), sentence("b3a", 1, 3)]);
    const store = new ContentStore(deck);
    expect(store.newSentences(1, new Set(), 10).map((s) => s.id)).toEqual(["b1a"]);
  });

  it("dueReviews(2) surfaces a due band-2 card once band 2 is in the pool, not just band 1's", () => {
    const deck = makeDeck([sentence("b1", 1, 1), sentence("b2", 1, 2)]);
    const state1 = orphanState("b1", NOW - DAY);
    const state2 = orphanState("b2", NOW - DAY);
    const store = new ContentStore(deck, [state1, state2]);
    expect(store.dueReviews(1, NOW, 10).map((c) => c.sentence.id)).toEqual(["b1"]);
    expect(store.dueReviews(2, NOW, 10).map((c) => c.sentence.id).sort()).toEqual(["b1", "b2"]);
  });

  it("upcomingReviews(2) includes band-2 cards once unlocked", () => {
    const deck = makeDeck([sentence("b1", 1, 1), sentence("b2", 1, 2)]);
    const state1 = orphanState("b1", NOW + DAY);
    const state2 = orphanState("b2", NOW + DAY);
    const store = new ContentStore(deck, [state1, state2]);
    expect(store.upcomingReviews(1, new Set(), 10).map((c) => c.sentence.id)).toEqual(["b1"]);
    expect(store.upcomingReviews(2, new Set(), 10).map((c) => c.sentence.id).sort()).toEqual(["b1", "b2"]);
  });

  it("bandVocabStats/bandRetention stay EXACT-band (unaffected by the pool ceiling) — they measure one band's own promotion readiness, not the pool", () => {
    const deck: Deck = {
      code: "T",
      name: "t",
      targetLang: "ru",
      sourceLang: "en",
      bands: [1, 2],
      words: [
        { id: 1, lemma: "a", rank: 1, band: 1, pos: "noun" },
        { id: 2, lemma: "b", rank: 1001, band: 2, pos: "noun" },
      ],
      sentences: [
        { ...sentence("s1", 1, 1), wordIds: [1] },
        { ...sentence("s2", 1001, 2), wordIds: [2] },
      ],
    };
    const store = new ContentStore(deck, [orphanState("s1", NOW - DAY)]);
    const band1 = store.bandVocabStats(1);
    const band2 = store.bandVocabStats(2);
    expect(band1.studied).toBe(1); // s1 has a state
    expect(band2.studied).toBe(0); // s2 does not, even though band 1 < band 2
  });
});

// LINGO-040 (QA-5): the display aggregates. The promotion gate stays
// band-exact (pinned by the test above); these are the figures Home reads, and
// they must only ever move forward — the old band-exact display meant the
// instant a learner was promoted from step 1 to step 2, "words introduced"
// fell from >90% to ~0% and "review success" reverted to "no data yet".
describe("cumulative display aggregates (LINGO-040)", () => {
  function twoBandDeck(): Deck {
    return {
      code: "T",
      name: "t",
      targetLang: "ru",
      sourceLang: "en",
      bands: [1, 2],
      words: [
        { id: 1, lemma: "a", rank: 1, band: 1, pos: "noun" },
        { id: 2, lemma: "b", rank: 2, band: 1, pos: "noun" },
        { id: 3, lemma: "c", rank: 1001, band: 2, pos: "noun" },
      ],
      sentences: [
        { ...sentence("s1", 1, 1), wordIds: [1] },
        { ...sentence("s2", 2, 1), wordIds: [2] },
        { ...sentence("s3", 1001, 2), wordIds: [3] },
      ],
    };
  }

  it("cumulativeVocabStats spans bands 1..band, so a promotion cannot shrink it", () => {
    // A learner who finished band 1 (both its sentences studied) and has just
    // been promoted to band 2.
    const store = new ContentStore(twoBandDeck(), [
      orphanState("s1", NOW - DAY),
      orphanState("s2", NOW - DAY),
    ]);

    // Band-exact, as the promotion gate sees it: band 2 looks untouched.
    expect(store.bandVocabStats(2)).toEqual({ total: 1, coverable: 1, studied: 0 });

    // Cumulative, as the learner sees it: the two band-1 words are still there.
    const shown = store.cumulativeVocabStats(2);
    expect(shown.total).toBe(3);
    expect(shown.studied).toBe(2);
    // Never a regression across the promotion boundary.
    expect(shown.studied).toBeGreaterThanOrEqual(store.cumulativeVocabStats(1).studied);
  });

  it("cumulativeRetention keeps band-1 review history visible from band 2", () => {
    const store = new ContentStore(twoBandDeck(), [orphanState("s1", NOW - DAY)]);
    // Band-exact band 2: nothing scheduled yet -> "no data yet" on the old UI.
    expect(store.bandRetention(2)).toEqual({ reps: 0, lapses: 0, reviewCards: 0 });
    // Cumulative: band 1's counters survive the promotion.
    expect(store.cumulativeRetention(2)).toEqual({ reps: 2, lapses: 1, reviewCards: 1 });
  });
});

// LINGO-040 (QA-4): a card graded Again moves to Relearning, and the old
// `state !== Review` filter dropped it from the denominator — so the reported
// success rate was systematically inflated, and a fresh lapse could briefly
// RAISE it. Relearning cards now count; Learning/New still don't (a card in
// its first-exposure steps has never been recalled at an interval, so it says
// nothing about retention either way).
describe("bandRetention counts Relearning cards (LINGO-040 / QA-4)", () => {
  function stateIn(sentenceId: string, state: CardState, reps: number, lapses: number): ReviewState {
    return { ...orphanState(sentenceId, NOW - DAY), state, reps, lapses };
  }

  const deck = () => makeDeck([sentence("ok"), sentence("failed"), sentence("fresh")]);

  it("includes a just-lapsed card instead of hiding it", () => {
    const store = new ContentStore(deck(), [
      stateIn("ok", CardState.Review, 9, 0),
      stateIn("failed", CardState.Relearning, 1, 3),
    ]);
    expect(store.bandRetention(1)).toEqual({ reps: 10, lapses: 3, reviewCards: 2 });
  });

  it("a lapse can no longer improve the reported rate", () => {
    const before = new ContentStore(deck(), [
      stateIn("ok", CardState.Review, 9, 0),
      stateIn("failed", CardState.Review, 4, 1),
    ]).bandRetention(1);
    // Same learner a moment later: "failed" was graded Again — one more lapse,
    // and FSRS moved it to Relearning.
    const after = new ContentStore(deck(), [
      stateIn("ok", CardState.Review, 9, 0),
      stateIn("failed", CardState.Relearning, 4, 2),
    ]).bandRetention(1);
    const rate = (r: { reps: number; lapses: number }) => r.reps / (r.reps + r.lapses);
    expect(rate(after)).toBeLessThan(rate(before));
  });

  it("still ignores New and Learning cards", () => {
    const store = new ContentStore(deck(), [
      stateIn("ok", CardState.Review, 5, 1),
      stateIn("fresh", CardState.Learning, 2, 0),
      stateIn("failed", CardState.New, 0, 0),
    ]);
    expect(store.bandRetention(1)).toEqual({ reps: 5, lapses: 1, reviewCards: 1 });
  });
});

// --- LINGO-050: pool purification -------------------------------------------
// The first thousand words had become a mixture of the designed curriculum and
// whatever was in Katsuta's August notebook import. These pin the separation.

function poolDeck(): Deck {
  const core = { ...sentence("core1", 1, 1), targetLemma: "дом", kind: "sentence" as const };
  const core2 = { ...sentence("core2", 2, 1), targetLemma: "рука", kind: "sentence" as const };
  // A note/lesson import: a real sentence, but with no target lemma.
  const note = { ...sentence("note1", 3, 1), targetLemma: null, kind: "sentence" as const };
  // A bare vocabulary card: no sentence at all.
  const word = { ...sentence("word1", 4, 1), targetLemma: null, kind: "word" as const };
  return { code: "T", name: "t", targetLang: "ru", sourceLang: "en", bands: [1], words: [], sentences: [core, core2, note, word] };
}

describe("sentencePool / isStudyable", () => {
  it("classifies by target lemma and kind", () => {
    const [core, , note, word] = poolDeck().sentences;
    expect(sentencePool(core)).toBe("core");
    expect(sentencePool(note)).toBe("notes");
    expect(sentencePool(word)).toBe("word");
    expect(isStudyable(core)).toBe(true);
    expect(isStudyable(note)).toBe(true);
    expect(isStudyable(word)).toBe(false); // never quizzed, in any lane
  });
});

describe("new cards come only from the core curriculum (LINGO-050)", () => {
  it("offers core sentences and never notes or word cards", () => {
    const store = new ContentStore(poolDeck());
    const ids = store.newSentences(1, new Set(), 10).map((s) => s.id);
    expect(ids).toEqual(["core1", "core2"]);
  });
});

describe("existing review history is never discarded (LINGO-050)", () => {
  it("keeps reviewing a note card the learner already started", () => {
    const store = new ContentStore(poolDeck(), [orphanState("note1", NOW - DAY)]);
    expect(store.dueReviews(1, NOW, 10).map((c) => c.sentence.id)).toEqual(["note1"]);
  });

  it("but never surfaces that card as new again", () => {
    const store = new ContentStore(poolDeck(), [orphanState("note1", NOW - DAY)]);
    expect(store.newSentences(1, new Set(), 10).map((s) => s.id)).not.toContain("note1");
  });

  it("drops a bare word card from reviews even if one somehow has state", () => {
    const store = new ContentStore(poolDeck(), [orphanState("word1", NOW - DAY)]);
    expect(store.dueReviews(1, NOW, 10)).toEqual([]);
    expect(store.upcomingReviews(1, new Set(), 10)).toEqual([]);
  });
});

describe("マイノート lane (LINGO-050)", () => {
  it("contains only note/lesson sentences", () => {
    const store = new ContentStore(poolDeck());
    expect(store.notesSession(NOW, 10).map((s) => s.id)).toEqual(["note1"]);
  });

  it("puts overdue notes before unseen ones", () => {
    const deck = poolDeck();
    deck.sentences.push({ ...sentence("note2", 9, 1), targetLemma: null, kind: "sentence" });
    const store = new ContentStore(deck, [orphanState("note2", NOW - DAY)]);
    expect(store.notesSession(NOW, 10).map((s) => s.id)).toEqual(["note2", "note1"]);
  });

  it("reports how much material the lane has, so an empty lane can hide itself", () => {
    expect(new ContentStore(poolDeck()).notesCount()).toBe(1);
    const coreOnly = poolDeck();
    coreOnly.sentences = coreOnly.sentences.filter((s) => s.targetLemma);
    expect(new ContentStore(coreOnly).notesCount()).toBe(0);
  });
});
