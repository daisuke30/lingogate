import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  FEED_RESTORE,
  MAX_POOP,
  POOP_INTERVAL_MAX_MS,
  POOP_INTERVAL_MIN_MS,
  SPECIES_IDS,
  poopIntervalMs,
  newPet,
  migrateLegacyPet,
  satietyAt,
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
import type { CareDay, PetState, PetStage, PetEvent } from "./engine";

// Fixed local clock: Jan 1 2026 09:00. Adding exact 24h keeps the wall time and
// rolls the calendar date by one, so real-time age and calendar-day math both
// stay clean and deterministic (no DST edges in January).
const T0 = new Date(2026, 0, 1, 9, 0, 0, 0).getTime();
const at = (day: number) => T0 + day * DAY_MS;

// --- helpers -------------------------------------------------------------

/** CareDay fixture — `clean` is the desired cleanRatio (0..1), expressed as a
 * dirty/tracked ms split over a unit "day" so dailyCareScore's ratio math
 * comes out exactly as specified without needing real ms magnitudes. */
function makeCareDay(
  date: string,
  stage: PetStage,
  o: { studied: boolean; fed: number; clean: number; newCount?: number; reviewCount?: number },
): CareDay {
  return {
    date,
    stage,
    studied: o.studied,
    newCount: o.newCount ?? 0,
    reviewCount: o.reviewCount ?? 0,
    fedSum: o.fed,
    fedN: 1,
    trackedMs: 1,
    dirtyMs: 1 - o.clean,
  };
}

function feedFull(pet: PetState, now: number): PetState {
  let p = pet;
  for (let i = 0; i < 4; i++) p = applyFeed(p, now); // 4×34 ≥ 100
  return p;
}

/** A well-tended day under the v2 (2026-09-05) poop-stock model: study enough
 * to earn a 掃除P, fill the belly, tick (which spawns poop at overdueCount's
 * rate), then immediately clean up whatever spawned — mirroring a learner who
 * opens the app once a day and always taps 掃除する. With overdueCount=0 the
 * spawn interval equals exactly one day (POOP_INTERVAL_MAX_MS = DAY_MS), so a
 * poop lands right at the end of each day's span and is cleaned before it can
 * accumulate any real dirty time — cleanRatio stays ~1, same as the old
 * "always clean" fixture used to assert for the healthy-lifecycle path. */
function healthyDay(pet: PetState, day: number, tendency: { newCount: number; reviewCount: number }) {
  let p = applySession(pet, tendency, at(day)).pet;
  p = feedFull(p, at(day));
  const r = tick(p, { now: at(day), overdueCount: 0 });
  p = r.pet;
  while (p.poopCount > 0 && p.cleanPoints > 0) p = applyClean(p);
  return { pet: p, events: r.events };
}

// --- core mappings (design §1) ------------------------------------------

describe("satietyAt: 満腹度 linear 24h decay (design §1)", () => {
  const pet = newPet(1, T0);
  it("is full right after feeding", () => {
    expect(satietyAt(pet, T0)).toBe(100);
  });
  it("halves at 12h, empties at 24h, clamps below zero", () => {
    expect(satietyAt(pet, T0 + DAY_MS / 2)).toBeCloseTo(50, 9);
    expect(satietyAt(pet, T0 + DAY_MS)).toBe(0);
    expect(satietyAt(pet, T0 + 2 * DAY_MS)).toBe(0);
  });
});

describe("poopIntervalMs: spawn rate vs overdue count (design §1 v2, 2026-09-05)", () => {
  it("matches the coordinator's three worked examples", () => {
    expect(poopIntervalMs(0)).toBeCloseTo(24 * 60 * 60 * 1000, -2); // overdue 0 → 24h (exact)
    expect(poopIntervalMs(10)).toBeCloseTo(8 * 60 * 60 * 1000, -2); // overdue 10 → 8h (exact, the anchor)
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

describe("onSessionCommitted: 餌/掃除P earnings (design §1)", () => {
  it("new card = +2 餌, review = +1 餌", () => {
    expect(onSessionCommitted({ newCount: 3, reviewCount: 0 }).food).toBe(6);
    expect(onSessionCommitted({ newCount: 0, reviewCount: 4 }).food).toBe(4);
    expect(onSessionCommitted({ newCount: 3, reviewCount: 4 }).food).toBe(10);
  });
  it("3 reviews = +1 掃除P (floored)", () => {
    expect(onSessionCommitted({ newCount: 0, reviewCount: 7 }).cleanPoints).toBe(2);
    expect(onSessionCommitted({ newCount: 0, reviewCount: 2 }).cleanPoints).toBe(0);
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
  it("adds earnings and marks today studied with N/R counts", () => {
    const { pet, earned } = applySession(newPet(1, T0), { newCount: 5, reviewCount: 6 }, T0);
    expect(earned).toEqual({ food: 16, cleanPoints: 2 });
    expect(pet.foodCount).toBe(16);
    expect(pet.cleanPoints).toBe(2);
    const today = pet.careLog[0];
    expect(today.studied).toBe(true);
    expect(today.newCount).toBe(5);
    expect(today.reviewCount).toBe(6);
    expect(pet.studyStreak).toBe(1);
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
});

// --- care scoring --------------------------------------------------------

describe("care scoring (design §1 v2, 2026-09-05: time-weighted cleanliness)", () => {
  it("dailyCareScore = fedRatio × cleanRatio × studiedFlag", () => {
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: true, fed: 1, clean: 1 }))).toBe(1);
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: false, fed: 1, clean: 1 }))).toBe(0);
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: true, fed: 0.5, clean: 0.6 }))).toBeCloseTo(0.3, 9);
  });
  it("cleanRatio = 1 - dirtyMs/trackedMs (fraction of the day NOT left dirty)", () => {
    const mostlyClean: CareDay = {
      date: "d",
      stage: "child",
      studied: true,
      newCount: 0,
      reviewCount: 0,
      fedSum: 1,
      fedN: 1,
      trackedMs: DAY_MS,
      dirtyMs: DAY_MS * 0.1, // dirty for just 10% of the day
    };
    expect(dailyCareScore(mostlyClean)).toBeCloseTo(0.9, 9);
  });
  it("a day with no tracked time (never caught up) scores as neglected, not crashes", () => {
    const untracked: CareDay = {
      date: "d",
      stage: "child",
      studied: true,
      newCount: 0,
      reviewCount: 0,
      fedSum: 1,
      fedN: 1,
      trackedMs: 0,
      dirtyMs: 0,
    };
    expect(dailyCareScore(untracked)).toBe(0);
  });
  it("defensively handles pre-v2 persisted rows missing dirtyMs/trackedMs", () => {
    const legacyRow = {
      date: "d",
      stage: "child" as PetStage,
      studied: true,
      newCount: 0,
      reviewCount: 0,
      fedSum: 1,
      fedN: 1,
    } as CareDay; // simulates a pre-migration IndexedDB row (fields absent at runtime)
    expect(dailyCareScore(legacyRow)).toBe(0);
  });
  it("careTier: 良 ≥0.8 / 並 0.4–0.8 / 怠 <0.4", () => {
    expect(careTier(0.9)).toBe("good");
    expect(careTier(0.8)).toBe("good");
    expect(careTier(0.6)).toBe("ok");
    expect(careTier(0.4)).toBe("ok");
    expect(careTier(0.39)).toBe("neglect");
  });
  it("stageCareAvg penalizes missing days via the expected-days divisor", () => {
    // child spans 2 expected days; one perfect day + one missing day → 0.5 avg.
    const log = [makeCareDay("d2", "child", { studied: true, fed: 1, clean: 1 })];
    expect(stageCareAvg(log, "child")).toBe(0.5);
  });
  it("learningTendency: N when new ≥ review, else R", () => {
    const log = [makeCareDay("d", "child", { studied: true, fed: 1, clean: 1, newCount: 5, reviewCount: 2 })];
    expect(learningTendency(log, "child")).toBe("N");
    const log2 = [makeCareDay("d", "child", { studied: true, fed: 1, clean: 1, newCount: 1, reviewCount: 5 })];
    expect(learningTendency(log2, "child")).toBe("R");
  });
  it("studiedEveryDayInStage gates the hidden 魔王 path", () => {
    const perfect3 = ["p1", "p2", "p3"].map((d) => makeCareDay(d, "perfect", { studied: true, fed: 0.5, clean: 0.6 }));
    expect(studiedEveryDayInStage(perfect3, "perfect")).toBe(true);
    const perfect2 = ["p1", "p2"].map((d) => makeCareDay(d, "perfect", { studied: true, fed: 0.5, clean: 0.6 }));
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
      const r = healthyDay(pet, day, { newCount: 5, reviewCount: 3 }); // N tendency (5≥3), earns 1 掃除P/day
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
  // 怠 (low cleanRatio). Whether it reaches 魔王系 or 旅立ちs depends only on
  // whether the learner studied every 完全体 day ("維持した").
  function neglectedPerfect(studiedDays: string[]): PetState {
    const perfectDates = [localDateStr(at(6)), localDateStr(at(7)), localDateStr(at(8))];
    const careLog = perfectDates.map((d) =>
      makeCareDay(d, "perfect", { studied: studiedDays.includes(d), fed: 0.5, clean: 0.6 }),
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

// --- migration (v2, 2026-09-05 poop-stock overhaul) -----------------------

describe("migrateLegacyPet: additive-only poopCount/poopAccruedAt backfill", () => {
  it("seeds poopCount from the current overdue count, clamped to MAX_POOP", () => {
    const legacy = { ...newPet(1, T0) } as any;
    delete legacy.poopCount;
    delete legacy.poopAccruedAt;
    const migrated = migrateLegacyPet(legacy, at(1), 3);
    expect(migrated.poopCount).toBe(3);
    expect(migrated.poopAccruedAt).toBe(at(1));
  });
  it("clamps an overdue seed above MAX_POOP", () => {
    const legacy = { ...newPet(1, T0) } as any;
    delete legacy.poopCount;
    delete legacy.poopAccruedAt;
    const migrated = migrateLegacyPet(legacy, at(1), 999);
    expect(migrated.poopCount).toBe(MAX_POOP);
  });
  it("leaves every other field untouched (additive-only)", () => {
    const legacy = { ...newPet(1, T0), foodCount: 7, cleanPoints: 2, studyStreak: 4 } as any;
    delete legacy.poopCount;
    delete legacy.poopAccruedAt;
    const migrated = migrateLegacyPet(legacy, at(1), 0);
    expect(migrated.foodCount).toBe(7);
    expect(migrated.cleanPoints).toBe(2);
    expect(migrated.studyStreak).toBe(4);
  });
  it("is idempotent — an already-migrated pet passes through unchanged", () => {
    const pet = { ...newPet(1, T0), poopCount: 2, poopAccruedAt: T0 };
    const result = migrateLegacyPet(pet, at(5), 4); // different now/overdue: must be ignored
    expect(result).toBe(pet); // same reference — no-op
    expect(result.poopCount).toBe(2);
    expect(result.poopAccruedAt).toBe(T0);
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
    const snap = petSnapshot(pet, T0 + DAY_MS / 2);
    expect(snap.generation).toBe(3);
    expect(snap.satiety).toBeCloseTo(50, 9);
    expect(snap.poop).toBe(3);
    expect(snap.ageDays).toBeCloseTo(0.5, 9);
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
