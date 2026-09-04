// Pet engine (LINGO-029) — the honest-gamification growth model behind the
// 育成 tab. Design: ai-org/Ideas/20260903-lingogate-pet-design.md (§1 core
// mapping, §2 lifecycle, §3 evolution branches, §6 data).
//
// Everything here is a PURE function with time injected (never reads the clock
// itself) so the whole lifecycle — decay, care scoring, all 16 evolution
// branches, generation turnover — is deterministically testable. No IndexedDB,
// no React, no ContentStore import: the overdue-review count that drives "poop"
// is INJECTED by the state layer (state/pet.ts), per the design's "算出関数は
// 依存注入" rule. speciesId strings are the contract with the art package
// (pet/art/index.ts, PET_SPECIES) — this module never imports art, it only
// emits the agreed ids.
//
// The mapping (design §1):
//   餌 (food)        = earned per graded card: new card +2, review +1.
//   掃除P (cleanPts) = earned per 3 reviews (+1). Spent by 掃除する (applyClean).
//   満腹度 (hunger)  = fullness 0..100, decays 100→0 linearly over 24h.
//   うんこ (poop)    = a real 0..5 STOCK on PetState (poopCount), not a live
//                      function of overdue reviews. It spawns over time — the
//                      interval between spawns shrinks continuously as the
//                      overdue-review queue grows — and 掃除する deletes
//                      exactly one from the stock immediately. (v2, 2026-09-05
//                      UXフィードバック: the original "poop = clamp(overdue)"
//                      derivation meant 掃除する never visibly did anything,
//                      since spending 掃除P didn't change `overdue`. See
//                      poopIntervalMs/advancePoop below — ai-org/Ideas/
//                      20260903-lingogate-pet-design.md §1 updated to match.)
//   ケアスコア        = daily fedRatio × cleanRatio × studiedFlag, averaged over
//                      a stage; picks the evolution branch (§3). cleanRatio is
//                      now "fraction of the day NOT spent with poopCount > 0"
//                      (time-weighted), not a per-visit sample average.

// MARK: species & stages

/** The 16 collectible species (design §3). Ids are the art contract
 * (pet/art/index.ts PET_SPECIES). Egg is a stage, not a species. */
// NOTE: these ids MUST match pet/art/catalog.ts (LINGO-028) exactly — the art
// catalog is the source of truth the UI looks up. Four ids differ from the
// design's literal Japanese-lineage kebab (cutie/grimy/mellow/mech-god).
export const SPECIES_IDS = [
  "mochi", // 幼年期: モチ系（全系統共通）
  "cutie", // 成長期: キュート系（良/並）
  "grimy", // 成長期: ヨゴレ系（怠）
  "hero", // 成熟期: 勇者系（良×N）
  "sage", // 成熟期: 賢者系（良×R）
  "rascal", // 成熟期: わんぱく系（並×N）
  "mellow", // 成熟期: まったり系（並×R）
  "mud", // 成熟期: ドロ系（怠×R）
  "spiky", // 成熟期: イガイガ系（怠×N）
  "angel", // 成熟期: 天使系（レア・連続学習7日）
  "knight", // 完全体: 騎士系（良）
  "beast-king", // 完全体: 獣王系（並）
  "berserk", // 完全体: 暴走系（怠）
  "holy-dragon", // 究極体: 聖竜系（良）
  "mech-god", // 究極体: 機神系（並）
  "demon-lord", // 究極体: 魔王系（怠のまま維持・隠し）
] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];

export type PetStage = "egg" | "baby" | "child" | "adult" | "perfect" | "ultimate";

/** Living stages in order (egg is the pre-hatch state, not in this progression
 * — a fresh pet is `egg` until the first tick hatches it to `baby`). */
export const STAGE_ORDER: PetStage[] = ["baby", "child", "adult", "perfect", "ultimate"];

// MARK: tunables (all named so the design's numbers live in one place)

export const DAY_MS = 24 * 60 * 60 * 1000;
/** 満腹度 falls 100→0 over exactly this window (design §1: "24hで満腹→空腹"). */
export const HUNGER_DECAY_MS = DAY_MS;
/** One 餌 restores this much 満腹度 (≈3 feeds fill an empty belly). */
export const FEED_RESTORE = 34;
/** Poop stock tops out at this many (design §1: "上限5個表示"). */
export const MAX_POOP = 5;

// うんこ発生間隔 (design §1 v2, 2026-09-05 UXフィードバック反映): 期限切れ復習数
// が多いほど頻繁に1個発生する。連続関数でよい、と指定されたので指数減衰を採用し、
// 勝田の例示3点にフィットさせた: overdue 0件→24hに1個 / 10件→8hに1個 /
// 30件以上→約4hに1個（漸近下限、明示クランプ不要なほど収束が速い）。
//   interval(overdue) = MIN + (MAX-MIN) * exp(-overdue / TAU)
// TAU は overdue=10→8h の点から逆算する（POOP_INTERVAL_TAU の式を参照）。
/** overdue=0 のときの発生間隔（24h に1個）。 */
export const POOP_INTERVAL_MAX_MS = 24 * 60 * 60 * 1000;
/** overdue→∞ で漸近する発生間隔の下限（4h に1個）。 */
export const POOP_INTERVAL_MIN_MS = 4 * 60 * 60 * 1000;
const POOP_INTERVAL_ANCHOR_OVERDUE = 10;
const POOP_INTERVAL_ANCHOR_MS = 8 * 60 * 60 * 1000; // overdue=10 → 8h の実例点
const POOP_INTERVAL_TAU =
  -POOP_INTERVAL_ANCHOR_OVERDUE /
  Math.log(
    (POOP_INTERVAL_ANCHOR_MS - POOP_INTERVAL_MIN_MS) /
      (POOP_INTERVAL_MAX_MS - POOP_INTERVAL_MIN_MS),
  );

/** ms between poop spawns at a given overdue-review count — continuous,
 * monotonically decreasing, asymptotic to POOP_INTERVAL_MIN_MS. Pure function
 * of the CURRENT overdue count; advancePoop() treats it as roughly constant
 * across the elapsed span since the last accrual checkpoint (accurate enough
 * given the app is opened far more often than the interval floor of 4h). */
export function poopIntervalMs(overdueCount: number): number {
  const o = Math.max(0, overdueCount);
  return (
    POOP_INTERVAL_MIN_MS +
    (POOP_INTERVAL_MAX_MS - POOP_INTERVAL_MIN_MS) * Math.exp(-o / POOP_INTERVAL_TAU)
  );
}

/** 餌 per graded card (design §1). */
export const FOOD_PER_NEW = 2;
export const FOOD_PER_REVIEW = 1;
/** Reviews needed per 掃除P (design §1: "3枚=1掃除"). */
export const REVIEWS_PER_CLEAN_POINT = 3;
/** No study for this many consecutive calendar days → early 旅立ち (design §2). */
export const ABANDON_DAYS = 3;
/** Consecutive study-day streak that unlocks 天使系 (design §3: "連続学習7日"). */
export const ANGEL_STREAK = 7;

/** Care-score tiers (design §3): 良 ≥0.8 / 並 0.4–0.8 / 怠 <0.4. */
export const CARE_GOOD = 0.8;
export const CARE_OK = 0.4;
export type CareTier = "good" | "ok" | "neglect"; // 良 / 並 / 怠

/** Age (in real-time days) at which each stage BEGINS, and the departure age.
 * Stages advance on real elapsed time; the daily study habit (streak, abandon)
 * is tracked on calendar days — see design §2 ("0-1日 … 12日目で旅立ち"). */
export const STAGE_START_DAYS: Record<"baby" | "child" | "adult" | "perfect" | "ultimate", number> =
  { baby: 0, child: 1, adult: 3, perfect: 6, ultimate: 9 };
export const DEPART_DAYS = 12;

// MARK: state shapes

export interface PetSettings {
  /** Off (default): early exit is framed as 旅立ち. On: 死亡 framing (design §2). */
  hardMode: boolean;
}

/** One calendar day of care history. dailyCareScore = fedRatio × cleanRatio ×
 * studiedFlag (design §1). `studied` is set by a committed learning session
 * that day. fedRatio is still the MEAN of per-visit satiety samples (tick()
 * samples once per screen view); cleanRatio (v2, 2026-09-05) is now TIME-
 * WEIGHTED — trackedMs/dirtyMs accumulate real elapsed ms as advancePoop()
 * catches the poop stock up, so "放置していた時間割合" is measured directly
 * instead of sampled per visit. */
export interface CareDay {
  date: string; // local YYYY-MM-DD
  stage: PetStage; // stage the pet was in when this day was first recorded
  studied: boolean;
  newCount: number; // new cards graded that day (→ learning tendency N/R)
  reviewCount: number; // review cards graded that day
  fedSum: number; // Σ satiety-fraction samples (0..1)
  fedN: number;
  /** ms of this day covered by an accrual pass (tick() catch-up spans). */
  trackedMs: number;
  /** Of trackedMs, how many ms had poopCount > 0 (the pet was "dirty"). */
  dirtyMs: number;
}

export interface PetState {
  generation: number; // 1-based; increments each 旅立ち → new egg
  speciesId: SpeciesId; // current form (mochi while egg/baby)
  stage: PetStage;
  bornAt: number;
  /** 満腹度/fullness (0..100, 100 = full) captured at `lastFedAt`; decays to 0
   * over HUNGER_DECAY_MS. Read the live value with satietyAt(). */
  hunger: number;
  lastFedAt: number;
  foodCount: number; // 所持餌
  cleanPoints: number; // 所持掃除P
  /** うんこ在庫 (v2, 2026-09-05): 0..MAX_POOP. A real stock — spawns via
   * advancePoop()'s time-based accrual, deleted 1-for-1 by applyClean(). */
  poopCount: number;
  /** Accrual checkpoint: advancePoop() has fully accounted for real elapsed
   * time up to this timestamp (both stock growth and dirty-time bookkeeping
   * in careLog). Only tick() ever advances it. */
  poopAccruedAt: number;
  careLog: CareDay[];
  /** Global consecutive study-day streak; carried across generations so the
   * 天使系 7-day bonus reflects the LEARNER, not one pet. */
  studyStreak: number;
  lastStudyDate: string | null; // local YYYY-MM-DD of the last studied day
  settings: PetSettings;
}

/** 図鑑 entry — first time a species was discovered. */
export interface PetCollectionEntry {
  speciesId: SpeciesId;
  generation: number;
  reachedAt: number;
}
export type PetCollection = PetCollectionEntry[];

export interface PetEarnings {
  food: number;
  cleanPoints: number;
}

export type PetEventType = "hatch" | "evolve" | "depart";
export type DepartReason = "natural" | "early" | "perfect-stall";
export interface PetEvent {
  type: PetEventType;
  /** Species reached (hatch/evolve) or departed as (depart). */
  speciesId: SpeciesId;
  stage: PetStage; // stage entered (hatch/evolve) or departed from (depart)
  generation: number;
  at: number;
  reason?: DepartReason; // depart only
}

export interface TickResult {
  pet: PetState;
  events: PetEvent[];
}

// MARK: date helpers (local-calendar, DST-safe via noon anchoring)

export function localDateStr(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseLocalDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime(); // noon anchor
}

/** Whole calendar days from date `a` to date `b` (both YYYY-MM-DD). */
export function calendarDayDiff(a: string, b: string): number {
  return Math.round((parseLocalDate(b) - parseLocalDate(a)) / DAY_MS);
}

// MARK: core mappings (design §1)

/** Live 満腹度 at `now` (linear 100→0 decay over 24h, clamped 0..100). */
export function satietyAt(pet: PetState, now: number): number {
  const elapsed = Math.max(0, now - pet.lastFedAt);
  const v = pet.hunger - (100 * elapsed) / HUNGER_DECAY_MS;
  return Math.max(0, Math.min(100, v));
}

// MARK: poop accrual (design §1 v2, 2026-09-05 — stock model)

function nextLocalMidnight(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

/** Split [startMs, endMs) into per-local-calendar-date ms buckets — used to
 * attribute a (possibly multi-day, offline-catch-up) accrual span to the
 * right CareDay rows. Loop-guarded so a very long absence still terminates
 * quickly (the pet would have long since departed by then anyway). */
function splitByLocalDate(startMs: number, endMs: number): Map<string, number> {
  const out = new Map<string, number>();
  if (endMs <= startMs) return out;
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard < 2000) {
    guard++;
    const boundary = Math.min(endMs, nextLocalMidnight(cursor));
    const date = localDateStr(cursor);
    out.set(date, (out.get(date) ?? 0) + (boundary - cursor));
    cursor = boundary;
  }
  return out;
}

interface PoopAdvance {
  poopCount: number;
  poopAccruedAt: number;
  trackedByDate: Map<string, number>;
  dirtyByDate: Map<string, number>;
}

/** Catch the poop stock up to `now`: how many new poops spawned since
 * `pet.poopAccruedAt` (at the CURRENT overdueCount's rate — see
 * poopIntervalMs), and how much of that elapsed span was "dirty" (stock > 0)
 * for the time-weighted cleanliness score. While the stock is at MAX_POOP no
 * further credit is banked — the accrual checkpoint resets to `now` instead —
 * so cleaning down from a full stock doesn't cause an unearned instant
 * refill from backlog. */
function advancePoop(pet: PetState, now: number, overdueCount: number): PoopAdvance {
  const from = Math.min(pet.poopAccruedAt, now); // guard a clock that moved backward
  const trackedByDate = splitByLocalDate(from, now);
  const elapsed = now - from;
  if (elapsed <= 0) {
    return { poopCount: pet.poopCount, poopAccruedAt: pet.poopAccruedAt, trackedByDate, dirtyByDate: new Map() };
  }

  const interval = poopIntervalMs(overdueCount);
  const oldPoop = pet.poopCount;
  let newPoops = 0;
  let dirtyFrom: number | null = null; // instant within [from, now) the span turned dirty

  if (oldPoop > 0) {
    dirtyFrom = from; // already dirty for the whole span
    if (oldPoop < MAX_POOP) newPoops = Math.floor(elapsed / interval);
  } else {
    newPoops = Math.floor(elapsed / interval);
    if (newPoops > 0) dirtyFrom = from + interval; // first spawn instant
  }

  const poopCount = Math.min(MAX_POOP, oldPoop + newPoops);
  const poopAccruedAt = poopCount >= MAX_POOP ? now : from + newPoops * interval;
  const dirtyByDate = dirtyFrom == null ? new Map<string, number>() : splitByLocalDate(dirtyFrom, now);

  return { poopCount, poopAccruedAt, trackedByDate, dirtyByDate };
}

/** Merge a (possibly multi-day) tracked/dirty span into careLog — creating any
 * missing day rows (tagged with the CURRENT stage, same simplification the
 * fed sampling already makes: no per-historical-day stage tracking). */
function mergeCareMs(
  careLog: CareDay[],
  stage: PetStage,
  tracked: Map<string, number>,
  dirty: Map<string, number>,
): CareDay[] {
  if (tracked.size === 0) return careLog;
  const log = careLog.slice();
  for (const [date, ms] of tracked) {
    let i = log.findIndex((d) => d.date === date);
    if (i < 0) {
      log.push({ date, stage, studied: false, newCount: 0, reviewCount: 0, fedSum: 0, fedN: 0, trackedMs: 0, dirtyMs: 0 });
      i = log.length - 1;
    }
    log[i] = {
      ...log[i],
      trackedMs: log[i].trackedMs + ms,
      dirtyMs: log[i].dirtyMs + (dirty.get(date) ?? 0),
    };
  }
  return log;
}

/** 餌/掃除P earned from a committed session. PURE — the state layer adds these
 * to the pet (see applySession). This is LINGO-031's "onSessionCommitted"
 * earnings contract. */
export function onSessionCommitted(input: { newCount: number; reviewCount: number }): PetEarnings {
  const newCount = Math.max(0, Math.floor(input.newCount));
  const reviewCount = Math.max(0, Math.floor(input.reviewCount));
  return {
    food: newCount * FOOD_PER_NEW + reviewCount * FOOD_PER_REVIEW,
    cleanPoints: Math.floor(reviewCount / REVIEWS_PER_CLEAN_POINT),
  };
}

// MARK: care scoring (design §1 & §3)

export function dailyCareScore(day: CareDay): number {
  const fedRatio = day.fedN > 0 ? day.fedSum / day.fedN : 0;
  // v2 (2026-09-05): cleanRatio = fraction of the day's TRACKED time that was
  // NOT dirty (poopCount > 0) — "放置していた時間割合" per the UX fix, not a
  // per-visit sample average. Days with no tracked ms (defensive: covers
  // pre-v2 persisted rows missing these fields too) score as neglected (0),
  // same treatment expectedStageDays already gives to unopened days.
  const trackedMs = day.trackedMs ?? 0;
  const dirtyMs = day.dirtyMs ?? 0;
  const cleanRatio = trackedMs > 0 ? Math.max(0, 1 - dirtyMs / trackedMs) : 0;
  return fedRatio * cleanRatio * (day.studied ? 1 : 0);
}

/** How many calendar days a stage is expected to last (its share of the 12-day
 * life). Used as the divisor so days you never opened the app count as neglect
 * (score 0) rather than being silently skipped. */
export function expectedStageDays(stage: PetStage): number {
  switch (stage) {
    case "baby":
      return STAGE_START_DAYS.child - STAGE_START_DAYS.baby; // 1
    case "child":
      return STAGE_START_DAYS.adult - STAGE_START_DAYS.child; // 2
    case "adult":
      return STAGE_START_DAYS.perfect - STAGE_START_DAYS.adult; // 3
    case "perfect":
      return STAGE_START_DAYS.ultimate - STAGE_START_DAYS.perfect; // 3
    case "ultimate":
      return DEPART_DAYS - STAGE_START_DAYS.ultimate; // 3
    default:
      return 1;
  }
}

/** Mean daily care score across the days spent in `stage`. Missing days (app
 * never opened) drag the average toward 0 via the expected-days divisor. */
export function stageCareAvg(careLog: CareDay[], stage: PetStage): number {
  const days = careLog.filter((d) => d.stage === stage);
  const sum = days.reduce((a, d) => a + dailyCareScore(d), 0);
  const denom = Math.max(expectedStageDays(stage), days.length);
  return denom > 0 ? sum / denom : 0;
}

export function careTier(score: number): CareTier {
  if (score >= CARE_GOOD) return "good";
  if (score >= CARE_OK) return "ok";
  return "neglect";
}

/** Learning tendency over a stage: N (新規多め) if new ≥ review, else R (復習多め). */
export function learningTendency(careLog: CareDay[], stage: PetStage): "N" | "R" {
  const days = careLog.filter((d) => d.stage === stage);
  const newSum = days.reduce((a, d) => a + d.newCount, 0);
  const reviewSum = days.reduce((a, d) => a + d.reviewCount, 0);
  return newSum >= reviewSum ? "N" : "R";
}

/** Did the learner study on every expected day of `stage`? Gates the hidden
 * 魔王系 path ("怠のまま完全体を維持した" — neglected feeding/cleaning yet kept
 * studying, so the pet survived the whole stage). */
export function studiedEveryDayInStage(careLog: CareDay[], stage: PetStage): boolean {
  const studied = careLog.filter((d) => d.stage === stage && d.studied).length;
  return studied >= expectedStageDays(stage);
}

// MARK: evolution branch table (design §3 — 1:1 with the branch tests)

export interface BranchInput {
  toStage: PetStage; // stage being entered
  priorCare: number; // care-score avg of the stage just completed
  tendency: "N" | "R"; // learning tendency of that stage
  studyStreak: number; // global consecutive study days at the transition
  priorStudiedEveryDay: boolean; // for the hidden 魔王系 gate
}

/** The species (or "DEPART") produced by entering `toStage`. This is the whole
 * of design §3's branch table; the tests exercise every row 1:1. Returning
 * "DEPART" models 完全体止まりで旅立ち (a 怠 pet can't reach a normal 究極体). */
export function branchSpecies(input: BranchInput): SpeciesId | "DEPART" {
  const tier = careTier(input.priorCare);
  switch (input.toStage) {
    // 幼年期: モチ系（全系統共通）
    case "baby":
      return "mochi";
    // 成長期: 良/並→キュート系、怠→ヨゴレ系
    case "child":
      return tier === "neglect" ? "grimy" : "cutie";
    // 成熟期: 良×N→勇者, 良×R→賢者, 並×N→わんぱく, 並×R→まったり,
    //         怠×N→イガイガ, 怠×R→ドロ, ＋連続学習7日ボーナスで天使（レア）
    case "adult":
      if (tier === "good" && input.studyStreak >= ANGEL_STREAK) return "angel";
      if (tier === "good") return input.tendency === "N" ? "hero" : "sage";
      if (tier === "ok") return input.tendency === "N" ? "rascal" : "mellow";
      return input.tendency === "N" ? "spiky" : "mud";
    // 完全体: 良→騎士, 並→獣王, 怠→暴走
    case "perfect":
      if (tier === "good") return "knight";
      if (tier === "ok") return "beast-king";
      return "berserk";
    // 究極体: 良→聖竜, 並→機神, 怠→（維持=魔王・隠し / それ以外=旅立ち）
    case "ultimate":
      if (tier === "good") return "holy-dragon";
      if (tier === "ok") return "mech-god";
      return input.priorStudiedEveryDay ? "demon-lord" : "DEPART";
    default:
      return "DEPART";
  }
}

// MARK: lifecycle

export function stageForAgeDays(ageDays: number): PetStage | "depart" {
  if (ageDays >= DEPART_DAYS) return "depart";
  if (ageDays >= STAGE_START_DAYS.ultimate) return "ultimate";
  if (ageDays >= STAGE_START_DAYS.perfect) return "perfect";
  if (ageDays >= STAGE_START_DAYS.adult) return "adult";
  if (ageDays >= STAGE_START_DAYS.child) return "child";
  return "baby";
}

/** Real-time age in fractional days. */
export function ageDays(pet: PetState, now: number): number {
  return Math.max(0, now - pet.bornAt) / DAY_MS;
}

/** Consecutive calendar days with no study, up to `now` (design §2 abandon check). */
function daysSinceStudy(pet: PetState, now: number): number {
  const today = localDateStr(now);
  const from = pet.lastStudyDate ?? localDateStr(pet.bornAt);
  return Math.max(0, calendarDayDiff(from, today));
}

export function newPet(
  generation: number,
  now: number,
  carry?: { studyStreak?: number; lastStudyDate?: string | null; settings?: PetSettings },
): PetState {
  return {
    generation,
    speciesId: "mochi",
    stage: "egg",
    bornAt: now,
    hunger: 100,
    lastFedAt: now,
    foodCount: 0,
    cleanPoints: 0,
    poopCount: 0,
    poopAccruedAt: now,
    careLog: [],
    studyStreak: carry?.studyStreak ?? 0,
    lastStudyDate: carry?.lastStudyDate ?? null,
    settings: carry?.settings ?? { hardMode: false },
  };
}

// MARK: migration (v2, 2026-09-05 poop-stock overhaul)

/** A pet persisted before poopCount/poopAccruedAt existed — every other field
 * is guaranteed present (it round-tripped through IndexedDB as a real
 * PetState at the time), only these two are possibly missing. */
export type LegacyPetState = Omit<PetState, "poopCount" | "poopAccruedAt"> & {
  poopCount?: number;
  poopAccruedAt?: number;
};

/** Backfill poopCount/poopAccruedAt on a pet persisted before this field
 * existed. Additive-only — every other field passes through untouched.
 * Idempotent: an already-migrated pet passes straight through unchanged.
 * `overdueCountForMigration` seeds the initial stock from whatever overdue
 * count the caller currently has, clamped 0..MAX_POOP (the coordinator's
 * migration spec: "現在のoverdueから算出した値をクランプ") — the same clamp
 * the old (removed) derived poopCount(overdueCount) used to apply. Pulled out
 * as a pure function (no IndexedDB) so it's unit-testable — mirrors db/idb.ts's
 * ensureStores() extraction for the same reason. */
export function migrateLegacyPet(
  existing: LegacyPetState,
  now: number,
  overdueCountForMigration: number,
): PetState {
  if (typeof existing.poopCount === "number" && typeof existing.poopAccruedAt === "number") {
    return existing as PetState;
  }
  return {
    ...existing,
    poopCount: Math.min(MAX_POOP, Math.max(0, Math.floor(overdueCountForMigration))),
    poopAccruedAt: now,
  };
}

/** Get or create today's CareDay (immutably); returns the log copy and index. */
function ensureToday(careLog: CareDay[], now: number, stage: PetStage): { log: CareDay[]; i: number } {
  const date = localDateStr(now);
  const i = careLog.findIndex((d) => d.date === date);
  if (i >= 0) return { log: careLog.slice(), i };
  const log = careLog.slice();
  log.push({ date, stage, studied: false, newCount: 0, reviewCount: 0, fedSum: 0, fedN: 0, trackedMs: 0, dirtyMs: 0 });
  return { log, i: log.length - 1 };
}

// MARK: actions (all pure: pet in → new pet out)

/** 餌をあげる: consume one 餌, restore 満腹度. No-op with no food. */
export function applyFeed(pet: PetState, now: number): PetState {
  if (pet.foodCount <= 0) return pet;
  const restored = Math.min(100, satietyAt(pet, now) + FEED_RESTORE);
  return { ...pet, hunger: restored, lastFedAt: now, foodCount: pet.foodCount - 1 };
}

/** 掃除する: 掃除P 1個 = うんこ在庫1個を確実に削除（design §1 v2, 2026-09-05）。
 * No-op with no clean points or nothing to clean. Does NOT touch
 * poopAccruedAt — the accrual clock is exclusively tick()'s concern; a clean
 * happening mid-visit is a negligible fraction of the (≥4h floor) spawn
 * interval, so the next tick's catch-up still lands within a few minutes of
 * correct. */
export function applyClean(pet: PetState): PetState {
  if (pet.cleanPoints <= 0 || pet.poopCount <= 0) return pet;
  return { ...pet, cleanPoints: pet.cleanPoints - 1, poopCount: pet.poopCount - 1 };
}

/** Apply a committed learning session: add earnings, mark today studied, log
 * new/review counts, and advance the study streak. Returns the new pet plus the
 * earnings (so the summary UI, LINGO-031, can show "餌+N・掃除+N"). */
export function applySession(
  pet: PetState,
  input: { newCount: number; reviewCount: number },
  now: number,
): { pet: PetState; earned: PetEarnings } {
  const earned = onSessionCommitted(input);
  const stage = pet.stage === "egg" ? "baby" : pet.stage;
  const { log, i } = ensureToday(pet.careLog, now, stage);
  const newCount = Math.max(0, Math.floor(input.newCount));
  const reviewCount = Math.max(0, Math.floor(input.reviewCount));
  log[i] = {
    ...log[i],
    studied: true,
    newCount: log[i].newCount + newCount,
    reviewCount: log[i].reviewCount + reviewCount,
  };

  const today = localDateStr(now);
  let streak = pet.studyStreak;
  if (pet.lastStudyDate === today) {
    // already counted today
    streak = Math.max(1, streak);
  } else if (pet.lastStudyDate != null && calendarDayDiff(pet.lastStudyDate, today) === 1) {
    streak = streak + 1;
  } else {
    streak = 1;
  }

  return {
    pet: {
      ...pet,
      careLog: log,
      foodCount: pet.foodCount + earned.food,
      cleanPoints: pet.cleanPoints + earned.cleanPoints,
      studyStreak: streak,
      lastStudyDate: today,
    },
    earned,
  };
}

// MARK: tick — the whole progression, called on 育成-screen display

/** Advance the pet to `now`: hatch the egg, sample today's care, then handle
 * (in priority order) early 旅立ち (3-day abandon), stage evolutions with §3
 * branching, and natural 旅立ち at day 12. On any 旅立ち the returned `pet` is
 * the NEXT generation's fresh egg; `events` reports what happened (the state
 * layer records discoveries into the 図鑑 from these). */
export function tick(pet: PetState, ctx: { now: number; overdueCount: number }): TickResult {
  const { now, overdueCount } = ctx;
  const events: PetEvent[] = [];
  let p: PetState = pet;

  // 1. Hatch: a fresh egg becomes its age-appropriate living stage (→ mochi).
  if (p.stage === "egg") {
    const hatchStage = stageForAgeDays(ageDays(p, now));
    const stage: PetStage = hatchStage === "depart" ? "ultimate" : hatchStage;
    p = { ...p, stage: stage === "egg" ? "baby" : stage, speciesId: "mochi" };
    // Record only the baby form as the hatch; higher stages (if the app was
    // closed for days) are emitted as evolutions in step 3.
    if (STAGE_ORDER.indexOf(p.stage) >= 0) {
      events.push({ type: "hatch", speciesId: "mochi", stage: "baby", generation: p.generation, at: now });
      // Force stepping to start from baby so intermediate branches run.
      p = { ...p, stage: "baby", speciesId: "mochi" };
    }
  }

  // 2. Catch the poop stock up to `now` (design §1 v2) — spawns since the last
  // accrual checkpoint at the current overdueCount's rate, plus the
  // time-weighted dirty/tracked ms this contributes to the care log.
  {
    const adv = advancePoop(p, now, overdueCount);
    p = {
      ...p,
      poopCount: adv.poopCount,
      poopAccruedAt: adv.poopAccruedAt,
      careLog: mergeCareMs(p.careLog, p.stage, adv.trackedByDate, adv.dirtyByDate),
    };
  }

  // 3. Sample today's satiety into the care log (once per visit — unchanged).
  {
    const { log, i } = ensureToday(p.careLog, now, p.stage);
    log[i] = {
      ...log[i],
      fedSum: log[i].fedSum + satietyAt(p, now) / 100,
      fedN: log[i].fedN + 1,
    };
    p = { ...p, careLog: log };
  }

  // 4. Early 旅立ち — 3+ consecutive calendar days without study (design §2).
  if (daysSinceStudy(p, now) >= ABANDON_DAYS) {
    return depart(p, now, "early", events);
  }

  // 5. Evolutions: step through every stage boundary the age has crossed.
  const target = stageForAgeDays(ageDays(p, now));
  const targetIndex = target === "depart" ? STAGE_ORDER.length : STAGE_ORDER.indexOf(target);
  while (STAGE_ORDER.indexOf(p.stage) < targetIndex && STAGE_ORDER.indexOf(p.stage) < STAGE_ORDER.length - 1) {
    const fromStage = p.stage;
    const toStage = STAGE_ORDER[STAGE_ORDER.indexOf(fromStage) + 1];
    const species = branchSpecies({
      toStage,
      priorCare: stageCareAvg(p.careLog, fromStage),
      tendency: learningTendency(p.careLog, fromStage),
      studyStreak: p.studyStreak,
      priorStudiedEveryDay: studiedEveryDayInStage(p.careLog, fromStage),
    });
    if (species === "DEPART") {
      // 完全体止まりで旅立ち: a 怠 pet that didn't earn the hidden 魔王 path.
      return depart(p, now, "perfect-stall", events);
    }
    p = { ...p, stage: toStage, speciesId: species };
    events.push({ type: "evolve", speciesId: species, stage: toStage, generation: p.generation, at: now });
  }

  // 6. Natural 旅立ち at day 12 (design §2).
  if (target === "depart") {
    return depart(p, now, "natural", events);
  }

  return { pet: p, events };
}

/** End the current generation and lay the next egg (generation + 1), carrying
 * the learner's study streak forward. */
function depart(pet: PetState, now: number, reason: DepartReason, events: PetEvent[]): TickResult {
  events.push({ type: "depart", speciesId: pet.speciesId, stage: pet.stage, generation: pet.generation, at: now, reason });
  const egg = newPet(pet.generation + 1, now, {
    studyStreak: pet.studyStreak,
    lastStudyDate: pet.lastStudyDate,
    settings: pet.settings,
  });
  return { pet: egg, events };
}

// MARK: 図鑑 (collection)

export function discoveredSpecies(collection: PetCollection): Set<string> {
  return new Set(collection.map((e) => e.speciesId));
}

/** Append a first-discovery entry (dedup by speciesId — the 図鑑 keeps the
 * FIRST sighting). Returns a new collection; unchanged if already discovered. */
export function recordDiscovery(
  collection: PetCollection,
  speciesId: SpeciesId,
  generation: number,
  reachedAt: number,
): PetCollection {
  if (collection.some((e) => e.speciesId === speciesId)) return collection;
  return [...collection, { speciesId, generation, reachedAt }];
}

/** Fold a tick's hatch/evolve events into the 図鑑 (departs add nothing new —
 * the departed form was already recorded when it was reached). */
export function recordDiscoveriesFromEvents(collection: PetCollection, events: PetEvent[]): PetCollection {
  let out = collection;
  for (const e of events) {
    if (e.type === "hatch" || e.type === "evolve") {
      out = recordDiscovery(out, e.speciesId, e.generation, e.at);
    }
  }
  return out;
}

// MARK: display snapshot (for the 育成 UI, LINGO-030)

export interface PetSnapshot {
  stage: PetStage;
  speciesId: SpeciesId;
  generation: number;
  ageDays: number;
  satiety: number; // 0..100
  poop: number; // 0..MAX_POOP
  foodCount: number;
  cleanPoints: number;
  studyStreak: number;
}

/** Pure read-model for the UI — no state change (call tick() to progress).
 * `poop` is the real stock (pet.poopCount) as of the last accrual catch-up —
 * it does NOT recompute live from a current overdueCount (v2, 2026-09-05):
 * unlike 満腹度's continuous decay, poop is a discrete stock that only grows
 * via tick()'s time-based accrual, so a caller that only peeks (e.g. Home's
 * mini status, state/pet.ts peekPet) sees the last-ticked value, not a
 * recomputed one — exactly the "たまごっち正攻法" stock semantics. */
export function petSnapshot(pet: PetState, now: number): PetSnapshot {
  return {
    stage: pet.stage,
    speciesId: pet.speciesId,
    generation: pet.generation,
    ageDays: ageDays(pet, now),
    satiety: satietyAt(pet, now),
    poop: pet.poopCount,
    foodCount: pet.foodCount,
    cleanPoints: pet.cleanPoints,
    studyStreak: pet.studyStreak,
  };
}
