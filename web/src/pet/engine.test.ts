import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  FEED_RESTORE,
  MAX_POOP,
  CLEAN_GRACE_MS,
  SPECIES_IDS,
  newPet,
  satietyAt,
  poopCount,
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
    cleanSum: o.clean,
    cleanN: 1,
  };
}

function feedFull(pet: PetState, now: number): PetState {
  let p = pet;
  for (let i = 0; i < 4; i++) p = applyFeed(p, now); // 4×34 ≥ 100
  return p;
}

/** A perfectly-tended day: study, fill the belly, no overdue reviews → daily
 * care score ≈ 1. Returns the ticked pet + events. */
function healthyDay(pet: PetState, day: number, tendency: { newCount: number; reviewCount: number }) {
  let p = applySession(pet, tendency, at(day)).pet;
  p = feedFull(p, at(day));
  return tick(p, { now: at(day), overdueCount: 0 });
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

describe("poopCount: overdue-review mapping (design §1, clamp 0..5)", () => {
  it("is zero when nothing is overdue", () => {
    expect(poopCount(0)).toBe(0);
    expect(poopCount(-3)).toBe(0);
  });
  it("tracks the overdue count and clamps at MAX_POOP", () => {
    expect(poopCount(3)).toBe(3);
    expect(poopCount(5)).toBe(MAX_POOP);
    expect(poopCount(50)).toBe(MAX_POOP);
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

describe("applyClean", () => {
  it("consumes one 掃除P and opens a clean-grace window", () => {
    const pet = { ...newPet(1, T0), cleanPoints: 2 };
    const cleaned = applyClean(pet, 4, T0);
    expect(cleaned.cleanPoints).toBe(1);
    expect(cleaned.lastCleanedAt).toBe(T0);
  });
  it("is a no-op with no 掃除P or nothing to clean", () => {
    const noPts = { ...newPet(1, T0), cleanPoints: 0 };
    expect(applyClean(noPts, 4, T0)).toBe(noPts);
    const noPoop = { ...newPet(1, T0), cleanPoints: 2 };
    expect(applyClean(noPoop, 0, T0)).toBe(noPoop);
  });
  it("clean grace expires after CLEAN_GRACE_MS", () => {
    const pet = { ...newPet(1, T0), cleanPoints: 1, lastCleanedAt: T0 };
    // A day sampled within grace scores clean=1; beyond it, poop drags it down.
    const withinGrace = tick(pet, { now: T0 + CLEAN_GRACE_MS - 1, overdueCount: 5 });
    const dayA = withinGrace.pet.careLog[0];
    expect(dayA.cleanSum / dayA.cleanN).toBe(1);
    const pet2 = { ...newPet(1, T0), lastCleanedAt: T0 };
    const afterGrace = tick(pet2, { now: T0 + CLEAN_GRACE_MS + 1, overdueCount: 5 });
    const dayB = afterGrace.pet.careLog[0];
    expect(dayB.cleanSum / dayB.cleanN).toBe(0); // 5 poop → cleanliness 0
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

// --- care scoring --------------------------------------------------------

describe("care scoring (design §1 & §3)", () => {
  it("dailyCareScore = fedRatio × cleanRatio × studiedFlag", () => {
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: true, fed: 1, clean: 1 }))).toBe(1);
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: false, fed: 1, clean: 1 }))).toBe(0);
    expect(dailyCareScore(makeCareDay("d", "baby", { studied: true, fed: 0.5, clean: 0.6 }))).toBeCloseTo(0.3, 9);
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

describe("branchSpecies: design §3 branch table (all 16種)", () => {
  const GOOD = 0.9;
  const OK = 0.6;
  const NEGLECT = 0.2;
  const base = { studyStreak: 0, priorStudiedEveryDay: false };

  it("幼年期: 全系統 → モチ系 (mochi)", () => {
    expect(branchSpecies({ toStage: "baby", priorCare: GOOD, tendency: "N", ...base })).toBe("mochi");
    expect(branchSpecies({ toStage: "baby", priorCare: NEGLECT, tendency: "R", ...base })).toBe("mochi");
  });

  it("成長期: 良/並 → キュート系 (cute), 怠 → ヨゴレ系 (grime)", () => {
    expect(branchSpecies({ toStage: "child", priorCare: GOOD, tendency: "N", ...base })).toBe("cutie");
    expect(branchSpecies({ toStage: "child", priorCare: OK, tendency: "R", ...base })).toBe("cutie");
    expect(branchSpecies({ toStage: "child", priorCare: NEGLECT, tendency: "N", ...base })).toBe("grimy");
  });

  it("成熟期: 良×N → 勇者系 (hero), 良×R → 賢者系 (sage)", () => {
    expect(branchSpecies({ toStage: "adult", priorCare: GOOD, tendency: "N", ...base })).toBe("hero");
    expect(branchSpecies({ toStage: "adult", priorCare: GOOD, tendency: "R", ...base })).toBe("sage");
  });
  it("成熟期: 並×N → わんぱく系 (rascal), 並×R → まったり系 (chill)", () => {
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

  it("究極体: 良 → 聖竜系 (holy-dragon), 並 → 機神系 (machine-god)", () => {
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
  it("evolves mochi → cute → hero → knight → holy-dragon, then departs to a gen-2 egg", () => {
    let pet = newPet(1, T0);
    const events: PetEvent[] = [];
    for (let day = 0; day <= 12; day++) {
      const r = healthyDay(pet, day, { newCount: 5, reviewCount: 1 }); // N tendency
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

  // LINGO-032 QA: the abandon window's exact boundary, measured from a real
  // lastStudyDate (not the bornAt fallback the case above exercises). A learner
  // who studied on day 0 and then stops must survive 2 idle calendar days and
  // depart on the 3rd — off-by-one here would either kill pets a day early or
  // let them linger forever.
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

  // LINGO-032 QA: step ordering — abandonment is checked BEFORE the natural
  // day-12 departure. A pet that both hit day 12 AND went 3 days unstudied must
  // read as an 'early' 旅立ち (the honest signal = "you stopped studying"), not
  // a 'natural' graduation it didn't earn.
  it("abandonment takes priority over the natural day-12 depart", () => {
    const pet = { ...newPet(1, T0), lastStudyDate: localDateStr(at(8)) }; // 4 idle days by day 12
    const r = tick(pet, { now: at(12), overdueCount: 5 });
    expect(r.events.find((e) => e.type === "depart")?.reason).toBe("early");
  });
});

// LINGO-032 QA: the "honest gamification" invariant across the band↔pet seam.
// うんこ is a pure projection of the injected overdue-review count (which the
// state layer computes over the CURRENT unlockedBand, growing after a band
// promotion). Cleaning buys a care-score grace window but must NOT fake the
// poop away — only actually doing the overdue reviews (a smaller injected
// count) may clear it. And however large the post-promotion overdue queue
// grows, the display caps at MAX_POOP.
describe("poop honesty: cleaning never fakes it away; only doing reviews clears it", () => {
  it("掃除する leaves the visible poop untouched for the same overdue count", () => {
    const dirty = { ...newPet(1, T0), cleanPoints: 3 };
    const overdue = 4;
    const cleaned = applyClean(dirty, overdue, T0);
    expect(cleaned.cleanPoints).toBe(2); // a point was spent (care-score grace)
    // …but the honest poop mapping is unchanged: it reflects the real queue.
    expect(petSnapshot(cleaned, T0, overdue).poop).toBe(petSnapshot(dirty, T0, overdue).poop);
    expect(petSnapshot(cleaned, T0, overdue).poop).toBe(4);
  });
  it("poop drops only when the overdue queue actually shrinks (reviews done)", () => {
    const pet = newPet(1, T0);
    expect(petSnapshot(pet, T0, 4).poop).toBe(4);
    expect(petSnapshot(pet, T0, 1).poop).toBe(1); // 3 reviews cleared → 1 left
    expect(petSnapshot(pet, T0, 0).poop).toBe(0);
  });
  it("a large post-band-promotion overdue queue still caps at MAX_POOP", () => {
    // After unlockedBand expands, overdueReviewCount can jump well past 5.
    const pet = newPet(1, T0);
    expect(petSnapshot(pet, T0, 12).poop).toBe(MAX_POOP);
  });
});

describe("tick: 怠 at 完全体 (design §3 hidden/stall split at 究極体)", () => {
  // Build a pet sitting at 完全体 (berserk) at age ~9, whose 完全体 days were all
  // 怠 (low fed/clean). Whether it reaches 魔王系 or 旅立ちs depends only on
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
    const pet = { ...newPet(3, T0), foodCount: 4, cleanPoints: 2 };
    const snap = petSnapshot(pet, T0 + DAY_MS / 2, 3);
    expect(snap.generation).toBe(3);
    expect(snap.satiety).toBeCloseTo(50, 9);
    expect(snap.poop).toBe(3);
    expect(snap.ageDays).toBeCloseTo(0.5, 9);
    expect(snap.foodCount).toBe(4);
  });
});

describe("calendarDayDiff helper", () => {
  it("counts whole calendar days regardless of wall-clock time", () => {
    expect(calendarDayDiff(localDateStr(at(0)), localDateStr(at(3)))).toBe(3);
    expect(calendarDayDiff(localDateStr(T0), localDateStr(T0 + 1000))).toBe(0);
  });
});
