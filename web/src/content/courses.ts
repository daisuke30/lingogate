// Course catalog (LINGO-014). A "course" == the language on the card BACK (the
// target language being learned); design §1's "裏面の言語 = コース". Progress,
// FSRS state and the known-word map are all independent per course (see the
// courseId dimension threaded through db/idb.ts).
//
// The catalog is the lightweight, always-loaded list the settings picker reads
// (id / target language / which front languages the pack offers / availability)
// WITHOUT pulling in any pack bytes. The actual content pack (words+sentences)
// is loaded lazily via `load()` — only the active course's pack is ever
// fetched, so adding a course does not grow the initial bundle.
//
// Adding a course = ship a `deck.<id>.json` pack (build-content.mjs) + one
// entry here with status:"available" and a real `load`. Until a pack exists a
// course stays status:"coming-soon" with `load:null` (the picker shows it as
// 準備中 and refuses to select it) — never point `load` at a non-existent file
// or the Vite build fails resolving the dynamic import.

import type { Deck } from "../engine/content";
// The RU pack is the default/active course today, so it is imported statically
// (it is the only pack in the initial bundle; future packs are dynamic chunks).
import ruDeck from "./deck.ru.json";

/** A language the app itself speaks: it has a full i18n catalog (so it can be
 * the UI language) and packs offer it as a prompt/gloss language. Adding one
 * here obliges you to translate every catalog key — see i18n/i18n.tsx's
 * `Entry`, which is keyed by exactly this type. */
export type Lang = "ja" | "en" | "ru";

/** A language you can LEARN — i.e. one that can appear on the card back.
 * Deliberately wider than `Lang`: LINGO-039 added Thai as a course target
 * without adding a Thai UI, and this split is what makes that safe. Because
 * `Lang` stays narrow, the type system now guarantees "th" can never be
 * passed where a UI or prompt language is expected (there is no Thai catalog
 * to serve it, and no pack offers Thai glosses), while `targetLang` and the
 * course picker accept it. */
export type TargetLang = Lang | "th";

export type CourseStatus = "available" | "coming-soon";

export interface CourseMeta {
  courseId: string;
  /** Language on the card back (the language being learned). == courseId. */
  targetLang: TargetLang;
  /** Front (prompt/gloss) languages this course offers; never includes targetLang. */
  availableFrontLangs: Lang[];
  defaultFrontLang: Lang;
  status: CourseStatus;
  /** Lazily resolves the content pack. null while the course has no pack yet. */
  load: (() => Promise<Deck>) | null;
}

export const DEFAULT_COURSE_ID = "ru";

// Order here is the order shown in the settings picker.
export const COURSES: CourseMeta[] = [
  {
    courseId: "ru",
    targetLang: "ru",
    availableFrontLangs: ["en", "ja"],
    defaultFrontLang: "en",
    status: "available",
    load: () => Promise.resolve(ruDeck as unknown as Deck),
  },
  {
    // LINGO-015 (Phase B): NGSL-based English course, band1 core deck (1000
    // words + 1000 target sentences). deck.en.json is a dynamic chunk — never
    // fetched unless this course is actually selected.
    courseId: "en",
    targetLang: "en",
    availableFrontLangs: ["ja", "ru"],
    defaultFrontLang: "ja",
    status: "available",
    load: () => import("./deck.en.json").then((m) => m.default as unknown as Deck),
  },
  {
    // LINGO-039: Thai course, band1 core deck (3000 words + 1000 target
    // sentences, band1 only). Prompted in ja/en — deliberately NOT ru: the
    // pack ships no Russian glosses, and offering a front language the data
    // can't serve is the leak LINGO-037 spent a whole task closing. A UI=ru
    // learner can still take this course; frontLangFromUILang falls them back
    // to the ja default (they pick en in settings), and every note ships
    // ja/en/ru so nothing untranslated reaches them.
    courseId: "th",
    targetLang: "th",
    availableFrontLangs: ["ja", "en"],
    defaultFrontLang: "ja",
    status: "available",
    load: () => import("./deck.th.json").then((m) => m.default as unknown as Deck),
  },
  {
    courseId: "ja",
    targetLang: "ja",
    availableFrontLangs: ["en", "ru"],
    defaultFrontLang: "en",
    status: "coming-soon",
    load: null,
  },
];

/** The RU pack, available synchronously — the bootstrap deck service.ts starts
 * from so every synchronous consumer of DECK/WORD_BY_ID has real data on first
 * paint (the default course is RU). A non-default active course is swapped in
 * asynchronously via its `load()`. */
export const BOOTSTRAP_DECK = ruDeck as unknown as Deck;

/**
 * The courses to offer a learner whose UI language is `uiLang` (LINGO-044).
 *
 * A course whose target language IS the UI language is hidden: someone using
 * the app in Japanese is a Japanese speaker, so listing "learn Japanese" is
 * nonsense, and the same holds for every other pair. This is the course-level
 * counterpart of the rule `availableFrontLangs` already enforces at the
 * prompt-language level (a course never offers its own target as a front
 * language) — both say the same thing: never offer someone their own language
 * as the thing to learn or as a hint they don't need.
 *
 * The one exception is the course the learner is CURRENTLY studying. Someone
 * can start "learn Japanese" with an English UI and later switch the UI to
 * Japanese; dropping their active course out of the list at that point would
 * look like their progress had vanished. It stays listed until they move off
 * it themselves.
 */
export function selectableCourses(
  uiLang: Lang,
  activeCourseId?: string | null,
): CourseMeta[] {
  return COURSES.filter(
    (c) => c.targetLang !== uiLang || c.courseId === activeCourseId,
  );
}

export function courseById(courseId: string): CourseMeta | undefined {
  return COURSES.find((c) => c.courseId === courseId);
}

/** The active course, falling back to the default if an unknown/removed id was
 * persisted. Always returns an entry (the default RU course always exists). */
export function resolveCourse(courseId: string | null | undefined): CourseMeta {
  return courseById(courseId ?? DEFAULT_COURSE_ID) ?? courseById(DEFAULT_COURSE_ID)!;
}

/** Auto-initial front (prompt) language for a course from the current UI
 * language (LINGO-017 onboarding funnel: "表面言語はUI言語から自動初期値").
 * Falls back to the course's own default when the UI language isn't one of
 * its offered prompt languages (always true for a course's own target
 * language, since availableFrontLangs never includes it). */
export function frontLangFromUILang(course: CourseMeta, uiLang: Lang): Lang {
  return course.availableFrontLangs.includes(uiLang) ? uiLang : course.defaultFrontLang;
}
