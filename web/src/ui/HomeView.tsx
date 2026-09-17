// Home (学習 tab) — rebuilt in LINGO-040 per the Fable ruling
// (ai-org/Ideas/20260910-home-ux-ruling.md).
//
// The screen shows exactly three things, in the order a first-time user needs
// them: which language they are learning, the one thing to do today, and how
// far along they are. Nothing else is permanent. Everything precise — session
// counts, words introduced, review success, the next step's condition,
// estimated speech coverage — lives behind "くわしく", because only someone
// who taps it is asking for precision.
//
// What was deleted outright, and why (ruling §2): the 「解除」tile (its value
// was provably always identical to the session count beside it), the 「既知率」
// tile (the completion screen had already retired that percentage in favour of
// a 覚えていた/曖昧/覚えていない breakdown — it had simply survived here under
// another name), the 「（255枚）」card-count denominator, the level badge (the
// same figure as the big number next to it), 「判定済み0語」, and the mini pet
// row (a duplicate entry point to the 育成 tab two centimetres below it — the
// neglect signal it carried now sits on the tab itself as a dot).
//
// The rule the copy follows: no raw denominator, no percentage, and no word
// from the app's internals (band / gate / unlock / coverage / retention /
// FSRS) on the permanent screen.

import { useEffect, useState } from "react";
import { activeCourse, homeStats } from "../state/service";
import type { HomeStats } from "../state/service";
import { calibrationProgress } from "../state/calibration";
import { CALIBRATION_FALLBACK_THRESHOLD } from "../engine/calibration";
import { approximateWordCount } from "../engine/mastery";
import { deferPlacement, isPlacementSettled } from "../state/placement";
import { resolveCourse, selectableCourses } from "../content/courses";
import { setActiveCourse } from "../state/settings";
import { NATIVE_LANG_NAME, useI18n } from "../i18n/i18n";
import type { TFn } from "../i18n/i18n";
import { BottomSheet, SheetShell } from "./ListPicker";
import type { Route } from "./App";
import type { PetSnapshot } from "../pet/engine";

/** The one batch the start button commits the learner to. Mirrors
 * QuizScreen's BATCH_SIZE — the label names the number so "start" is a
 * bounded promise ("10 questions"), not an open-ended loop. */
const BATCH_SIZE = 10;

/** Round a real step word count (1000 / 2000 / 3000 on RU post-LINGO-043;
 * was 998 / 1993 / 2960 before that band-size normalization) to the nearest
 * hundred for display. The label always carries 約/~ so the rounding is
 * stated, never implied: the exact figure is in the details sheet, where a
 * precise denominator is what the reader came for. */
function roundedStepWords(n: number): number {
  return Math.max(0, Math.round(n / 100) * 100);
}

export function HomeView({
  navigate,
  petSnap,
}: {
  navigate: (r: Route) => void;
  /** Owned by App (it also feeds the tab-bar dot) so Home and the tab bar can
   * never disagree about the pet, and the pet is read once per visit. */
  petSnap: PetSnapshot | null;
}) {
  const { lang: uiLang, t } = useI18n();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [courseId, setCourseId] = useState<string>(activeCourse());
  // LINGO-016: the placement test is a single short pass, not "judge every
  // word" — show it only while the learner hasn't run it AND hasn't already
  // substantially self-calibrated via the old linear flow (e.g. Katsuta's
  // existing RU judgements), so nobody gets re-nagged for a test their
  // existing data already makes redundant.
  const [showLevelCheck, setShowLevelCheck] = useState(false);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    homeStats()
      .then((s) => {
        setStats(s);
        setCourseId(activeCourse());
      })
      .catch((err) => console.error("homeStats failed", err));
    Promise.all([calibrationProgress(), isPlacementSettled()])
      .then(([c, settled]) => setShowLevelCheck(!settled && c.judged < CALIBRATION_FALLBACK_THRESHOLD))
      .catch((err) => {
        // 2026-08-26 bug report: an unhandled rejection here used to leave the
        // level-check entry point hidden forever on one device. Failing open is
        // the safe direction — offering the test to someone who has already
        // done it costs a tap; hiding it from someone who hasn't costs them the
        // whole calibration.
        console.error("calibrationProgress/isPlacementDone failed", err);
        setShowLevelCheck(true);
      });
  }, []);

  const course = resolveCourse(courseId);

  /** Switching the course swaps the content pack AND the progress namespace,
   * then reloads. Reachable in one tap from Home now, so it always asks first
   * and says the thing a learner actually fears — that switching wipes what
   * they have done. It does not: progress is stored per course. */
  async function pickCourse(id: string) {
    if (id === courseId) return;
    const label = NATIVE_LANG_NAME[resolveCourse(id).targetLang];
    if (!confirm(t("home.course.switchConfirm", { lang: label }))) return;
    await setActiveCourse(id);
    location.reload();
  }

  const mastered = stats?.mastery.masteredCount ?? 0;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="mark">Я</span>
          LingoGate
        </div>
        <div className="actions">
          <button
            className="iconbtn"
            onClick={() => navigate({ name: "settings" })}
            aria-label={t("home.settings")}
          >
            ⚙
          </button>
        </div>
      </div>

      {/* ---- Block 1: which language, and the streak ---- */}
      <div className="home-course-row">
        <button type="button" className="course-chip" onClick={() => setCoursePickerOpen(true)}>
          {NATIVE_LANG_NAME[course.targetLang]}
          <span className="chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {petSnap && petSnap.studyStreak > 0 && (
          <span className="streak-chip">🔥 {t("home.streak", { n: petSnap.studyStreak })}</span>
        )}
      </div>

      {/* ---- Block 2: the one thing to do today ---- */}
      {showLevelCheck ? (
        <div className="card home-hero">
          <div className="hero-kicker">{t("home.calib.title")}</div>
          <p className="hero-lead">{t("home.calib.desc")}</p>
          <button className="btn primary block" onClick={() => navigate({ name: "placement" })}>
            {t("home.placement.cta")}
          </button>
          <button
            className="btn ghost block"
            onClick={() => {
              // Remember the choice, or Home would ask again on every visit and
              // the daily-goal card would never get its turn (LINGO-046).
              void deferPlacement();
              setShowLevelCheck(false);
              navigate({ name: "quiz", returnApp: null, continuous: true });
            }}
          >
            {t("home.calib.later")}
          </button>
        </div>
      ) : (
        <TodayCard
          stats={stats}
          onStart={() => navigate({ name: "quiz", returnApp: null, continuous: true })}
        />
      )}

      {/* ---- Block 3: one progress bar, aimed at the next step ---- */}
      <div className="card home-progress">
        <div className="progress-head">
          <span className="progress-label">{t("home.progress.learned")}</span>
          <span className="progress-num">
            {stats ? approxWords(mastered, t) : "–"}
          </span>
        </div>
        {/* LINGO-042: ONE bar, tracking the current step — the same thing the
            line beneath it names. It used to track a 500-word milestone while
            the line named the step, so two unrelated goals sat stacked on top
            of each other ("次の目標500語まで あと500語" / "次のステップまで
            あと899語") and neither meant anything. */}
        <div className="meter">
          <div
            className="track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={stats ? Math.round(stepProgressPct(stats)) : 0}
            aria-label={t("home.step.title", {
              step: stats?.unlockedBand ?? 1,
              n: roundedStepWords(stats?.stepWords ?? 0).toLocaleString(),
            })}
          >
            <div className="fill" style={{ width: `${stats ? stepProgressPct(stats) : 0}%` }} />
          </div>
        </div>
        <button type="button" className="progress-more" onClick={() => setDetailsOpen(true)}>
          <span>{stepLine(stats, t)}</span>
          <span className="details-link">
            {t("home.details")}
            <span className="chevron" aria-hidden="true">
              ›
            </span>
          </span>
        </button>
      </div>

      {/* ---- マイノート: optional lane, below the main line (LINGO-050) ----
          Placed at the bottom of Home on purpose: it is subordinate to the
          core curriculum and must read that way, and it gives the empty lower
          area of a short screen something to be. Absent entirely when the
          course ships no notes — see HomeStats.notesCount. */}
      {stats != null && stats.notesCount > 0 && (
        <button
          type="button"
          className="notes-lane"
          onClick={() => navigate({ name: "quiz", returnApp: null, continuous: false, notes: true })}
        >
          <span className="notes-lane-text">
            <span className="notes-lane-label">{t("home.notes.label")}</span>
            <span className="notes-lane-sub">
              {t("home.notes.sub", { n: stats.notesCount.toLocaleString() })}
            </span>
          </span>
          <span className="chevron" aria-hidden="true">
            ›
          </span>
        </button>
      )}

      <BottomSheet
        open={coursePickerOpen}
        title={t("home.course.sheetTitle")}
        options={selectableCourses(uiLang, courseId).map((c) => ({
          value: c.courseId,
          label: NATIVE_LANG_NAME[c.targetLang],
          disabled: c.status !== "available",
          badge: c.status === "available" ? undefined : t("badge.comingSoon"),
        }))}
        selected={courseId}
        onSelect={(id) => void pickCourse(id)}
        onClose={() => setCoursePickerOpen(false)}
        closeLabel={t("common.close")}
      />

      <DetailsSheet
        open={detailsOpen}
        stats={stats}
        onClose={() => setDetailsOpen(false)}
      />
    </div>
  );
}

/**
 * The headline word count, rounded down to a round ten ("約270語") — LINGO-046.
 * Small counts stay exact, because "約0語" is not a kindness. The details
 * sheet keeps the precise figure for anyone who goes looking for it.
 */
function approxWords(n: number, t: TFn): string {
  const { value, isApproximate } = approximateWordCount(n);
  return t(isApproximate ? "home.progress.approxWords" : "home.progress.words", {
    n: value.toLocaleString(),
  });
}

/**
 * Block 2 — "今日 あとN問" (LINGO-046).
 *
 * The card leads with the distance to a target the learner chose in Settings,
 * because that is a thing a person can finish. What it replaced ("復習 8枚 ＋
 * 新しい単語") described the app's queue rather than the learner's task, and
 * had no end: eight reviews plus an unbounded supply of new words is not a
 * goal, it is a treadmill.
 *
 * Passing the goal does not close the card down — the ring stays full, the
 * count keeps rising as "目標＋N問", and the button still starts another batch.
 * A daily target should be a floor to clear, never a ceiling that tells
 * someone on a roll to stop.
 */
function TodayCard({ stats, onStart }: { stats: HomeStats | null; onStart: () => void }) {
  const { t } = useI18n();
  const goal = stats?.dailyGoal ?? 0;
  const done = stats?.todayGraded ?? 0;
  const remaining = Math.max(0, goal - done);
  const achieved = stats != null && goal > 0 && done >= goal;
  const pct = goal > 0 ? Math.min(100, (100 * done) / goal) : 0;

  return (
    <div className="card home-hero today-card">
      <div className="hero-kicker">{t("home.today.title")}</div>

      <div className="today-main">
        <GoalRing pct={pct} achieved={achieved} />
        <div className="today-figures">
          <div className={"today-headline" + (achieved ? " done" : "")}>
            {stats == null
              ? "…"
              : achieved
                ? t("home.today.achieved")
                : t("home.today.remaining", { n: remaining.toLocaleString() })}
          </div>
          {stats != null && (
            <div className="today-sub">
              {achieved && done > goal
                ? t("home.today.beyond", { n: (done - goal).toLocaleString() })
                : t("home.today.goal", { n: goal.toLocaleString() })}
            </div>
          )}
          {stats != null && (
            <div className="today-sub faint">
              {stats.dueNow > 0
                ? t("home.today.ofWhichReviews", { n: stats.dueNow.toLocaleString() })
                : t("home.today.freshOnly")}
            </div>
          )}
        </div>
      </div>

      <button className="btn primary block" onClick={onStart}>
        {achieved
          ? t("home.today.continue", { n: BATCH_SIZE })
          : t("home.today.start", { n: BATCH_SIZE })}
      </button>
    </div>
  );
}

/** The daily-goal ring. A plain SVG arc — no chart library for one circle. */
function GoalRing({ pct, achieved }: { pct: number; achieved: boolean }) {
  const size = 92;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  return (
    <svg className="goal-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-elev-2)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={achieved ? "var(--good)" : "var(--indigo-bright)"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
        // Start the arc at 12 o'clock rather than 3 o'clock.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {achieved && (
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="30"
        >
          🎉
        </text>
      )}
    </svg>
  );
}

/**
 * How full the home bar is: progress toward the next step, on exactly the same
 * basis as the "次のステップまで あとN語" line below it (LINGO-042 — one goal,
 * one measure). 100% when there is no next step to reach, so the last step
 * reads as complete rather than as a permanently half-empty bar.
 */
function stepProgressPct(stats: HomeStats): number {
  const remaining = stats.wordsToNextStep;
  if (remaining == null) return 100;
  const seen = stats.bandPromotion?.seenWords ?? 0;
  const goal = seen + remaining;
  if (goal <= 0) return 100;
  return Math.max(0, Math.min(100, (100 * seen) / goal));
}

/** "ステップ1（最初の約1,000語）" plus, on the same tap target, the one figure
 * the ruling kept about the next step. Three cases, in order of what the
 * learner can act on:
 *   - words still to go        → "次のステップまで あとN語"
 *   - words done, reviews not  → "復習を続けると次のステップへ" (never "あと0語",
 *     which would sit there promising a promotion that cannot fire)
 *   - no next step at all      → "いまが最後のステップです" (EN today: the course
 *     ships no band-2 sentences, so the old screen said nothing whatsoever)
 */
function stepLine(stats: HomeStats | null, t: TFn): string {
  if (!stats) return "";
  const title = t("home.step.title", {
    step: stats.unlockedBand,
    n: roundedStepWords(stats.stepWords).toLocaleString(),
  });
  if (stats.wordsToNextStep == null) return `${title} · ${t("home.step.last")}`;
  if (stats.wordsToNextStep > 0) {
    return `${title} · ${t("home.step.toNext", { n: stats.wordsToNextStep.toLocaleString() })}`;
  }
  return `${title} · ${t("home.step.keepReviewing")}`;
}

/**
 * "くわしく" — the only place exact figures appear, and the only place the
 * 3,000-word frame is still quoted (as the scope of the course, never as a bar
 * the learner is expected to fill: RU ships 2,960 eligible lemmas and EN about
 * 1,000, so a /3000 bar could not be honoured — QA-3).
 *
 * The 覚えた語 breakdown is the point of this sheet: a level check can declare
 * several hundred words known in 1–3 minutes, and blending those into one
 * "mastered" figure is what made the old home screen unbelievable. Here the
 * learner can see which half is their own claim and which half the app watched
 * stick.
 */
function DetailsSheet({
  open,
  stats,
  onClose,
}: {
  open: boolean;
  stats: HomeStats | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <SheetShell open={open} title={t("home.details")} onClose={onClose} closeLabel={t("common.close")}>
      {stats && (
        <div className="detail-body">
          <div className="detail-row">
            <span>{t("detail.today")}</span>
            <strong>{t("detail.today.sessions", { n: stats.todaySessions })}</strong>
          </div>

          <div className="detail-group-title">{t("home.progress.learned")}</div>
          <div className="detail-row">
            <span>{t("detail.learned.declared")}</span>
            <strong>
              {t("home.progress.words", { n: stats.mastery.declaredCount.toLocaleString() })}
            </strong>
          </div>
          <div className="detail-row">
            <span>{t("detail.learned.studied")}</span>
            <strong>
              {t("home.progress.words", { n: stats.mastery.learnedCount.toLocaleString() })}
            </strong>
          </div>
          <div className="detail-row">
            <span>{t("detail.frame")}</span>
            <strong>
              {t("home.progress.words", { n: stats.mastery.masteredCount.toLocaleString() })}
            </strong>
          </div>
          <div className="detail-row">
            <span>{t("detail.speech")}</span>
            <strong>
              {t("detail.speech.value", { pct: Math.round(stats.mastery.coveragePct) })}
            </strong>
          </div>

          <div className="detail-group-title">
            {t("home.step.title", {
              step: stats.unlockedBand,
              n: roundedStepWords(stats.stepWords).toLocaleString(),
            })}
          </div>
          <div className="detail-row">
            <span>{t("detail.introduced")}</span>
            <strong>
              {t("detail.introduced.value", { n: stats.introduced.covered.toLocaleString() })}
            </strong>
          </div>
          <div className="meter">
            <div className="track">
              <div className="fill" style={{ width: `${stats.introduced.pct}%` }} />
            </div>
          </div>
          <div className="detail-row">
            <span>{t("detail.retention")}</span>
            <strong>
              {stats.retentionPct != null ? `${stats.retentionPct}%` : t("detail.retention.noData")}
            </strong>
          </div>
          {stats.retentionPct != null && (
            <div className="meter">
              <div className="track">
                <div className="fill green" style={{ width: `${stats.retentionPct}%` }} />
              </div>
            </div>
          )}
          {stats.wordsToNextStep != null && (
            <div className="detail-row">
              <span>{t("detail.next")}</span>
              <strong>
                {stats.wordsToNextStep > 0
                  ? t("detail.next.value", { n: stats.wordsToNextStep.toLocaleString() })
                  : t("home.step.keepReviewing")}
              </strong>
            </div>
          )}
        </div>
      )}
    </SheetShell>
  );
}
