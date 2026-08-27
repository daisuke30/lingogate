// Placement service (LINGO-016): wires the pure adaptive-testing engine
// (engine/placement.ts) to IndexedDB + the active course. Mirrors
// state/calibration.ts's shape (which drives the old linear 1000-word triage)
// but for the new short adaptive test. Both write to the same wordKnowledge
// store, so old and new data — and old and new UI, if either is ever
// re-enabled — coexist transparently; the coexistence guarantee comes from
// finalizeAndPersistPlacement never overwriting an already-judged lemma (see
// its doc comment below).

import { DECK, activeCourse, activeFrontLanguage, ensureCourse } from "./service";
import { resolveCourse } from "../content/courses";
import type { Lang } from "../content/courses";
import { getPlacementDone, getTtsSettings, setPlacementDone } from "./settings";
import type { TtsSettings } from "./settings";
import { getAllReviewStates, getAllWordKnowledge, putReviewStates, putWordKnowledge } from "../db/idb";
import { seedKnownReviewStatesForLemmas } from "../engine/calibration";
import type { KnowledgeMap, WordKnowledge } from "../engine/calibration";
import { FSRS } from "../engine/fsrs";
import { finalizePlacement } from "../engine/placement";
import type { PlacementFit, PlacementResponse, RankedWord } from "../engine/placement";
import type { Sentence } from "../engine/content";

const fsrs = new FSRS();

export interface PlacementContext {
  /** Full active-course word list (all bands), ascending rank, one entry per lemma. */
  words: RankedWord[];
  maxRank: number;
  targetLang: Lang;
  frontLang: Lang;
  tts: TtsSettings;
}

function rankedCourseWords(): RankedWord[] {
  return DECK.words
    .filter((w): w is typeof w & { rank: number } => w.rank != null)
    .map((w) => ({ lemma: w.lemma, rank: w.rank }))
    .sort((a, b) => a.rank - b.rank);
}

export async function loadPlacementContext(): Promise<PlacementContext> {
  await ensureCourse();
  const course = resolveCourse(activeCourse());
  const words = rankedCourseWords();
  const maxRank = words.length ? words[words.length - 1].rank : 3000;
  const tts = await getTtsSettings();
  return { words, maxRank, targetLang: course.targetLang, frontLang: activeFrontLanguage(), tts };
}

/** Example sentence teaching a lemma, for the placement card's optional
 * meaning-hint reveal. Band1-only (only band1 has target sentences today) —
 * band2/3 words simply show no hint, same as the legacy calibration flow. */
export function targetSentenceByLemma(): Map<string, Sentence> {
  const out = new Map<string, Sentence>();
  for (const s of DECK.sentences) {
    if (s.targetLemma && !out.has(s.targetLemma)) out.set(s.targetLemma, s);
  }
  return out;
}

/** Has the active course already had a placement run (completed or
 * abandoned-but-finalized)? Drives whether Home still offers the "レベル
 * チェック" CTA. */
export async function isPlacementDone(): Promise<boolean> {
  await ensureCourse();
  return getPlacementDone(activeCourse());
}

async function loadKnowledgeMap(courseId: string): Promise<KnowledgeMap> {
  const rows = await getAllWordKnowledge(courseId);
  const map: KnowledgeMap = new Map();
  for (const r of rows) map.set(r.lemma, r.status);
  return map;
}

export interface FinalizePlacementResult {
  written: number;
}

/**
 * Persist a finished (or deliberately abandoned — "ここで始める" is a valid,
 * expected exit, not an error) placement run:
 *  - judged (directly swiped) words are written as ground truth
 *  - never-asked words below the band are written as assumed known, above it
 *    as assumed unknown; words inside the band are left unwritten (unset)
 *  - assumed-known words get a target-sentence FSRS seed with a 30–120d
 *    dispersed stability (engine/placement.ts's seedStabilityDaysByLemma);
 *    directly-judged known words get the regular fixed 60-day seed
 *  - marks the course's placement as done
 *
 * Coexistence guarantee (§3.1 / Task Contract): an assumed value NEVER
 * overwrites a lemma that already has a real judgement (status != "unset"),
 * whether from the old linear calibration flow or from review feedback — only
 * genuinely never-judged lemmas get the extrapolated assumption. Directly
 * swiped judgements from this run always write (they're ground truth, same as
 * the old calibration flow's unconditional overwrite).
 */
export async function finalizeAndPersistPlacement(
  fit: PlacementFit,
  responses: PlacementResponse[],
): Promise<FinalizePlacementResult> {
  await ensureCourse();
  const courseId = activeCourse();
  const now = Date.now();

  const [existingKnowledge, existingStates] = await Promise.all([
    loadKnowledgeMap(courseId),
    getAllReviewStates(courseId),
  ]);

  const words = rankedCourseWords();
  const writeout = finalizePlacement(fit, responses, words);

  const rows: WordKnowledge[] = [];
  for (const lemma of writeout.judgedKnown) {
    rows.push({ lemma, status: "known", updatedAt: now, source: "placement" });
  }
  for (const lemma of writeout.judgedUnknown) {
    rows.push({ lemma, status: "unknown", updatedAt: now, source: "placement" });
  }
  for (const lemma of writeout.assumedKnown) {
    if ((existingKnowledge.get(lemma) ?? "unset") !== "unset") continue; // never clobber real judgements
    rows.push({ lemma, status: "known", updatedAt: now, source: "placement" });
  }
  for (const lemma of writeout.assumedUnknown) {
    if ((existingKnowledge.get(lemma) ?? "unset") !== "unset") continue;
    rows.push({ lemma, status: "unknown", updatedAt: now, source: "placement" });
  }
  if (rows.length) await putWordKnowledge(rows, courseId);

  // FSRS seed only the lemmas we actually wrote as known (post clobber-guard),
  // dispersed 30-120d for the assumed set, default 60d for directly-judged ones.
  const knownLemmasWritten = new Set(rows.filter((r) => r.status === "known").map((r) => r.lemma));
  const stabilityByLemma = new Map<string, number>();
  for (const [lemma, days] of writeout.seedStabilityDaysByLemma) {
    if (knownLemmasWritten.has(lemma)) stabilityByLemma.set(lemma, days);
  }

  const haveStateIds = new Set(existingStates.map((s) => s.sentenceId));
  const seeds = seedKnownReviewStatesForLemmas(
    DECK.sentences,
    knownLemmasWritten,
    now,
    haveStateIds,
    fsrs,
    stabilityByLemma,
  );
  if (seeds.length) await putReviewStates(seeds, courseId);

  await setPlacementDone(courseId, true);
  return { written: rows.length };
}
