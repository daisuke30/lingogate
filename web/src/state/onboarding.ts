// Onboarding service (LINGO-017): first-run detection + persisting the
// choices made during the funnel (course + front language + "seen" flag).
// Design ref: Ideas/20260827-lingogate-multilang-design.md §3.5 (5-screen
// intro) + §4 (course-select step that follows it). The intro screens'
// step-advancing logic itself is pure (engine/onboarding.ts); this module is
// only the IndexedDB/course wiring around it, mirroring state/placement.ts's
// shape.

import { getAllGateSessions, getAllReviewStates, getAllWordKnowledge } from "../db/idb";
import { COURSES, frontLangFromUILang, resolveCourse } from "../content/courses";
import type { Lang } from "../content/courses";
import { getOnboardingSeen, setActiveCourse, setFrontLang, setOnboardingSeen } from "./settings";

export { setOnboardingSeen as markOnboardingSeen };

/** True if `courseId` has ANY persisted learning state — judged words, FSRS
 * review states, or a recorded gate session. Any one of these means a real
 * person has already used this course. */
async function courseHasProgress(courseId: string): Promise<boolean> {
  const [knowledge, states, sessions] = await Promise.all([
    getAllWordKnowledge(courseId),
    getAllReviewStates(courseId),
    getAllGateSessions(courseId),
  ]);
  return knowledge.length > 0 || states.length > 0 || sessions.length > 0;
}

/** Any available course (ru/en today; a coming-soon course can never have
 * data since it has no pack to study) with existing progress. */
async function anyCourseHasProgress(): Promise<boolean> {
  for (const course of COURSES) {
    if (course.status !== "available") continue;
    // eslint-disable-next-line no-await-in-loop -- small, fixed course count; sequential is fine and keeps this readable.
    if (await courseHasProgress(course.courseId)) return true;
  }
  return false;
}

/**
 * Should the app show the first-run onboarding funnel right now? Task
 * Contract: "既存ユーザー（勝田）には初回表示しない（既存進捗があればスキップ）".
 * False once the learner has explicitly finished/skipped it (the "seen"
 * flag), OR — for a pre-LINGO-017 user whose flag was never set — as soon as
 * any course shows real progress, which also retroactively marks onboarding
 * "seen" so future launches don't re-scan IndexedDB for no reason.
 */
export async function shouldShowOnboarding(): Promise<boolean> {
  if (await getOnboardingSeen()) return false;
  if (await anyCourseHasProgress()) {
    await setOnboardingSeen(true);
    return false;
  }
  return true;
}

/** Persist the funnel's course-selection step: activate the chosen course,
 * initialise its front (prompt) language from the current UI language, and
 * mark onboarding seen. The caller navigates to the placement test next. */
export async function completeOnboardingWithCourse(courseId: string, uiLang: Lang): Promise<void> {
  const course = resolveCourse(courseId);
  await Promise.all([
    setActiveCourse(course.courseId),
    setFrontLang(course.courseId, frontLangFromUILang(course, uiLang)),
    setOnboardingSeen(true),
  ]);
}
