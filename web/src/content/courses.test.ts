import { describe, it, expect } from "vitest";
import { COURSES, DEFAULT_COURSE_ID, courseById, resolveCourse } from "./courses";

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

  it("ships RU as the only selectable course; EN/JA are coming-soon with no pack", () => {
    const ru = courseById("ru")!;
    expect(ru.status).toBe("available");
    expect(ru.load).not.toBeNull();
    for (const id of ["en", "ja"]) {
      const c = courseById(id)!;
      expect(c.status).toBe("coming-soon");
      expect(c.load).toBeNull(); // no pack referenced -> Vite build can't break
    }
  });

  it("resolveCourse falls back to the default RU course for unknown/removed ids", () => {
    expect(resolveCourse("nope").courseId).toBe(DEFAULT_COURSE_ID);
    expect(resolveCourse(null).courseId).toBe(DEFAULT_COURSE_ID);
    expect(resolveCourse(undefined).courseId).toBe("ru");
  });
});
