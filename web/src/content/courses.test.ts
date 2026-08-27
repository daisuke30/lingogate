import { describe, it, expect } from "vitest";
import { COURSES, DEFAULT_COURSE_ID, courseById, frontLangFromUILang, resolveCourse } from "./courses";

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

  it("yields the design's 18 valid combinations (3 courses × front options × 3 UI langs)", () => {
    // Sum of (front options per course) = number of (course, front) pairs.
    const coursefront = COURSES.reduce((n, c) => n + c.availableFrontLangs.length, 0);
    expect(coursefront).toBe(6); // ru:2 + en:2 + ja:2
    const UI_LANGS = 3;
    expect(coursefront * UI_LANGS).toBe(18);
  });

  it("ships RU and EN as selectable courses (LINGO-015); JA is still coming-soon", () => {
    for (const id of ["ru", "en"]) {
      const c = courseById(id)!;
      expect(c.status).toBe("available");
      expect(c.load).not.toBeNull();
    }
    const ja = courseById("ja")!;
    expect(ja.status).toBe("coming-soon");
    expect(ja.load).toBeNull(); // no pack referenced -> Vite build can't break
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
    for (const c of COURSES) {
      expect(frontLangFromUILang(c, c.targetLang)).toBe(c.defaultFrontLang);
    }
  });
});
