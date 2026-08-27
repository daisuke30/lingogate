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

export type Lang = "ja" | "en" | "ru";
export type CourseStatus = "available" | "coming-soon";

export interface CourseMeta {
  courseId: string;
  /** Language on the card back (the language being learned). == courseId. */
  targetLang: Lang;
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

export function courseById(courseId: string): CourseMeta | undefined {
  return COURSES.find((c) => c.courseId === courseId);
}

/** The active course, falling back to the default if an unknown/removed id was
 * persisted. Always returns an entry (the default RU course always exists). */
export function resolveCourse(courseId: string | null | undefined): CourseMeta {
  return courseById(courseId ?? DEFAULT_COURSE_ID) ?? courseById(DEFAULT_COURSE_ID)!;
}
