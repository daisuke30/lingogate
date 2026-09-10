import { describe, it, expect } from "vitest";
import {
  COURSES,
  DEFAULT_COURSE_ID,
  courseById,
  frontLangFromUILang,
  resolveCourse,
  selectableCourses,
} from "./courses";
import type { Lang } from "./courses";
import { UI_LANGS } from "../i18n/i18n";

// LINGO-014 language-axis invariants (design §1 + §3's "有効18パターン").
describe("course catalog", () => {
  it("never offers a front language equal to the course's own target (表面 ≠ 裏面)", () => {
    for (const c of COURSES) {
      expect(c.availableFrontLangs).not.toContain(c.targetLang);
      expect(c.availableFrontLangs.length).toBeGreaterThan(0);
    }
  });

  it("has a default front language that is actually one of the offered options", () => {
    for (const c of COURSES) {
      expect(c.availableFrontLangs).toContain(c.defaultFrontLang);
    }
  });

  it("yields 24 valid combinations (4 courses × front options × 3 UI langs)", () => {
    // Sum of (front options per course) = number of (course, front) pairs.
    // LINGO-039 added the TH course, taking 18 -> 24.
    const coursefront = COURSES.reduce((n, c) => n + c.availableFrontLangs.length, 0);
    expect(coursefront).toBe(8); // ru:2 + en:2 + th:2 + ja:2
    expect(coursefront * UI_LANGS.length).toBe(24);
  });

  it("ships RU, EN and TH as selectable courses; JA is still coming-soon", () => {
    for (const id of ["ru", "en", "th"]) {
      const c = courseById(id)!;
      expect(c.status).toBe("available");
      expect(c.load).not.toBeNull();
    }
    const ja = courseById("ja")!;
    expect(ja.status).toBe("coming-soon");
    expect(ja.load).toBeNull(); // no pack referenced -> Vite build can't break
  });

  it("only offers front languages the app actually has a UI catalog for", () => {
    // LINGO-039 split Lang (UI/prompt languages) from TargetLang (learnable
    // languages). A course may TARGET a language the app has no UI for — Thai
    // — but must never OFFER one as a prompt language, since its glosses and
    // notes would have nothing to be written in.
    for (const c of COURSES) {
      for (const f of c.availableFrontLangs) expect(UI_LANGS).toContain(f);
    }
  });

  it("the Thai course targets th, prompts in ja/en, and never offers ru", () => {
    const th = courseById("th")!;
    expect(th.targetLang).toBe("th");
    expect(th.availableFrontLangs).toEqual(["ja", "en"]);
    expect(th.defaultFrontLang).toBe("ja");
    // A ru-UI learner is legitimate here; they simply get the ja default and
    // pick en in settings. What must not happen is the pack claiming to
    // offer Russian glosses it does not ship.
    expect(th.availableFrontLangs).not.toContain("ru");
  });

  it("resolveCourse falls back to the default RU course for unknown/removed ids", () => {
    expect(resolveCourse("nope").courseId).toBe(DEFAULT_COURSE_ID);
    expect(resolveCourse(null).courseId).toBe(DEFAULT_COURSE_ID);
    expect(resolveCourse(undefined).courseId).toBe("ru");
  });
});

// LINGO-017: onboarding's "表面言語はUI言語から自動初期値" behaviour.
describe("frontLangFromUILang", () => {
  it("uses the UI language when the course actually offers it as a front option", () => {
    const ru = courseById("ru")!; // availableFrontLangs: en, ja
    expect(frontLangFromUILang(ru, "ja")).toBe("ja");
    expect(frontLangFromUILang(ru, "en")).toBe("en");
  });

  it("falls back to the course's own default when the UI language isn't offered", () => {
    const ru = courseById("ru")!; // never offers "ru" (== its own target lang)
    expect(frontLangFromUILang(ru, "ru")).toBe(ru.defaultFrontLang);
  });

  it("every course's own target language always falls back (never a valid front option)", () => {
    // Only meaningful for a target language that COULD be a UI language;
    // "th" is not one by construction (see the TargetLang split), so the
    // question cannot arise for the Thai course.
    for (const c of COURSES) {
      if (!(UI_LANGS as string[]).includes(c.targetLang)) continue;
      expect(frontLangFromUILang(c, c.targetLang as Lang)).toBe(c.defaultFrontLang);
    }
  });

  it("a ru-UI learner taking the Thai course gets its ja default, not a ru prompt", () => {
    const th = courseById("th")!;
    expect(frontLangFromUILang(th, "ru")).toBe("ja");
  });
});

// LINGO-044: a learner is never offered their own language as a course.
describe("selectableCourses", () => {
  it("hides the course whose target language is the UI language", () => {
    for (const ui of UI_LANGS) {
      const offered = selectableCourses(ui);
      expect(
        offered.map((c) => c.targetLang),
        `UI=${ui} was offered its own language as a course`,
      ).not.toContain(ui);
      // ...and hides exactly that one, nothing else
      expect(offered.length).toBe(COURSES.length - 1);
    }
  });

  it("keeps every course whose target the UI language is not", () => {
    const offered = selectableCourses("en").map((c) => c.courseId);
    expect(offered).toEqual(["ru", "th", "ja"]);
    expect(selectableCourses("ja").map((c) => c.courseId)).toEqual(["ru", "en", "th"]);
    expect(selectableCourses("ru").map((c) => c.courseId)).toEqual(["en", "th", "ja"]);
  });

  it("never hides a Thai course, since Thai is not a UI language", () => {
    // TargetLang is wider than Lang, so no UI language can ever equal "th".
    for (const ui of UI_LANGS) {
      expect(selectableCourses(ui).map((c) => c.courseId)).toContain("th");
    }
  });

  it("keeps the ACTIVE course listed even when the rule would hide it", () => {
    // Start "learn Japanese" with an English UI, then switch the UI to
    // Japanese: the course must not silently disappear from the picker, or the
    // learner's progress looks lost.
    expect(selectableCourses("ja").map((c) => c.courseId)).not.toContain("ja");
    expect(selectableCourses("ja", "ja").map((c) => c.courseId)).toContain("ja");
    // and it does not duplicate or reorder anything
    expect(selectableCourses("ja", "ja").map((c) => c.courseId)).toEqual(
      COURSES.map((c) => c.courseId),
    );
  });

  it("agrees with the front-language rule: neither offers a learner their own language", () => {
    // The two rules are the same principle at different levels — a course
    // never offers its target as a prompt language, and is never offered at
    // all to a speaker of that language.
    for (const ui of UI_LANGS) {
      for (const c of selectableCourses(ui)) {
        expect(c.targetLang).not.toBe(ui);
        expect(c.availableFrontLangs).not.toContain(c.targetLang);
        // the prompt language a learner would actually be given is readable
        // to them and is not the language they are trying to learn
        const front = frontLangFromUILang(c, ui);
        expect(c.availableFrontLangs).toContain(front);
        expect(front).not.toBe(c.targetLang);
      }
    }
  });
});
