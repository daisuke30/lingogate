import { describe, it, expect } from "vitest";
import {
  chooseExpression,
  feedDisabled,
  cleanDisabled,
  showTabBar,
  activeTab,
  sessionEarnedPetRewards,
  petAttention,
  HUNGRY_AT,
  JOY_AT,
} from "./petDisplay";
import type { PetSnapshot } from "./engine";

const base: PetSnapshot = {
  stage: "child",
  speciesId: "cutie",
  generation: 1,
  ageDays: 1.4,
  satiety: 80,
  poop: 0,
  foodCount: 3,
  cleanPoints: 2,
  studyStreak: 2,
};

describe("chooseExpression — priority 空腹>汚れ>喜び>通常", () => {
  it("空腹 wins even when also dirty and would otherwise be joyful", () => {
    expect(chooseExpression({ satiety: HUNGRY_AT - 1, poop: 5 })).toBe("hungry");
  });
  it("汚れ when fed enough but has poop (beats joy)", () => {
    expect(chooseExpression({ satiety: JOY_AT + 10, poop: 1 })).toBe("dirty");
  });
  it("喜び when full and clean", () => {
    expect(chooseExpression({ satiety: JOY_AT, poop: 0 })).toBe("joy");
  });
  it("通常 when middling satiety and clean", () => {
    expect(chooseExpression({ satiety: 50, poop: 0 })).toBe("normal");
  });
  it("boundary: exactly HUNGRY_AT is not yet hungry", () => {
    expect(chooseExpression({ satiety: HUNGRY_AT, poop: 0 })).toBe("normal");
  });
});

describe("feedDisabled — 満腹時 or no food", () => {
  it("disabled with no food", () => {
    expect(feedDisabled({ ...base, foodCount: 0, satiety: 10 })).toBe(true);
  });
  it("disabled when already full even with food", () => {
    expect(feedDisabled({ ...base, foodCount: 5, satiety: 100 })).toBe(true);
  });
  it("enabled when hungry and holding food", () => {
    expect(feedDisabled({ ...base, foodCount: 1, satiety: 40 })).toBe(false);
  });
});

describe("cleanDisabled — no points or nothing to clean", () => {
  it("disabled with no clean points", () => {
    expect(cleanDisabled({ ...base, cleanPoints: 0, poop: 3 })).toBe(true);
  });
  it("disabled when there is no poop", () => {
    expect(cleanDisabled({ ...base, cleanPoints: 4, poop: 0 })).toBe(true);
  });
  it("enabled with points and poop present", () => {
    expect(cleanDisabled({ ...base, cleanPoints: 1, poop: 2 })).toBe(false);
  });
});

describe("showTabBar / activeTab — tabs only on 学習 & 育成", () => {
  it("shown on home and pet", () => {
    expect(showTabBar("home")).toBe(true);
    expect(showTabBar("pet")).toBe(true);
  });
  it("hidden on gate, quiz, placement, onboarding, settings", () => {
    for (const r of ["gate", "quiz", "placement", "onboarding", "settings", "guide", "petGallery"]) {
      expect(showTabBar(r)).toBe(false);
    }
  });
  it("maps route → active tab", () => {
    expect(activeTab("home")).toBe("learn");
    expect(activeTab("pet")).toBe("raise");
    expect(activeTab("gate")).toBe(null);
  });
});

describe("sessionEarnedPetRewards — LINGO-031 guard against a zero-progress session", () => {
  it("false when nothing was graded (immediate exit)", () => {
    expect(sessionEarnedPetRewards({ newCount: 0, reviewCount: 0 })).toBe(false);
  });
  it("true with at least one new card graded", () => {
    expect(sessionEarnedPetRewards({ newCount: 1, reviewCount: 0 })).toBe(true);
  });
  it("true with at least one review card graded", () => {
    expect(sessionEarnedPetRewards({ newCount: 0, reviewCount: 1 })).toBe(true);
  });
});

describe("petAttention — Home mini-status marks (LINGO-031)", () => {
  it("no marks when full and clean", () => {
    expect(petAttention({ satiety: 90, poop: 0 })).toEqual({ hungry: false, dirty: false });
  });
  it("hungry mark below HUNGRY_AT", () => {
    expect(petAttention({ satiety: HUNGRY_AT - 1, poop: 0 })).toEqual({ hungry: true, dirty: false });
  });
  it("dirty mark with any poop", () => {
    expect(petAttention({ satiety: 90, poop: 1 })).toEqual({ hungry: false, dirty: true });
  });
  it("both marks can be true at once", () => {
    expect(petAttention({ satiety: 5, poop: 3 })).toEqual({ hungry: true, dirty: true });
  });
});
