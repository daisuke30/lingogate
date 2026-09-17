import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  FEED_RESTORE,
  HUNGER_DECAY_MS,
  MAX_POOP,
  MAX_FOOD,
  MAX_CLEAN_POINTS,
  POOP_INTERVAL_MAX_MS,
  POOP_INTERVAL_MIN_MS,
  SPECIES_IDS,
  poopIntervalMs,
  newPet as newPetWithSleep,
  migrateLegacyPet,
  migrateCareLog,
  clampEconomy,
  CARE_WEIGHT_STUDY,
  CARE_WEIGHT_FEED,
  CARE_WEIGHT_CLEAN,
  CARE_FEED_RATIO_TARGET,
  CARE_FEED_COUNT_TARGET,
  CARE_CLEAN_GRACE_MS,
  CARE_OK,
  CARE_GOOD,
  satietyAt,
  resolveSleepWindow,
  isAsleep,
  awakeMs,
  advanceAwakeMs,
  DEFAULT_SLEEP_START_HOUR,
  DEFAULT_SLEEP_END_HOUR,
  onSessionCommitted,
  applyFeed,
  applyClean,
  applySession,
  dailyCareScore,
  stageCareAvg,
  careTier,
  learningTendency,
  studiedEveryDayInStage,
  branchSpecies,
  stageForAgeDays,
  tick,
  recordDiscovery,
  recordDiscoveriesFromEvents,
  discoveredSpecies,
  petSnapshot,
  localDateStr,
  calendarDayDiff,
} from "./engine";
import type { CareDay, PetState, PetStage, PetEvent, SleepWindow } from "./engine";

// Fixed local clock: Jan 1 2026 00:00 (local midnight). Adding exact 24h keeps
// the wall time AND rolls the calendar date by exactly one, so real-time age,
// calendar-day math, and per-local-date ms bucketing (advancePoop's
// trackedByDate/dirtyByDate, LINGO-029/035) all line up cleanly with no
// cross-midnight splitting to reason about (no DST edges in January either).
const T0 = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
const at = (day: number) => T0 + day * DAY_MS;

// LINGO-035 (2026-09-08): every test below this point predates the sleep-
// window feature and is about mechanics unrelated to it (decay math, poop
// accrual, care scoring, evolution branching, economy caps, migration...).
// Rather than touch dozens of call sites, `newPet` here is the REAL engine
// newPet() with its sleep window immediately disabled (startHour===endHour is
// a documented "no sleep window" zero-width instance — see engine.ts's
// sleepInstanceOn) — so these tests keep their original "always awake"
// semantics. The dedicated "sleep window" describe block below uses
// `newPetWithSleep` (the unwrapped import) to exercise the real default.
function newPet(...args: Parameters<typeof newPetWithSleep>): PetState {
  const pet = newPetWithSleep(...args);
  return { ...pet, settings: { ...pet.settings, sleepStartHour: 0, sleepEndHour: 0 } };
}

// --- helpers -------------------------------------------------------------

/** CareDay fixture (LINGO-053 additive formula) — `fed`/`clean` are the
 * DESIRED resulting feedScore/cleanScore (0..1) dailyCareScore should compute
 * (via the ratio paths only — feedCount stays 0, so callers wanting to
 * exercise the count-based OR-path pass it separately). Uses a real
 * DAY_MS-scale trackedMs (not a unit "1") so CARE_CLEAN_GRACE_MS's absolute
 * 4h grace window behaves meaningfully rather than being dwarfed or
 * dominating a toy timescale. Backs out the exact starvingMs/dirtyMs that
 * make dailyCareScore land on the requested fed/clean values:
 *   notStarvingRatio = fed × CARE_FEED_RATIO_TARGET  ⇒ feedScore = fed
 *   dirtyMs = GRACE + (1-clean) × trackedMs           ⇒ cleanScore = clean */
function makeCareDay(
  date: string,
  stage: PetStage,
  o: { studied: boolean; fed: number; clean: number; newCount?: number; reviewCount?: number; feedCount?: number },
): CareDay {
  const trackedMs = DAY_MS;
  const notStarvingRatio = Math.max(0, Math.min(1, o.fed)) * CARE_FEED_RATIO_TARGET;
  const starvingMs = Math.max(0, (1 - notStarvingRatio) * trackedMs);
  const dirtyMs = CARE_CLEAN_GRACE_MS + Math.max(0, 1 - Math.max(0, Math.min(1, o.clean))) * trackedMs;
  return {
    date,
    stage,
    studied: o.studied,
    newCount: o.newCount ?? 0,
    reviewCount: o.reviewCount ?? 0,
    feedCount: o.feedCount ?? 0,
    trackedMs,
    dirtyMs,
    starvingMs,
  };
}

/** A well-tended day under the poop-stock model: study (creates/updates
 * today's CareDay row via applySession, earning the day's 餌/掃除P budget),
 * force the pet's satiety to exactly 100% right at `now` and its poop stock
 * to exactly 0 (so THIS call's own tick() computes a genuine fedRatio=1
 * sample and a zero-length dirty span on its own — no faked sample data),
 * patch today's row's stage/trackedMs/dirtyMs directly (cleanRatio=1, full
 * day tracked), then tick to `day`'s close.
 *
 * This is a deliberate simplification over simulating fine-grained
 * feed/tick/clean visits (which this function did through several LINGO-035
 * iterations): overdueCount=0's poop interval (16h, v3 2026-09-08) doesn't
 * evenly divide a calendar day, so SOME visit cadence will always eventually
 * place a spawn's dirty window right at the exact instant a stage's age
 * threshold crosses — creating a near-empty new CareDay row with a
 * momentarily 100%-dirty sample, which (fairly, given the scoring formula)
 * can score low enough to flip a tier right at a boundary. That interaction
 * is real and is exercised deliberately and precisely by the poop-accrual
 * and "怠 at 完全体" describe blocks elsewhere in this file; chasing it out
 * of THIS test via ever-finer simulated check-ins doesn't actually change
 * whether it can happen (only real usage's inherent unpredictability makes it
 * astronomically unlikely to land exactly on a boundary in practice) — and
 * this test's actual job is verifying the ENGINE WIRING (tick/hatch/evolve/
 * depart/generation-turnover) end to end for an otherwise-diligent learner,
 * which a directly-constructed "perfect" day still exercises for real (tick()
 * still drives every hatch/evolve/depart decision from this careLog). */
function healthyDay(pet: PetState, day: number, tendency: { newCount: number; reviewCount: number }) {
  let p = applySession(pet, tendency, at(day)).pet;
  const now = at(day + 1) - 1; // just before the next calendar date begins
  const date = localDateStr(at(day));
  // The row must be tagged with whatever stage the pet WILL be in by `now`
  // (computed from age, matching stageForAgeDays exactly) — not p.stage as
  // captured before this call's own tick(), which can still be the PRIOR
  // stage even though `date` calendar-wise belongs to the new one (e.g. baby
  // ends exactly at age 1 = the start of its 2nd calendar date, which is
  // already "child" by the time this same call's tick() reaches `now`).
  const aged = stageForAgeDays(Math.max(0, (now - p.bornAt) / DAY_MS));
  const stage: PetStage = aged === "depart" ? "ultimate" : aged;
  const log = p.careLog.slice();
  const i = log.findIndex((d) => d.date === date);
  if (i >= 0) log[i] = { ...log[i], stage, trackedMs: DAY_MS, dirtyMs: 0 };
  p = {
    ...p,
    careLog: log,
    poopCount: 0,
    poopAccruedAt: now, // this tick's own poop-accrual pass becomes a no-op
    hunger: 100,
    lastFedAt: now, // this tick's own fed-sample (step3) reads exactly 100%
  };
  const r = tick(p, { now, overdueCount: 0 });
  return { pet: r.pet, events: r.events };
}

// --- core mappings (design §1) ------------------------------------------

describe("satietyAt: 満腹度 linear decay over HUNGER_DECAY_MS of AWAKE time (design §1 v3)", () => {
  const pet = newPet(1, T0); // sleep disabled (see the local newPet() shadow above)
  it("is full right after feeding", () => {
    expect(satietyAt(pet, T0)).toBe(100);
  });
  it("halves at the midpoint, empties at HUNGER_DECAY_MS, clamps below zero", () => {
    expect(satietyAt(pet, T0 + HUNGER_DECAY_MS / 2)).toBeCloseTo(50, 9);
    expect(satietyAt(pet, T0 + HUNGER_DECAY_MS)).toBe(0);
    expect(satietyAt(pet, T0 + 2 * HUNGER_DECAY_MS)).toBe(0);
  });
  // LINGO-035 QA (2026-09-08): confirms the decay formula itself matches the
  // documented spec exactly — the item 3 "満腹度が全然減っていない" bug-hunt
  // conclusion (satietyAt is spec-correct; Katsuta later confirmed the real
  // overnight drop was ~40%, in line with spec) shrunk to this one test per
  // the coordinator's instruction, rather than a deeper investigation.
  it("matches (pet.hunger - 100*elapsed/HUNGER_DECAY_MS) exactly for an arbitrary elapsed", () => {
    const elapsed = HUNGER_DECAY_MS * 0.37;
    const expected = 100 - (100 * elapsed) / HUNGER_DECAY_MS;
    expect(satietyAt(pet, T0 + elapsed)).toBeCloseTo(expected, 9);
  });
});

describe("poopIntervalMs: spawn rate vs overdue count (design §1 v2/v3)", () => {
  it("matches the design's worked examples (v3, 2026-09-08: overdue=0 re-anchored 24h→16h)", () => {
    expect(poopIntervalMs(0)).toBeCloseTo(16 * 60 * 60 * 1000, -2); // overdue 0 → 16h (exact)
    expect(poopIntervalMs(10)).toBeCloseTo(8 * 60 * 60 * 1000, -2); // overdue 10 → 8h (exact, the anchor, unchanged)
    // overdue 30+ → "approx 4h": the continuous exponential lands close to but
    // not exactly at the floor (≈4h10m here) — assert it's within 30min of 4h
    // rather than exact, since "continuous formula, approximately these
    // points" is what the coordinator's spec asked for, not a hard clamp.
    const thirty = poopIntervalMs(30);
    expect(Math.abs(thirty - 4 * 60 * 60 * 1000)).toBeLessThan(30 * 60 * 1000);
  });
  it("is continuous, non-increasing, and never drops below MIN", () => {
    let prev = poopIntervalMs(0);
    expect(prev).toBe(POOP_INTERVAL_MAX_MS);
    for (const o of [1, 2, 5, 10, 20, 50, 100, 1000]) {
      const cur = poopIntervalMs(o);
      // Non-strict: at very large overdue counts exp(-o/TAU) underflows to
      // exactly 0 in double precision, so the curve legitimately reaches
      // POOP_INTERVAL_MIN_MS exactly rather than approaching it forever.
      expect(cur).toBeLessThanOrEqual(prev);
      expect(cur).toBeGreaterThanOrEqual(POOP_INTERVAL_MIN_MS);
      prev = cur;
    }
  });
  it("negative/garbage overdue counts clamp to the overdue=0 rate", () => {
    expect(poopIntervalMs(-5)).toBe(poopIntervalMs(0));
  });
});

// --- sleep window (design §2 v3, 2026-09-08) ------------------------------
// These tests use the REAL engine newPet (newPetWithSleep), not the local
// no-sleep-shadowed `newPet`, since they exercise the actual default window.

const H = 60 * 60 * 1000;

describe("resolveSleepWindow: defensive defaults", () => {
  it("returns the configured window when both fields are present", () => {
    const settings = { hardMode: false, sleepStartHour: 22, sleepEndHour: 6 };
    expect(resolveSleepWindow(settings)).toEqual({ startHour: 22, endHour: 6 });
  });
  it("defaults missing fields to the design default (pre-LINGO-035 persisted settings)", () => {
    const legacy = { hardMode: false } as any;
    expect(resolveSleepWindow(legacy)).toEqual({
      startHour: DEFAULT_SLEEP_START_HOUR,
      endHour: DEFAULT_SLEEP_END_HOUR,
    });
  });
});

describe("isAsleep: default window 23:00〜08:00", () => {
  const sw: SleepWindow = { startHour: DEFAULT_SLEEP_START_HOUR, endHour: DEFAULT_SLEEP_END_HOUR };
  it("is asleep at local midnight (inside last night's instance)", () => {
    expect(isAsleep(sw, T0)).toBe(true); // T0 = 00:00
  });
  it("is awake exactly at wake time (end boundary exclusive)", () => {
    expect(isAsleep(sw, T0 + 8 * H)).toBe(false); // 08:00
  });
  it("is awake right before bedtime, asleep exactly at bedtime (start boundary inclusive)", () => {
    expect(isAsleep(sw, T0 + 23 * H - 1)).toBe(false); // 22:59:59.999
    expect(isAsleep(sw, T0 + 23 * H)).toBe(true); // 23:00 exactly
  });
  it("is awake at midday", () => {
    expect(isAsleep(sw, T0 + 14 * H)).toBe(false); // 14:00
  });
  it("startHour===endHour is a documented zero-width 'no sleep' window, never asleep", () => {
    const noSleep: SleepWindow = { startHour: 5, endHour: 5 };
    expect(isAsleep(noSleep, T0)).toBe(false);
    expect(isAsleep(noSleep, T0 + 5 * H)).toBe(false);
    expect(isAsleep(noSleep, T0 + 23 * H)).toBe(false);
  });
  it("a same-day (non-wrapping) window works too, e.g. a 13:00-14:00 nap", () => {
    const nap: SleepWindow = { startHour: 13, endHour: 14 };
    expect(isAsleep(nap, T0 + 12 * H)).toBe(false);
    expect(isAsleep(nap, T0 + 13 * H)).toBe(true);
    expect(isAsleep(nap, T0 + 13.5 * H)).toBe(true);
    expect(isAsleep(nap, T0 + 14 * H)).toBe(false);
  });
});

describe("awakeMs: real elapsed time minus every sleep instance in range", () => {
  const sw: SleepWindow = { startHour: DEFAULT_SLEEP_START_HOUR, endHour: DEFAULT_SLEEP_END_HOUR };
  it("one full calendar day = 24h − 9h sleep = 15h awake", () => {
    expect(awakeMs(sw, T0, T0 + 24 * H)).toBe(15 * H);
  });
  it("a span entirely inside the awake window subtracts nothing", () => {
    expect(awakeMs(sw, T0 + 9 * H, T0 + 17 * H)).toBe(8 * H); // 09:00-17:00
  });
  it("a span entirely inside the sleep window is fully asleep", () => {
    expect(awakeMs(sw, T0, T0 + 4 * H)).toBe(0); // 00:00-04:00
  });
  it("scales linearly over multiple full days", () => {
    expect(awakeMs(sw, T0, T0 + 3 * 24 * H)).toBe(3 * 15 * H);
  });
  it("an empty or backwards range is zero", () => {
    expect(awakeMs(sw, T0, T0)).toBe(0);
    expect(awakeMs(sw, T0 + 1000, T0)).toBe(0);
  });
  it("a zero-width (no sleep) window never subtracts anything", () => {
    const noSleep: SleepWindow = { startHour: 5, endHour: 5 };
    expect(awakeMs(noSleep, T0, T0 + 24 * H)).toBe(24 * H);
  });
});

describe("advanceAwakeMs: inverse of awakeMs, skips sleep windows", () => {
  const sw: SleepWindow = { startHour: DEFAULT_SLEEP_START_HOUR, endHour: DEFAULT_SLEEP_END_HOUR };
  it("simple case: target fits before the next sleep instance", () => {
    // From 09:00, 4 awake hours later is just 13:00 (no sleep in between).
    expect(advanceAwakeMs(sw, T0 + 9 * H, 4 * H)).toBe(T0 + 13 * H);
  });
  it("skips a full night when the target crosses it", () => {
    // From 22:00, 2 awake hours: 1h to reach 23:00 (bedtime), then the 9h
    // night is skipped entirely, then 1 more awake hour into the next day.
    const from = T0 + 22 * H;
    const result = advanceAwakeMs(sw, from, 2 * H);
    expect(result).toBe(T0 + 24 * H + 9 * H); // next day 09:00 (1h consumed pre-bedtime + 1h consumed post-wake = 2h target)
  });
  it("round-trips with awakeMs: awakeMs(from, advanceAwakeMs(from, X)) === X", () => {
    const from = T0 + 6 * H;
    const target = 20 * H; // spans more than one night
    const to = advanceAwakeMs(sw, from, target);
    expect(awakeMs(sw, from, to)).toBeCloseTo(target, 6);
  });
  it("zero or negative target returns `from` unchanged", () => {
    expect(advanceAwakeMs(sw, T0, 0)).toBe(T0);
    expect(advanceAwakeMs(sw, T0, -100)).toBe(T0);
  });
});

describe("satietyAt with the real sleep window: decay pauses entirely while asleep", () => {
  it("no further decay accrues during the whole sleep window (Katsuta's overnight report)", () => {
    const pet = { ...newPetWithSleep(1, T0), hunger: 100, lastFedAt: T0 };
    const atBedtime = satietyAt(pet, T0 + 23 * H); // 23:00, just entering sleep
    const atWaketime = satietyAt(pet, T0 + 23 * H + 9 * H); // 08:00 next day
    expect(atWaketime).toBeCloseTo(atBedtime, 9); // unchanged across the whole night
  });
  it("decay resumes after waking", () => {
    const pet = { ...newPetWithSleep(1, T0), hunger: 100, lastFedAt: T0 };
    const atWaketime = satietyAt(pet, T0 + 32 * H); // 08:00 next day
    const oneHourLater = satietyAt(pet, T0 + 33 * H);
    expect(oneHourLater).toBeLessThan(atWaketime);
    expect(atWaketime - oneHourLater).toBeCloseTo((100 * H) / HUNGER_DECAY_MS, 6);
  });
  it("matches the no-sleep baseline once only awake time is counted (0h asleep so far at exactly 08:00 day 1)", () => {
    // From T0 (00:00, already mid-sleep) to 08:00 the SAME day: entirely
    // inside the carried-over overnight instance → zero awake time elapsed.
    const pet = { ...newPetWithSleep(1, T0), hunger: 100, lastFedAt: T0 };
    expect(satietyAt(pet, T0 + 8 * H)).toBe(100);
  });
});

describe("tick: poop does not accrue during sleep (Katsuta's overnight report)", () => {
  it("a full night offline (23:00→08:00) with high overdue spawns nothing while asleep", () => {
    // bornAt at 22:00 so the pet is awake for 1h, then asleep 23:00-08:00.
    const pet = newPetWithSleep(1, T0 + 22 * H);
    const now = T0 + 22 * H + 9 * H; // 07:00 next day — still within the night
    const r = tick(pet, { now, overdueCount: 50 }); // very high overdue = fast spawn rate
    // Only 1h of AWAKE time has elapsed (22:00-23:00) — even at overdue=50's
    // near-4h-floor interval, nowhere near enough for a spawn yet.
    expect(r.pet.poopCount).toBe(0);
  });
  it("spawns resume normally once awake, counting only awake elapsed", () => {
    const pet = newPetWithSleep(1, T0 + 22 * H); // awake from 22:00
    // 1h awake (22:00-23:00) + 9h asleep (23:00-08:00) + 3h awake (08:00-11:00)
    // = 4h awake total — matches POOP_INTERVAL_MIN_MS exactly at very high overdue.
    const now = T0 + 22 * H + 1 * H + 9 * H + 3 * H;
    const r = tick(pet, { now, overdueCount: 1000 }); // interval floors to exactly 4h (see poopIntervalMs test)
    expect(r.pet.poopCount).toBe(1);
  });
});

describe("care score excludes sleep hours (design §2 v3)", () => {
  it("a night spent entirely asleep contributes zero to BOTH trackedMs and dirtyMs", () => {
    const pet = { ...newPetWithSleep(1, T0 + 22 * H), poopCount: 5 }; // already dirty going into the night
    const before = tick(pet, { now: T0 + 23 * H, overdueCount: 0 }).pet; // 1h awake, then bedtime
    const trackedBefore = before.careLog.reduce((a, d) => a + d.trackedMs, 0);
    const after = tick(before, { now: T0 + 32 * H, overdueCount: 0 }).pet; // through the whole night to 08:00
    const trackedAfter = after.careLog.reduce((a, d) => a + d.trackedMs, 0);
    // Only the 08:00 wake instant's zero-elapsed tick adds nothing further —
    // the 9h night itself must not appear in trackedMs at all.
    expect(trackedAfter - trackedBefore).toBe(0);
  });
});

// 2026-09-10 (Katsuta instruction, post-LINGO-035): unlike feeding, 掃除する
// does NOT need to wake the pet — only feedDisabled keeps the sleep gate
// (see petDisplay.ts). applyClean() itself has no time/sleep awareness at all
// (engine.ts: a pure instantaneous poopCount/cleanPoints decrement) — this
// test proves that's still care-score-correct: cleaning mid-sleep is exactly
// as effective as cleaning while awake, because the NEXT tick()'s
// advancePoop() reads the already-reduced poopCount as `oldPoop` for whatever
// awake span comes next, and sleep hours never contribute trackedMs/dirtyMs
// either way (cleaned or not) — so there's no separate "sleep" code path to
// get wrong.
describe("applyClean during sleep is care-score-correct (2026-09-10, Katsuta instruction)", () => {
  it("cleaning at MAX_POOP in the middle of the night zeroes the dirty contribution of the NEXT awake hour", () => {
    // Awake 1h (22:00→23:00), then asleep 23:00→08:00 next day, already at
    // MAX_POOP going into the night (matches "0時過ぎ就寝でうんこ5個" reports).
    const pet = { ...newPetWithSleep(1, T0 + 22 * H), poopCount: 5, cleanPoints: 5 };
    const beforeSleep = tick(pet, { now: T0 + 23 * H, overdueCount: 0 }).pet;
    expect(beforeSleep.poopCount).toBe(5); // still full going into the night

    // Clean to 0 in the middle of the night. `applyClean` takes no `now` —
    // this really is midnight cleaning, confirmed via isAsleep.
    const midSleep = T0 + 26 * H; // 02:00, well inside the sleep window
    expect(isAsleep(resolveSleepWindow(beforeSleep.settings), midSleep)).toBe(true);
    let cleaned = beforeSleep;
    for (let i = 0; i < 5; i++) cleaned = applyClean(cleaned);
    expect(cleaned.poopCount).toBe(0);
    expect(cleaned.cleanPoints).toBe(0);

    const trackedBefore = cleaned.careLog.reduce((a, d) => a + d.trackedMs, 0);
    const dirtyBefore = cleaned.careLog.reduce((a, d) => a + d.dirtyMs, 0);

    // Wake up (08:00) and stay awake 1h more (→09:00). This tick's
    // advancePoop reads the ALREADY-cleaned poopCount=0 as `oldPoop`, so the
    // newly-awake hour must be recorded as fully clean, not dirty.
    const afterWake = tick(cleaned, { now: T0 + 33 * H, overdueCount: 0 }).pet;
    const trackedAfter = afterWake.careLog.reduce((a, d) => a + d.trackedMs, 0);
    const dirtyAfter = afterWake.careLog.reduce((a, d) => a + d.dirtyMs, 0);

    expect(trackedAfter - trackedBefore).toBe(1 * H); // the post-wake hour IS tracked
    expect(dirtyAfter - dirtyBefore).toBe(0); // ...but not dirty, thanks to the sleep-time clean
  });

  it("without the sleep-time clean, the same post-wake hour would have scored dirty", () => {
    // Same setup, but skip the clean — a direct contrast proving the
    // "care-score-correct" claim above isn't a tautology of the test itself.
    const pet = { ...newPetWithSleep(1, T0 + 22 * H), poopCount: 5, cleanPoints: 5 };
    const beforeSleep = tick(pet, { now: T0 + 23 * H, overdueCount: 0 }).pet;
    const trackedBefore = beforeSleep.careLog.reduce((a, d) => a + d.trackedMs, 0);
    const dirtyBefore = beforeSleep.careLog.reduce((a, d) => a + d.dirtyMs, 0);

    const afterWake = tick(beforeSleep, { now: T0 + 33 * H, overdueCount: 0 }).pet;
    const trackedAfter = afterWake.careLog.reduce((a, d) => a + d.trackedMs, 0);
    const dirtyAfter = afterWake.careLog.reduce((a, d) => a + d.dirtyMs, 0);

    expect(trackedAfter - trackedBefore).toBe(1 * H);
    expect(dirtyAfter - dirtyBefore).toBe(1 * H); // fully dirty — nothing cleaned it
  });
});

describe("petSnapshot.asleep reflects the configured window", () => {
  it("true during the night, false during the day", () => {
    const pet = newPetWithSleep(1, T0);
    expect(petSnapshot(pet, T0 + 2 * H).asleep).toBe(true); // 02:00
    expect(petSnapshot(pet, T0 + 12 * H).asleep).toBe(false); // 12:00
  });
});

const EMPTY_POCKET = { foodCount: 0, cleanPoints: 0 };

describe("onSessionCommitted: 餌/掃除P earnings (design §1)", () => {
  // Kept comfortably under MAX_FOOD=6/MAX_CLEAN_POINTS=3 (LINGO-034) so these
  // exercise the raw per-card formula, not the pocket cap — the cap has its
  // own describe block below.
  it("new card = +2 餌, review = +1 餌", () => {
    expect(onSessionCommitted({ newCount: 2, reviewCount: 0 }, EMPTY_POCKET).food).toBe(4);
    expect(onSessionCommitted({ newCount: 0, reviewCount: 4 }, EMPTY_POCKET).food).toBe(4);
    expect(onSessionCommitted({ newCount: 1, reviewCount: 2 }, EMPTY_POCKET).food).toBe(4);
  });
  it("3 reviews = +1 掃除P (floored)", () => {
    expect(onSessionCommitted({ newCount: 0, reviewCount: 3 }, { foodCount: 0, cleanPoints: 0 }).cleanPoints).toBe(1);
    expect(onSessionCommitted({ newCount: 0, reviewCount: 2 }, EMPTY_POCKET).cleanPoints).toBe(0);
  });
  it("an empty pocket with room to spare is never reported as capped", () => {
    const e = onSessionCommitted({ newCount: 1, reviewCount: 2 }, EMPTY_POCKET);
    expect(e.foodCapped).toBe(false);
    expect(e.cleanCapped).toBe(false);
  });
});

// LINGO-034 (2026-09-07, 勝田指摘): uncapped 餌/掃除P let a learner bank enough
// to coast the pet without studying — the pull mechanic's whole point dies.
// MAX_FOOD=6 / MAX_CLEAN_POINTS=3 (design: 餌≒2日分の備蓄, 掃除P≒うんこ半分強を
// 即処理できる程度) clamp earnings AT THE SOURCE, and report whether anything
// was discarded so the UI can show a non-judgmental "pocket was full" note.
describe("onSessionCommitted: pocket caps (LINGO-034, 2026-09-07)", () => {
  it("clamps 餌 to the room left in the pocket, not the full MAX_FOOD", () => {
    // 4 already held, cap 6 → only 2 more fit, even though the raw earn is 6.
    const e = onSessionCommitted({ newCount: 3, reviewCount: 0 }, { foodCount: 4, cleanPoints: 0 });
    expect(e.food).toBe(2);
    expect(e.foodCapped).toBe(true);
  });
  it("clamps 掃除P to the room left in the pocket, not the full MAX_CLEAN_POINTS", () => {
    // 2 already held, cap 3 → only 1 more fits, even though the raw earn is 2.
    const e = onSessionCommitted({ newCount: 0, reviewCount: 6 }, { foodCount: 0, cleanPoints: 2 });
    expect(e.cleanPoints).toBe(1);
    expect(e.cleanCapped).toBe(true);
  });
  it("a pocket already exactly at MAX earns nothing further, and reports capped iff the raw earn was > 0", () => {
    const full = { foodCount: MAX_FOOD, cleanPoints: MAX_CLEAN_POINTS };
    const withEarnings = onSessionCommitted({ newCount: 1, reviewCount: 3 }, full);
    expect(withEarnings.food).toBe(0);
    expect(withEarnings.cleanPoints).toBe(0);
    expect(withEarnings.foodCapped).toBe(true);
    expect(withEarnings.cleanCapped).toBe(true);
    // A session that earns nothing at all (e.g. 0 new, <3 reviews) shouldn't
    // claim the pocket capped anything — nothing was actually discarded.
    const zeroEarn = onSessionCommitted({ newCount: 0, reviewCount: 0 }, full);
    expect(zeroEarn.foodCapped).toBe(false);
    expect(zeroEarn.cleanCapped).toBe(false);
  });
  it("boundary: earning exactly the remaining room is NOT reported as capped", () => {
    // 5 held, cap 6 → exactly 1 room; earning exactly 1 (new=0,review=1) fits fully.
    const e = onSessionCommitted({ newCount: 0, reviewCount: 1 }, { foodCount: 5, cleanPoints: 0 });
    expect(e.food).toBe(1);
    expect(e.foodCapped).toBe(false);
  });
  it("boundary: earning one more than the remaining room IS reported as capped", () => {
    // 5 held, cap 6 → 1 room; earning 2 (new=1,review=0) only 1 fits.
    const e = onSessionCommitted({ newCount: 1, reviewCount: 0 }, { foodCount: 5, cleanPoints: 0 });
    expect(e.food).toBe(1);
    expect(e.foodCapped).toBe(true);
  });
  it("a pocket somehow already over the cap (pre-migration data) earns nothing and clamps to no negative room", () => {
    const e = onSessionCommitted({ newCount: 3, reviewCount: 3 }, { foodCount: 999, cleanPoints: 999 });
    expect(e.food).toBe(0);
    expect(e.cleanPoints).toBe(0);
  });
});

// --- actions -------------------------------------------------------------

describe("applyFeed", () => {
  it("restores 満腹度 and consumes one 餌", () => {
    const pet = { ...newPet(1, T0), foodCount: 2 };
    const empty = { ...pet, lastFedAt: T0 - DAY_MS }; // fully decayed
    const fed = applyFeed(empty, T0);
    expect(satietyAt(fed, T0)).toBeCloseTo(FEED_RESTORE, 9);
    expect(fed.foodCount).toBe(1);
  });
  it("clamps at 100 and is a no-op with no 餌", () => {
    const full = { ...newPet(1, T0), foodCount: 1 };
    expect(satietyAt(applyFeed(full, T0), T0)).toBe(100);
    const broke = { ...newPet(1, T0), foodCount: 0 };
    expect(applyFeed(broke, T0)).toBe(broke);
  });
});

describe("applyClean: instant 1-for-1 poop deletion (design §1 v2, 2026-09-05)", () => {
  // This is the direct fix for the reported bug: 掃除する used to spend a
  // 掃除P against a poop count that was DERIVED live from overdueCount, so
  // spending it never visibly changed anything (overdueCount only drops when
  // reviews are actually done). Now poopCount is real stock state that
  // applyClean mutates directly — independent of overdueCount entirely.
  it("consumes exactly one 掃除P and removes exactly one うんこ, immediately", () => {
    const pet = { ...newPet(1, T0), poopCount: 3, cleanPoints: 2 };
    const cleaned = applyClean(pet);
    expect(cleaned.poopCount).toBe(2);
    expect(cleaned.cleanPoints).toBe(1);
  });
  it("is a no-op with no 掃除P, regardless of poop stock", () => {
    const pet = { ...newPet(1, T0), poopCount: 5, cleanPoints: 0 };
    expect(applyClean(pet)).toBe(pet);
  });
  it("is a no-op with an empty poop stock, regardless of 掃除P held", () => {
    const pet = { ...newPet(1, T0), poopCount: 0, cleanPoints: 4 };
    expect(applyClean(pet)).toBe(pet);
  });
  it("repeated calls drain the stock one at a time, then stop", () => {
    let pet = { ...newPet(1, T0), poopCount: 2, cleanPoints: 5 };
    pet = applyClean(pet);
    expect(pet.poopCount).toBe(1);
    pet = applyClean(pet);
    expect(pet.poopCount).toBe(0);
    expect(pet.cleanPoints).toBe(3); // 2 spent, 3 left over
    pet = applyClean(pet); // nothing left to clean
    expect(pet.poopCount).toBe(0);
    expect(pet.cleanPoints).toBe(3);
  });
});

describe("applySession: earnings + study log + streak", () => {
  it("adds earnings (clamped to the pocket cap, LINGO-034) and marks today studied with N/R counts", () => {
    // Raw earn would be food=16 (5*2+6*1), cleanPoints=2 (floor(6/3)) — food
    // clamps to the MAX_FOOD=6 pocket cap from a fresh (empty) pet; the
    // cleanPoints raw earn of 2 fits under MAX_CLEAN_POINTS=3 untouched.
    const { pet, earned } = applySession(newPet(1, T0), { newCount: 5, reviewCount: 6 }, T0);
    expect(earned).toEqual({ food: MAX_FOOD, cleanPoints: 2, foodCapped: true, cleanCapped: false });
    expect(pet.foodCount).toBe(MAX_FOOD);
    expect(pet.cleanPoints).toBe(2);
    const today = pet.careLog[0];
    expect(today.studied).toBe(true);
    expect(today.newCount).toBe(5);
    expect(today.reviewCount).toBe(6);
    expect(pet.studyStreak).toBe(1);
  });
  it("never lets foodCount/cleanPoints exceed the caps across repeated sessions", () => {
    let p = newPet(1, T0);
    for (let i = 0; i < 5; i++) {
      p = applySession(p, { newCount: 5, reviewCount: 6 }, at(i)).pet;
      expect(p.foodCount).toBeLessThanOrEqual(MAX_FOOD);
      expect(p.cleanPoints).toBeLessThanOrEqual(MAX_CLEAN_POINTS);
    }
    expect(p.foodCount).toBe(MAX_FOOD);
    expect(p.cleanPoints).toBe(MAX_CLEAN_POINTS);
  });
  it("increments the streak on consecutive days, resets after a gap", () => {
    let p = applySession(newPet(1, T0), { newCount: 1, reviewCount: 0 }, at(0)).pet;
    expect(p.studyStreak).toBe(1);
    p = applySession(p, { newCount: 1, reviewCount: 0 }, at(0)).pet; // same day
    expect(p.studyStreak).toBe(1);
    p = applySession(p, { newCount: 1, reviewCount: 0 }, at(1)).pet; // next day
    expect(p.studyStreak).toBe(2);
    p = applySession(p, { newCount: 1, reviewCount: 0 }, at(3)).pet; // 2-day gap
    expect(p.studyStreak).toBe(1);
  });
  it("carries the streak across generations (learner, not pet)", () => {
    const egg = newPet(2, at(5), { studyStreak: 5, lastStudyDate: localDateStr(at(4)) });
    const p = applySession(egg, { newCount: 1, reviewCount: 0 }, at(5)).pet;
    expect(p.studyStreak).toBe(6);
  });
});

// --- poop accrual (tick) --------------------------------------------------

describe("tick: poop stock accrual (design §1 v2, 2026-09-05)", () => {
  it("spawns nothing before a full interval has elapsed", () => {
    const pet = newPet(1, T0);
    const r = tick(pet, { now: T0 + POOP_INTERVAL_MAX_MS - 1, overdueCount: 0 });
    expect(r.pet.poopCount).toBe(0);
  });
  it("spawns exactly one poop once the interval elapses (overdue=0 → 24h)", () => {
    const pet = newPet(1, T0);
    const r = tick(pet, { now: T0 + POOP_INTERVAL_MAX_MS, overdueCount: 0 });
    expect(r.pet.poopCount).toBe(1);
  });
  it("a higher overdue count spawns proportionally faster (10 → 8h interval)", () => {
    const pet = newPet(1, T0);
    const before = tick(pet, { now: T0 + 8 * 60 * 60 * 1000 - 1, overdueCount: 10 });
    expect(before.pet.poopCount).toBe(0);
    const after = tick(pet, { now: T0 + 8 * 60 * 60 * 1000, overdueCount: 10 });
    expect(after.pet.poopCount).toBe(1);
  });
  // Both of the following jump `now` a couple of days ahead of bornAt (to
  // exercise a real offline catch-up) but stay well under the 3-day
  // abandonment threshold AND under the age-9-day "ultimate" transition (the
  // only evolution boundary a fully-unstudied careLog could force into an
  // early perfect-stall departure) — so the pet is still alive as itself when
  // we inspect its accrued poop. A recent lastStudyDate sidesteps the
  // calendar-date (not exact-hours) 3-day abandonment check regardless of
  // exactly where the offset lands relative to local midnight.
  it("catches up multiple spawns across a long offline gap, capped at MAX_POOP", () => {
    const now = T0 + 2.9 * DAY_MS;
    const pet = { ...newPet(1, T0), lastStudyDate: localDateStr(now - 1 * DAY_MS) };
    // ~70h offline at overdue=1000 (rate floors to the 4h MIN interval) would
    // be ~17 poops — clamped to 5.
    const r = tick(pet, { now, overdueCount: 1000 });
    expect(r.pet.poopCount).toBe(MAX_POOP);
  });
  it("does not bank backlog credit once capped — a clean after capping still needs a fresh interval", () => {
    const now0 = T0 + 2.9 * DAY_MS;
    let pet: PetState = { ...newPet(1, T0), lastStudyDate: localDateStr(now0 - 1 * DAY_MS) };
    // Way overdue → stock caps out fast.
    pet = tick(pet, { now: now0, overdueCount: 1000 }).pet;
    expect(pet.poopCount).toBe(MAX_POOP);
    pet = { ...pet, cleanPoints: 1 };
    pet = applyClean(pet);
    expect(pet.poopCount).toBe(MAX_POOP - 1);
    // Immediately re-ticking (no time passed) must NOT instantly refill from
    // banked backlog — the accrual clock only resumed at the capped tick.
    const immediate = tick(pet, { now: now0, overdueCount: 1000 });
    expect(immediate.pet.poopCount).toBe(MAX_POOP - 1);
  });
  it("cleaning mid-visit is reflected immediately in the next tick's starting stock", () => {
    let pet = newPet(1, T0);
    pet = tick(pet, { now: T0 + POOP_INTERVAL_MAX_MS, overdueCount: 0 }).pet;
    expect(pet.poopCount).toBe(1);
    pet = { ...pet, cleanPoints: 1 };
    pet = applyClean(pet);
    expect(pet.poopCount).toBe(0);
    // Next tick a full interval later spawns exactly one more, not a
    // leftover-plus-one — confirms clean actually zeroed the live stock.
    const next = tick(pet, { now: T0 + 2 * POOP_INTERVAL_MAX_MS, overdueCount: 0 });
    expect(next.pet.poopCount).toBe(1);
  });

  // LINGO-035 (2026-09-08) regression: poopAccruedAt used to double as BOTH
  // the care-log processing checkpoint AND the spawn-progress clock. Its
  // advance formula (`from + newPoops*interval`) only moved by WHOLE
  // intervals, so any tick() call that found ZERO new spawns left it stuck —
  // and the NEXT call's [stuck, now) span would re-fold the SAME already-
  // recorded time into trackedMs/dirtyMs again. The original LINGO-029/034
  // tests never caught this because their single-tick-per-day pattern always
  // happened to find exactly 1 new spawn per call (interval == day length
  // then). These tests call tick() several times with NO new spawn in
  // between and check trackedMs sums to real elapsed exactly once.
  describe("poopAccruedAt/poopProgressMs: no double-counting across multiple ticks (LINGO-035 fix)", () => {
    it("several short ticks with no new spawn sum trackedMs to exactly the real elapsed, not more", () => {
      let pet = newPet(1, T0);
      const step = 1 * H;
      let now = T0;
      for (let i = 0; i < 5; i++) {
        now += step;
        pet = tick(pet, { now, overdueCount: 0 }).pet; // 5h total, well under the 16h interval — never spawns
      }
      expect(pet.poopCount).toBe(0);
      const totalTracked = pet.careLog.reduce((a, d) => a + d.trackedMs, 0);
      expect(totalTracked).toBe(5 * step); // NOT 1+2+3+4+5=15h (the double-counted sum)
    });
    it("spawn progress still accumulates correctly across those same short ticks", () => {
      let pet = newPet(1, T0);
      const step = 4 * H;
      let now = T0;
      for (let i = 0; i < 4; i++) {
        now += step; // 4 × 4h = 16h total = exactly POOP_INTERVAL_MAX_MS at overdue=0
        pet = tick(pet, { now, overdueCount: 0 }).pet;
      }
      expect(pet.poopCount).toBe(1); // the accumulated progress across calls still spawns on time
    });
    it("a tick with a genuine new spawn still only records that call's own elapsed span", () => {
      let pet = newPet(1, T0);
      pet = tick(pet, { now: T0 + 3 * H, overdueCount: 0 }).pet; // no spawn yet, 3h recorded
      pet = tick(pet, { now: T0 + POOP_INTERVAL_MAX_MS, overdueCount: 0 }).pet; // spawns; +13h recorded
      const totalTracked = pet.careLog.reduce((a, d) => a + d.trackedMs, 0);
      expect(totalTracked).toBe(POOP_INTERVAL_MAX_MS); // 3h + 13h, not 3h + 16h
      expect(pet.poopCount).toBe(1);
    });
  });
});

// --- care scoring --------------------------------------------------------

describe("care scoring (LINGO-053, 2026-09-18: additive 学習+給餌充足+清潔充足)", () => {
  it("dailyCareScore = CARE_WEIGHT_STUDY×studied + CARE_WEIGHT_FEED×feedScore + CARE_WEIGHT_CLEAN×cleanScore", () => {
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: true, fed: 1, clean: 1 }))).toBeCloseTo(1, 9);
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: false, fed: 1, clean: 1 }))).toBeCloseTo(
      CARE_WEIGHT_FEED + CARE_WEIGHT_CLEAN,
      9,
    );
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: true, fed: 0.5, clean: 0.6 }))).toBeCloseTo(
      CARE_WEIGHT_STUDY + CARE_WEIGHT_FEED * 0.5 + CARE_WEIGHT_CLEAN * 0.6,
      9,
    );
  });
  it("a studied-only day (feed=clean=0) still lands BELOW CARE_OK — preserves the マオウガ 隠し条件's reachability", () => {
    // If CARE_WEIGHT_STUDY alone were >= CARE_OK (0.4), a studied day could
    // never score "neglect", making the demon-lord hidden path (which needs
    // BOTH neglect tier AND studied-every-day) structurally unreachable —
    // exactly why the weights are equal thirds, not e.g. 0.4/0.3/0.3.
    const studiedOnly = makeCareDay("d", "perfect", { studied: true, fed: 0, clean: 0 });
    expect(dailyCareScore(studiedOnly)).toBeLessThan(CARE_OK);
    expect(careTier(dailyCareScore(studiedOnly))).toBe("neglect");
  });
  it("清潔充足 grace period: dirty time within CARE_CLEAN_GRACE_MS is free ('発生→次に開いた時に掃除、は無罪')", () => {
    const promptlyCleaned: CareDay = {
      date: "d",
      stage: "child",
      studied: true,
      newCount: 0,
      reviewCount: 0,
      feedCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: CARE_CLEAN_GRACE_MS - 1, // dirty, but under the grace window
      starvingMs: 0,
    };
    // Full marks on the clean component despite nonzero dirty time.
    expect(dailyCareScore(promptlyCleaned)).toBeCloseTo(CARE_WEIGHT_STUDY + CARE_WEIGHT_FEED + CARE_WEIGHT_CLEAN, 9);
  });
  it("清潔充足: only the EXCESS beyond the grace window is penalized", () => {
    const overGrace: CareDay = {
      date: "d",
      stage: "child",
      studied: true,
      newCount: 0,
      reviewCount: 0,
      feedCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: CARE_CLEAN_GRACE_MS + DAY_MS * 0.1, // 4h grace + 10% of the day excess
      starvingMs: 0,
    };
    const expectedCleanScore = 1 - 0.1; // only the excess fraction counts
    expect(dailyCareScore(overGrace)).toBeCloseTo(
      CARE_WEIGHT_STUDY + CARE_WEIGHT_FEED + CARE_WEIGHT_CLEAN * expectedCleanScore,
      9,
    );
  });
  it("給餌充足 OR-logic: EITHER the ratio target OR the count target alone is full marks", () => {
    // Ratio path: notStarvingRatio hits CARE_FEED_RATIO_TARGET exactly, zero feeds recorded.
    const ratioOnly: CareDay = {
      date: "d",
      stage: "child",
      studied: false,
      newCount: 0,
      reviewCount: 0,
      feedCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: 0,
      starvingMs: DAY_MS * (1 - CARE_FEED_RATIO_TARGET),
    };
    expect(dailyCareScore(ratioOnly)).toBeCloseTo(CARE_WEIGHT_FEED + CARE_WEIGHT_CLEAN, 9);

    // Count path: fully starving all day (ratio=0) but fed CARE_FEED_COUNT_TARGET times.
    const countOnly: CareDay = {
      date: "d",
      stage: "child",
      studied: false,
      newCount: 0,
      reviewCount: 0,
      feedCount: CARE_FEED_COUNT_TARGET,
      trackedMs: DAY_MS,
      dirtyMs: 0,
      starvingMs: DAY_MS,
    };
    expect(dailyCareScore(countOnly)).toBeCloseTo(CARE_WEIGHT_FEED + CARE_WEIGHT_CLEAN, 9);
  });
  it("a day with no tracked time (never caught up) scores feed/clean as neglected (studied still counts)", () => {
    const untracked: CareDay = {
      date: "d",
      stage: "child",
      studied: true,
      newCount: 0,
      reviewCount: 0,
      feedCount: 0,
      trackedMs: 0,
      dirtyMs: 0,
      starvingMs: 0,
    };
    expect(dailyCareScore(untracked)).toBeCloseTo(CARE_WEIGHT_STUDY, 9);
  });
  it("defensively handles rows missing starvingMs/feedCount/dirtyMs/trackedMs (pre-migration)", () => {
    const legacyRow = {
      date: "d",
      stage: "child" as PetStage,
      studied: true,
      newCount: 0,
      reviewCount: 0,
    } as CareDay; // simulates a pre-LINGO-053 row that somehow skipped migrateCareLog()
    expect(dailyCareScore(legacyRow)).toBeCloseTo(CARE_WEIGHT_STUDY, 9);
  });
  it("careTier: 良 ≥0.8 / 並 0.4–0.8 / 怠 <0.4 (thresholds unchanged by LINGO-053)", () => {
    expect(careTier(0.9)).toBe("good");
    expect(careTier(0.8)).toBe("good");
    expect(careTier(0.6)).toBe("ok");
    expect(careTier(0.4)).toBe("ok");
    expect(careTier(0.39)).toBe("neglect");
  });
  it("stageCareAvg penalizes missing days via the expected-days divisor", () => {
    // child spans 2 expected days; one perfect day + one missing day → half credit.
    const log = [makeCareDay("d2", "child", { studied: true, fed: 1, clean: 1 })];
    expect(stageCareAvg(log, "child")).toBeCloseTo(0.5, 9);
  });
  it("learningTendency: N when new ≥ review, else R", () => {
    const log = [makeCareDay("d", "child", { studied: true, fed: 1, clean: 1, newCount: 5, reviewCount: 2 })];
    expect(learningTendency(log, "child")).toBe("N");
    const log2 = [makeCareDay("d", "child", { studied: true, fed: 1, clean: 1, newCount: 1, reviewCount: 5 })];
    expect(learningTendency(log2, "child")).toBe("R");
  });
  it("studiedEveryDayInStage gates the hidden 魔王 path", () => {
    const perfect3 = ["p1", "p2", "p3"].map((d) => makeCareDay(d, "perfect", { studied: true, fed: 0, clean: 0 }));
    expect(studiedEveryDayInStage(perfect3, "perfect")).toBe(true);
    const perfect2 = ["p1", "p2"].map((d) => makeCareDay(d, "perfect", { studied: true, fed: 0, clean: 0 }));
    expect(studiedEveryDayInStage(perfect2, "perfect")).toBe(false);
  });
});

// --- evolution branch table: 1:1 with design §3 (all 16 species + DEPART) ---
// branchSpecies takes already-computed priorCare/tendency inputs, so it is
// entirely unaffected by the poop-stock/cleanliness rework above — these
// cases are unchanged from the original LINGO-029 implementation and still
// hold under the new score definition (branchSpecies never looks at CareDay
// shape directly).

describe("branchSpecies: design §3 branch table (all 16種)", () => {
  const GOOD = 0.9;
  const OK = 0.6;
  const NEGLECT = 0.2;
  const base = { studyStreak: 0, priorStudiedEveryDay: false };

  it("幼年期: 全系統 → モチ系 (mochi)", () => {
    expect(branchSpecies({ toStage: "baby", priorCare: GOOD, tendency: "N", ...base })).toBe("mochi");
    expect(branchSpecies({ toStage: "baby", priorCare: NEGLECT, tendency: "R", ...base })).toBe("mochi");
  });

  it("成長期: 良/並 → キュート系 (cutie), 怠 → ヨゴレ系 (grimy)", () => {
    expect(branchSpecies({ toStage: "child", priorCare: GOOD, tendency: "N", ...base })).toBe("cutie");
    expect(branchSpecies({ toStage: "child", priorCare: OK, tendency: "R", ...base })).toBe("cutie");
    expect(branchSpecies({ toStage: "child", priorCare: NEGLECT, tendency: "N", ...base })).toBe("grimy");
  });

  it("成熟期: 良×N → 勇者系 (hero), 良×R → 賢者系 (sage)", () => {
    expect(branchSpecies({ toStage: "adult", priorCare: GOOD, tendency: "N", ...base })).toBe("hero");
    expect(branchSpecies({ toStage: "adult", priorCare: GOOD, tendency: "R", ...base })).toBe("sage");
  });
  it("成熟期: 並×N → わんぱく系 (rascal), 並×R → まったり系 (mellow)", () => {
    expect(branchSpecies({ toStage: "adult", priorCare: OK, tendency: "N", ...base })).toBe("rascal");
    expect(branchSpecies({ toStage: "adult", priorCare: OK, tendency: "R", ...base })).toBe("mellow");
  });
  it("成熟期: 怠×N → イガイガ系 (spiky), 怠×R → ドロ系 (mud)", () => {
    expect(branchSpecies({ toStage: "adult", priorCare: NEGLECT, tendency: "N", ...base })).toBe("spiky");
    expect(branchSpecies({ toStage: "adult", priorCare: NEGLECT, tendency: "R", ...base })).toBe("mud");
  });
  it("成熟期: 連続学習7日ボーナス（良）→ 天使系 (angel, レア)", () => {
    expect(branchSpecies({ toStage: "adult", priorCare: GOOD, tendency: "N", studyStreak: 7, priorStudiedEveryDay: false })).toBe("angel");
    // Streak bonus only applies on top of 良 care — a 並 streak stays わんぱく.
    expect(branchSpecies({ toStage: "adult", priorCare: OK, tendency: "N", studyStreak: 7, priorStudiedEveryDay: false })).toBe("rascal");
  });

  it("完全体: 良 → 騎士系 (knight), 並 → 獣王系 (beast-king), 怠 → 暴走系 (berserk)", () => {
    expect(branchSpecies({ toStage: "perfect", priorCare: GOOD, tendency: "N", ...base })).toBe("knight");
    expect(branchSpecies({ toStage: "perfect", priorCare: OK, tendency: "N", ...base })).toBe("beast-king");
    expect(branchSpecies({ toStage: "perfect", priorCare: NEGLECT, tendency: "N", ...base })).toBe("berserk");
  });

  it("究極体: 良 → 聖竜系 (holy-dragon), 並 → 機神系 (mech-god)", () => {
    expect(branchSpecies({ toStage: "ultimate", priorCare: GOOD, tendency: "N", ...base })).toBe("holy-dragon");
    expect(branchSpecies({ toStage: "ultimate", priorCare: OK, tendency: "N", ...base })).toBe("mech-god");
  });
  it("究極体: 怠は完全体止まりで旅立ち（DEPART）", () => {
    expect(branchSpecies({ toStage: "ultimate", priorCare: NEGLECT, tendency: "N", studyStreak: 0, priorStudiedEveryDay: false })).toBe("DEPART");
  });
  it("究極体: 怠のまま完全体を維持 → 魔王系 (demon-lord, 隠し)", () => {
    expect(branchSpecies({ toStage: "ultimate", priorCare: NEGLECT, tendency: "N", studyStreak: 0, priorStudiedEveryDay: true })).toBe("demon-lord");
  });

  it("the branch table can reach every one of the 16 species", () => {
    const reachable = new Set<string>();
    const cares = [0.9, 0.6, 0.2];
    const stages: PetStage[] = ["baby", "child", "adult", "perfect", "ultimate"];
    for (const toStage of stages)
      for (const priorCare of cares)
        for (const tendency of ["N", "R"] as const)
          for (const studyStreak of [0, 7])
            for (const priorStudiedEveryDay of [false, true]) {
              const s = branchSpecies({ toStage, priorCare, tendency, studyStreak, priorStudiedEveryDay });
              if (s !== "DEPART") reachable.add(s);
            }
    expect(reachable.size).toBe(SPECIES_IDS.length);
    for (const id of SPECIES_IDS) expect(reachable.has(id)).toBe(true);
  });
});

// --- stage schedule ------------------------------------------------------

describe("stageForAgeDays: lifecycle schedule (design §2)", () => {
  it("maps age → stage across the 12-day life", () => {
    expect(stageForAgeDays(0)).toBe("baby");
    expect(stageForAgeDays(0.9)).toBe("baby");
    expect(stageForAgeDays(1)).toBe("child");
    expect(stageForAgeDays(3)).toBe("adult");
    expect(stageForAgeDays(6)).toBe("perfect");
    expect(stageForAgeDays(9)).toBe("ultimate");
    expect(stageForAgeDays(12)).toBe("depart");
    expect(stageForAgeDays(20)).toBe("depart");
  });
});

// --- tick integration: full lifecycles -----------------------------------

describe("tick: hatch + healthy 12-day lifecycle → 聖竜系, then 旅立ち", () => {
  it("evolves mochi → cutie → hero → knight → holy-dragon, then departs to a gen-2 egg", () => {
    let pet = newPet(1, T0);
    const events: PetEvent[] = [];
    for (let day = 0; day <= 12; day++) {
      const r = healthyDay(pet, day, { newCount: 5, reviewCount: 3 }); // N tendency (5≥3)
      pet = r.pet;
      events.push(...r.events);
    }
    const evolves = events.filter((e) => e.type === "evolve").map((e) => e.speciesId);
    expect(events.find((e) => e.type === "hatch")?.speciesId).toBe("mochi");
    expect(evolves).toEqual(["cutie", "hero", "knight", "holy-dragon"]);
    const depart = events.find((e) => e.type === "depart");
    expect(depart?.reason).toBe("natural");
    expect(depart?.speciesId).toBe("holy-dragon");
    // Departed individual left a gen-2 egg with the streak carried forward.
    expect(pet.generation).toBe(2);
    expect(pet.stage).toBe("egg");
    expect(pet.studyStreak).toBe(13);

    const collection = recordDiscoveriesFromEvents([], events);
    expect(discoveredSpecies(collection)).toEqual(new Set(["mochi", "cutie", "hero", "knight", "holy-dragon"]));
  });
});

describe("tick: early 旅立ち on 3-day abandonment (design §2)", () => {
  it("departs (reason 'early') and lays a gen-2 egg when unstudied for 3 days", () => {
    const pet = newPet(1, T0); // never studied
    const r = tick(pet, { now: at(3), overdueCount: 5 });
    const depart = r.events.find((e) => e.type === "depart");
    expect(depart?.reason).toBe("early");
    expect(r.pet.generation).toBe(2);
    expect(r.pet.stage).toBe("egg");
  });

  // LINGO-032 QA (carried forward unchanged — pure abandonment timing, no poop
  // involved): the abandon window's exact boundary, measured from a real
  // lastStudyDate (not the bornAt fallback the case above exercises). A
  // learner who studied on day 0 and then stops must survive 2 idle calendar
  // days and depart on the 3rd — off-by-one here would either kill pets a day
  // early or let them linger forever.
  it("survives exactly 2 idle days but departs on the 3rd (measured from lastStudyDate)", () => {
    const studied = applySession(newPet(1, T0), { newCount: 1, reviewCount: 0 }, at(0)).pet;
    expect(studied.lastStudyDate).toBe(localDateStr(at(0)));

    const day2 = tick(studied, { now: at(2), overdueCount: 5 });
    expect(day2.events.some((e) => e.type === "depart")).toBe(false); // 2 idle days: still here
    expect(day2.pet.generation).toBe(1);
    expect(day2.pet.stage).toBe("child"); // aged into 成長期, kept growing

    const day3 = tick(studied, { now: at(3), overdueCount: 5 });
    expect(day3.events.find((e) => e.type === "depart")?.reason).toBe("early");
    expect(day3.pet.generation).toBe(2);
  });

  // LINGO-032 QA (carried forward unchanged): step ordering — abandonment is
  // checked BEFORE the natural day-12 departure. A pet that both hit day 12
  // AND went 3 days unstudied must read as an 'early' 旅立ち (the honest
  // signal = "you stopped studying"), not a 'natural' graduation it didn't earn.
  it("abandonment takes priority over the natural day-12 depart", () => {
    const pet = { ...newPet(1, T0), lastStudyDate: localDateStr(at(8)) }; // 4 idle days by day 12
    const r = tick(pet, { now: at(12), overdueCount: 5 });
    expect(r.events.find((e) => e.type === "depart")?.reason).toBe("early");
  });
});

// LINGO-032 had a "poop honesty" suite here asserting 掃除する left the
// visible poop untouched for a given overdueCount ("cleaning never fakes it
// away — only doing the overdue reviews clears it"). That was a precise
// description of the bug Katsuta reported 2026-09-05: spending 掃除P against a
// count *derived live from overdueCount* meant the button visibly did
// nothing. The v2 stock model inverts this on purpose — 掃除する now deletes
// real stock immediately (see "applyClean: instant 1-for-1 poop deletion"
// above) — so that suite is superseded, not carried forward.

describe("tick: 怠 at 完全体 (design §3 hidden/stall split at 究極体)", () => {
  // Build a pet sitting at 完全体 (berserk) at age ~9, whose 完全体 days were all
  // 怠 (fed=clean=0 — under the LINGO-053 additive formula, studied alone
  // caps out at 1/3 < CARE_OK, so this is genuinely neglect tier even on the
  // studied days — see "a studied-only day... preserves the マオウガ 隠し条件's
  // reachability" above). Whether it reaches 魔王系 or 旅立ちs depends only on
  // whether the learner studied every 完全体 day ("維持した").
  function neglectedPerfect(studiedDays: string[]): PetState {
    const perfectDates = [localDateStr(at(6)), localDateStr(at(7)), localDateStr(at(8))];
    const careLog = perfectDates.map((d) =>
      makeCareDay(d, "perfect", { studied: studiedDays.includes(d), fed: 0, clean: 0 }),
    );
    return {
      ...newPet(1, T0),
      stage: "perfect",
      speciesId: "berserk",
      careLog,
      // Studied recently enough that the abandonment check doesn't fire first.
      lastStudyDate: localDateStr(at(8)),
    };
  }

  it("怠 + studied every 完全体 day → 魔王系 (demon-lord)", () => {
    const pet = neglectedPerfect([localDateStr(at(6)), localDateStr(at(7)), localDateStr(at(8))]);
    const r = tick(pet, { now: at(9), overdueCount: 5 }); // day9: perfect → ultimate
    expect(r.pet.stage).toBe("ultimate");
    expect(r.pet.speciesId).toBe("demon-lord");
    expect(r.events.some((e) => e.type === "evolve" && e.speciesId === "demon-lord")).toBe(true);
  });

  it("怠 + a missed study day → 完全体止まりで旅立ち (perfect-stall)", () => {
    const pet = neglectedPerfect([localDateStr(at(7)), localDateStr(at(8))]); // day6 missed
    const r = tick(pet, { now: at(9), overdueCount: 5 });
    const depart = r.events.find((e) => e.type === "depart");
    expect(depart?.reason).toBe("perfect-stall");
    expect(depart?.speciesId).toBe("berserk"); // departed as its 完全体 form
    expect(r.pet.generation).toBe(2);
  });
});

// --- migration (v2, 2026-09-05 poop-stock overhaul; v3, 2026-09-08 poopProgressMs) --

describe("migrateLegacyPet: additive-only poopCount/poopAccruedAt/poopProgressMs backfill", () => {
  it("seeds poopCount from the current overdue count, clamped to MAX_POOP", () => {
    const legacy = { ...newPet(1, T0) } as any;
    delete legacy.poopCount;
    delete legacy.poopAccruedAt;
    delete legacy.poopProgressMs;
    const migrated = migrateLegacyPet(legacy, at(1), 3);
    expect(migrated.poopCount).toBe(3);
    expect(migrated.poopAccruedAt).toBe(at(1));
    expect(migrated.poopProgressMs).toBe(0);
  });
  it("clamps an overdue seed above MAX_POOP", () => {
    const legacy = { ...newPet(1, T0) } as any;
    delete legacy.poopCount;
    delete legacy.poopAccruedAt;
    delete legacy.poopProgressMs;
    const migrated = migrateLegacyPet(legacy, at(1), 999);
    expect(migrated.poopCount).toBe(MAX_POOP);
  });
  it("leaves every other field untouched (additive-only)", () => {
    const legacy = { ...newPet(1, T0), foodCount: 7, cleanPoints: 2, studyStreak: 4 } as any;
    delete legacy.poopCount;
    delete legacy.poopAccruedAt;
    delete legacy.poopProgressMs;
    const migrated = migrateLegacyPet(legacy, at(1), 0);
    expect(migrated.foodCount).toBe(7);
    expect(migrated.cleanPoints).toBe(2);
    expect(migrated.studyStreak).toBe(4);
  });
  it("is idempotent — an already-migrated pet passes through unchanged", () => {
    const pet = { ...newPet(1, T0), poopCount: 2, poopAccruedAt: T0, poopProgressMs: 5000 };
    const result = migrateLegacyPet(pet, at(5), 4); // different now/overdue: must be ignored
    expect(result).toBe(pet); // same reference — no-op
    expect(result.poopCount).toBe(2);
    expect(result.poopAccruedAt).toBe(T0);
    expect(result.poopProgressMs).toBe(5000);
  });
  // LINGO-035 (2026-09-08): a pet already migrated to v2 (has real poopCount/
  // poopAccruedAt) but persisted before poopProgressMs existed — only the new
  // field should backfill, the real v2 values must be PRESERVED, not reset.
  it("v2→v3 sub-migration: backfills only poopProgressMs, preserving real poopCount/poopAccruedAt", () => {
    const v2Pet = { ...newPet(1, T0), poopCount: 4, poopAccruedAt: at(2) } as any;
    delete v2Pet.poopProgressMs;
    const migrated = migrateLegacyPet(v2Pet, at(5), 999); // overdueCountForMigration must be ignored here
    expect(migrated.poopCount).toBe(4); // preserved, NOT re-seeded from overdue=999
    expect(migrated.poopAccruedAt).toBe(at(2)); // preserved, NOT reset to `now`
    expect(migrated.poopProgressMs).toBe(0); // freshly backfilled
  });
});

// LINGO-053 (2026-09-18): 「過去のcareLogは再解釈（新スコアで再計算できる形なら
// 遡及）」— starvingMs/feedCount didn't exist before this task, but the OLD
// per-visit fedSum/fedN samples (design §1 v2's sampling) are still present in
// any pre-LINGO-053 row, so migrateCareLog() re-interprets them as an
// approximate feed score under the NEW formula rather than discarding history
// and starting the pet's care record over from today. dirtyMs/trackedMs need
// no approximation at all — their meaning is unchanged, so 清潔充足 recomputes
// EXACTLY under the new grace-period formula.
describe("migrateCareLog: 遡及 — re-interprets old fedSum/fedN rows under the new formula", () => {
  it("backfills starvingMs from the legacy per-visit fedRatio as an approximate proxy", () => {
    const legacyRow = {
      date: "2026-01-01",
      stage: "baby" as PetStage,
      studied: true,
      newCount: 0,
      reviewCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: 0,
      fedSum: 0.8, // legacy: averaged 80% satiety across visit samples
      fedN: 1,
    } as unknown as CareDay;
    const [migrated] = migrateCareLog([legacyRow]);
    expect(migrated.starvingMs).toBeCloseTo((1 - 0.8) * DAY_MS, 9);
    expect(migrated.feedCount).toBe(0); // no historical record of feed taps — honest default
  });
  it("a legacy row with fedRatio=1 (always fully fed when sampled) backfills to zero starving time", () => {
    const legacyRow = {
      date: "2026-01-01",
      stage: "baby" as PetStage,
      studied: true,
      newCount: 0,
      reviewCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: 0,
      fedSum: 3,
      fedN: 3, // ratio = 1
    } as unknown as CareDay;
    const [migrated] = migrateCareLog([legacyRow]);
    expect(migrated.starvingMs).toBeCloseTo(0, 9);
  });
  it("dirtyMs/trackedMs pass through untouched — no approximation needed for 清潔充足", () => {
    const legacyRow = {
      date: "2026-01-01",
      stage: "baby" as PetStage,
      studied: true,
      newCount: 0,
      reviewCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: DAY_MS * 0.3,
      fedSum: 1,
      fedN: 1,
    } as unknown as CareDay;
    const [migrated] = migrateCareLog([legacyRow]);
    expect(migrated.dirtyMs).toBe(DAY_MS * 0.3);
    expect(migrated.trackedMs).toBe(DAY_MS);
  });
  it("is idempotent — a row already in the new shape passes through with the SAME array reference", () => {
    const modernRow = makeCareDay("2026-01-01", "baby", { studied: true, fed: 1, clean: 1 });
    const log = [modernRow];
    expect(migrateCareLog(log)).toBe(log);
  });
  it("an empty careLog returns the same reference", () => {
    const log: CareDay[] = [];
    expect(migrateCareLog(log)).toBe(log);
  });
  it("a mixed log migrates only the legacy rows, leaving modern rows byte-identical", () => {
    const modernRow = makeCareDay("2026-01-02", "baby", { studied: true, fed: 1, clean: 1 });
    const legacyRow = {
      date: "2026-01-01",
      stage: "baby" as PetStage,
      studied: true,
      newCount: 0,
      reviewCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: 0,
      fedSum: 0.5,
      fedN: 1,
    } as unknown as CareDay;
    const [migratedLegacy, migratedModern] = migrateCareLog([legacyRow, modernRow]);
    expect(migratedLegacy.starvingMs).toBeCloseTo(0.5 * DAY_MS, 9);
    expect(migratedModern).toEqual(modernRow);
  });
  it("migrateLegacyPet composes migrateCareLog automatically (careLog re-migrates even when poop fields are already current)", () => {
    const legacyRow = {
      date: "2026-01-01",
      stage: "baby" as PetStage,
      studied: true,
      newCount: 0,
      reviewCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: 0,
      fedSum: 0.6,
      fedN: 1,
    } as unknown as CareDay;
    const pet = { ...newPet(1, T0), careLog: [legacyRow] } as any; // poopCount/poopAccruedAt/poopProgressMs already current (from newPet)
    const migrated = migrateLegacyPet(pet, at(1), 0);
    expect(migrated.careLog[0].starvingMs).toBeCloseTo((1 - 0.6) * DAY_MS, 9);
    expect(migrated.careLog[0].feedCount).toBe(0);
  });
});

// --- economy caps (LINGO-034, 2026-09-07) ---------------------------------

describe("clampEconomy: retroactive pocket-cap normalization", () => {
  it("clamps foodCount/cleanPoints down to the caps when over", () => {
    const pet = { ...newPet(1, T0), foodCount: 40, cleanPoints: 9 };
    const clamped = clampEconomy(pet);
    expect(clamped.foodCount).toBe(MAX_FOOD);
    expect(clamped.cleanPoints).toBe(MAX_CLEAN_POINTS);
  });
  it("is a no-op (same reference) for a pet already within both caps", () => {
    const pet = { ...newPet(1, T0), foodCount: 3, cleanPoints: 1 };
    expect(clampEconomy(pet)).toBe(pet);
  });
  it("is a no-op at the exact boundary (== cap, not >)", () => {
    const pet = { ...newPet(1, T0), foodCount: MAX_FOOD, cleanPoints: MAX_CLEAN_POINTS };
    expect(clampEconomy(pet)).toBe(pet);
  });
  it("clamps only whichever of the two is over, leaving the other untouched", () => {
    const pet = { ...newPet(1, T0), foodCount: 999, cleanPoints: 1 };
    const clamped = clampEconomy(pet);
    expect(clamped.foodCount).toBe(MAX_FOOD);
    expect(clamped.cleanPoints).toBe(1);
  });
  it("touches nothing else on the pet", () => {
    const pet = { ...newPet(1, T0), foodCount: 999, poopCount: 3, studyStreak: 5 };
    const clamped = clampEconomy(pet);
    expect(clamped.poopCount).toBe(3);
    expect(clamped.studyStreak).toBe(5);
  });
});

// --- 図鑑 (collection) ----------------------------------------------------

describe("recordDiscovery: 図鑑 keeps the first sighting", () => {
  it("dedups by speciesId", () => {
    let c = recordDiscovery([], "mochi", 1, T0);
    c = recordDiscovery(c, "mochi", 3, at(30)); // already known → ignored
    c = recordDiscovery(c, "cutie", 1, at(1));
    expect(c).toHaveLength(2);
    expect(c[0]).toEqual({ speciesId: "mochi", generation: 1, reachedAt: T0 });
  });
  it("depart events add nothing (already recorded when reached)", () => {
    const events: PetEvent[] = [
      { type: "hatch", speciesId: "mochi", stage: "baby", generation: 1, at: T0 },
      { type: "evolve", speciesId: "grimy", stage: "child", generation: 1, at: at(1) },
      { type: "depart", speciesId: "grimy", stage: "child", generation: 1, at: at(2), reason: "early" },
    ];
    const c = recordDiscoveriesFromEvents([], events);
    expect(discoveredSpecies(c)).toEqual(new Set(["mochi", "grimy"]));
  });
});

// --- display snapshot ----------------------------------------------------

describe("petSnapshot: pure UI read-model", () => {
  it("exposes derived display values without mutating", () => {
    const pet = { ...newPet(3, T0), foodCount: 4, cleanPoints: 2, poopCount: 3 };
    const snap = petSnapshot(pet, T0 + HUNGER_DECAY_MS / 2);
    expect(snap.generation).toBe(3);
    expect(snap.satiety).toBeCloseTo(50, 9);
    expect(snap.poop).toBe(3);
    expect(snap.ageDays).toBeCloseTo(HUNGER_DECAY_MS / 2 / DAY_MS, 9);
    expect(snap.asleep).toBe(false); // sleep disabled on this test pet (see newPet() shadow)
    expect(snap.foodCount).toBe(4);
  });
  it("poop reflects the stored stock, not a live overdue recompute (v2 semantics)", () => {
    // Even though petSnapshot no longer takes overdueCount, the value shown
    // is whatever the stock was as of the last tick() catch-up — proving the
    // snapshot can't silently "self-heal" poop from live overdue data.
    const pet = { ...newPet(1, T0), poopCount: 4 };
    expect(petSnapshot(pet, T0 + 999 * DAY_MS).poop).toBe(4);
  });
});

describe("calendarDayDiff helper", () => {
  it("counts whole calendar days regardless of wall-clock time", () => {
    expect(calendarDayDiff(localDateStr(at(0)), localDateStr(at(3)))).toBe(3);
    expect(calendarDayDiff(localDateStr(T0), localDateStr(T0 + 1000))).toBe(0);
  });
});


// LINGO-053 (2026-09-18, Katsuta report): "毎日学習・世話しているのに
// ヨゴレン→トゲロ→バーサ→マオウガと最底辺ルート固定". Root cause: the OLD
// dailyCareScore = fedRatio × cleanRatio × studiedFlag PRODUCT (design §1 v2,
// 2026-09-05 — superseded by this task, not carried forward as live code, same
// as LINGO-032's "poop honesty" suite before it) meant realistic-but-imperfect
// care on ANY ONE axis tanked the WHOLE day's score.
//
// Concrete reproduction against the pre-LINGO-053 engine (captured 2026-09-18,
// before this task's changes — the exact per-visit-sample fedRatio/dirtyMs
// mechanism this multiplied together no longer exists in the codebase to
// re-run live, so this is the recorded evidence rather than a runnable test):
// a persona opening the app 3×/day (09:00/14:00/21:00), feeding twice/day,
// cleaning at every open, studying every day, default 23:00-08:00 sleep —
// scored 0.663 → 0.319 → 0.089 → 0.007 → 0.006 across 5 consecutive days, with
// stageCareAvg("child") = 0.048 (careTier: "neglect"). That's a learner doing
// everything right, permanently parked in the 怠 branch.
describe("care score realism (LINGO-053): old formula's fragility vs. the new one's resilience", () => {
  it("old formula (documented, not live code): realistic imperfect care compounds toward neglect", () => {
    const oldFormula = (fedRatio: number, cleanRatio: number, studied: boolean) =>
      fedRatio * cleanRatio * (studied ? 1 : 0);
    // A learner who's fed/cleaned well but not perfectly (85% each — a very
    // reasonable real-world outcome for 2-3 visits/day) already misses "good":
    expect(oldFormula(0.85, 0.85, true)).toBeLessThan(CARE_GOOD); // 0.7225 < 0.8
    // A still-clearly-diligent-but-imperfect day (60% each — well within the
    // range the 2026-09-18 reproduction's actual fedSum/dirtyMs samples fell
    // to after a couple of days) drops all the way into neglect DESPITE
    // studying:
    expect(oldFormula(0.6, 0.6, true)).toBeLessThan(CARE_OK); // 0.36 < 0.4: neglect despite daily study
  });
  it("new formula: the SAME 60%/60% realistic-imperfect day scores comfortably above CARE_OK", () => {
    const day = makeCareDay("d", "child", { studied: true, fed: 0.6, clean: 0.6 });
    expect(dailyCareScore(day)).toBeGreaterThanOrEqual(CARE_OK);
    // In fact it's already "good" — one imperfect axis no longer drags the
    // other two down with it (CARE_WEIGHT_STUDY alone is 1/3 ≈ 0.333, plus
    // 1/3 of 0.6 twice more ≈ 0.4, totalling 0.733 — see the exact-value test
    // above in "care scoring" for the precise formula).
  });
});

describe("care score realism (LINGO-053): persona simulations pinned to the target tiers", () => {
  // 毎日型: opens the app 2-3×/day (09:00/14:00/21:00), feeds twice/day,
  // cleans at every open, studies once/day, real default sleep window
  // (23:00-08:00 — decay/accrual pause overnight per LINGO-035, so this
  // persona is exercising the REAL production defaults end to end, not the
  // sleep-disabled `newPet` shadow most other tests in this file use).
  it("毎日型 (daily engagement) lands 良 (>=0.8) for both baby and child stages", () => {
    let p = newPetWithSleep(1, T0);
    const opens = [9 * H, 14 * H, 21 * H];
    for (let day = 0; day < 6; day++) {
      const dayStart = T0 + day * DAY_MS;
      for (let i = 0; i < opens.length; i++) {
        const now = dayStart + opens[i];
        if (i === 0) p = applySession(p, { newCount: 8, reviewCount: 5 }, now).pet;
        p = tick(p, { now, overdueCount: 2 }).pet;
        if (i < 2) p = applyFeed(p, now); // 2 feeds/day
        while (p.poopCount > 0 && p.cleanPoints > 0) p = applyClean(p);
      }
    }
    expect(careTier(stageCareAvg(p.careLog, "baby"))).toBe("good");
    expect(careTier(stageCareAvg(p.careLog, "child"))).toBe("good");
  });

  // 週2-3回型: opens/studies/feeds/cleans only every 2 days (~3-4×/week, the
  // upper end of "2-3回" — any wider gap risks tripping the UNRELATED 3-day
  // abandonment mechanism, which this persona deliberately stays under so
  // there's an actual multi-day stage average left to grade). Lighter
  // engagement per visit than 毎日型 (feeds twice but only once every 2 days,
  // so satiety genuinely dips for a large fraction of the gap) — a real
  // "checks in occasionally, doesn't fuss over it" pattern.
  it("週2-3回型 (occasional engagement) lands 並 (0.4–0.8) for the child stage", () => {
    let p = newPetWithSleep(1, T0);
    for (let day = 0; day <= 5; day += 2) {
      const dayStart = T0 + day * DAY_MS;
      const now = dayStart + 12 * H;
      p = applySession(p, { newCount: 8, reviewCount: 9 }, now).pet;
      p = tick(p, { now, overdueCount: 2 }).pet;
      p = applyFeed(p, now);
      p = applyFeed(p, now);
      while (p.poopCount > 0 && p.cleanPoints > 0) p = applyClean(p);
    }
    // child (design §2: age 1-3 days, expectedStageDays=2) is fully covered
    // by this window's dates without crossing into a THIRD stage's boundary
    // ambiguity (see mergeCareMs's "no per-historical-day stage tracking"
    // doc comment — a date's stage tag reflects whichever tick call touched
    // it, which can lag the exact age-based transition for dates spanned by
    // an offline catch-up; child's 2 expected dates land cleanly here).
    expect(careTier(stageCareAvg(p.careLog, "child"))).toBe("ok");
  });

  // 3日放置型: zero engagement for 3+ consecutive calendar days triggers the
  // EXISTING early-abandonment mechanism (design §2, tested thoroughly in
  // "tick: early 旅立ち on 3-day abandonment" above) — this persona's
  // real-world consequence already IS "旅立ち", which is a stronger and more
  // immediate signal than a mere neglect-tier stage average. This test pins
  // that the two systems agree: the abandonment path fires (as already
  // covered elsewhere), AND separately, dailyCareScore correctly reads a
  // genuinely untouched day (no study, no feed, no clean — poop and hunger
  // left to drift) as neglect, so if a future change ever let a pet survive
  // 3 idle days some other way, the care-tier system would still catch it.
  it("3日放置型 (abandon) — early departure fires, matching the existing 3-day rule (design §2)", () => {
    const pet = newPetWithSleep(1, T0); // never studied, never opened again
    const r = tick(pet, { now: T0 + 3 * DAY_MS, overdueCount: 5 });
    const depart = r.events.find((e) => e.type === "depart");
    expect(depart?.reason).toBe("early");
  });
  it("3日放置型 — a genuinely untouched day (no study/feed/clean) scores neglect", () => {
    const untouched: CareDay = {
      date: "d",
      stage: "child",
      studied: false,
      newCount: 0,
      reviewCount: 0,
      feedCount: 0,
      trackedMs: DAY_MS,
      dirtyMs: DAY_MS, // never cleaned, poop present the whole day
      starvingMs: DAY_MS, // never fed, satiety at 0 the whole day
    };
    expect(careTier(dailyCareScore(untouched))).toBe("neglect");
  });
});
