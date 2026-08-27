import { useEffect, useState } from "react";
import { DECK, PRIMARY_BAND, activeCourse, homeStats } from "../state/service";
import type { HomeStats } from "../state/service";
import { calibrationProgress } from "../state/calibration";
import type { CalibrationProgress } from "../state/calibration";
import { resolveCourse } from "../content/courses";
import { langName, useI18n } from "../i18n/i18n";
import type { Lang } from "../i18n/i18n";
import type { Route } from "./App";

// Fallback shown if calibrationProgress() rejects (e.g. a transient IndexedDB
// hiccup) — bug report 2026-08-26: the card silently never showed on one
// device because an unhandled rejection here just left `calib` at null
// forever. Better to show the entry point with a "0 judged" state than hide
// the feature outright; tapping through will surface the real error if the DB
// is genuinely broken, instead of the feature just vanishing with no trace.
function fallbackCalibProgress(): CalibrationProgress {
  const total = DECK.words.filter((w) => w.band === PRIMARY_BAND).length;
  return { total, judged: 0, known: 0, unknown: 0, done: total === 0 };
}

export function HomeView({ navigate }: { navigate: (r: Route) => void }) {
  const { lang, t } = useI18n();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [calib, setCalib] = useState<CalibrationProgress | null>(null);
  const [targetLang, setTargetLang] = useState<Lang>("ru");

  useEffect(() => {
    homeStats()
      .then((s) => {
        setStats(s);
        setTargetLang(resolveCourse(activeCourse()).targetLang);
      })
      .catch((err) => console.error("homeStats failed", err));
    calibrationProgress()
      .then(setCalib)
      .catch((err) => {
        console.error("calibrationProgress failed", err);
        setCalib(fallbackCalibProgress());
      });
  }, []);

  const masteryLevel = (threshold: number | null): string =>
    threshold == null
      ? t("mastery.level.beginner")
      : t("mastery.level.words", { n: threshold.toLocaleString() });

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="mark">Я</span>
          LingoGate
        </div>
        <div className="actions">
          <button className="iconbtn" onClick={() => navigate({ name: "guide" })} aria-label={t("home.guide")}>
            ？
          </button>
          <button
            className="iconbtn"
            onClick={() => navigate({ name: "settings" })}
            aria-label={t("home.settings")}
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="val">{stats?.todayGates ?? "–"}</div>
          <div className="lbl">{t("home.stat.gates")}</div>
        </div>
        <div className="stat">
          <div className="val">{stats?.todayUnlocks ?? "–"}</div>
          <div className="lbl">{t("home.stat.unlocks")}</div>
        </div>
        <div className="stat">
          <div className="val">{stats && stats.knownRatePct != null ? `${stats.knownRatePct}%` : "–"}</div>
          <div className="lbl">{t("home.stat.knownRate")}</div>
        </div>
      </div>

      <div className="section-title">{t("home.mastery.title")}</div>
      <div className="card mastery-card">
        <div className="mastery-head">
          <div>
            <div className="mastery-num">
              {stats ? stats.mastery.masteredCount.toLocaleString() : "–"}
              <span className="mastery-unit">{t("home.mastery.unit")}</span>
            </div>
            <div className="mastery-sub">
              {t("home.mastery.coverage")}{" "}
              <strong>{stats ? `${stats.mastery.coveragePct}%` : "–"}</strong>
            </div>
          </div>
          <div className="mastery-level">{stats ? masteryLevel(stats.mastery.levelThreshold) : "–"}</div>
        </div>
        <div className="meter">
          <div className="head">
            <span>{t("home.mastery.progress")}</span>
            <span>
              {stats ? stats.mastery.masteredCount.toLocaleString() : "–"}/
              {(stats?.mastery.targetWords ?? 3000).toLocaleString()}
            </span>
          </div>
          <div className="track">
            <div
              className="fill"
              style={{
                width: `${
                  stats
                    ? Math.min(100, (100 * stats.mastery.masteredCount) / stats.mastery.targetWords)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      </div>

      {calib && !calib.done && (
        <>
          <div className="section-title">{t("home.calib.title")}</div>
          <button
            className="card calib-cta"
            onClick={() => navigate({ name: "calibration" })}
          >
            <div className="meter" style={{ marginTop: 0 }}>
              <div className="head">
                <span>{calib.judged > 0 ? t("home.calib.continue") : t("home.calib.start")}</span>
                <span>
                  {calib.judged}/{calib.total}
                </span>
              </div>
              <div className="track">
                <div
                  className="fill"
                  style={{ width: `${calib.total > 0 ? (100 * calib.judged) / calib.total : 0}%` }}
                />
              </div>
            </div>
            <p className="muted" style={{ margin: "12px 0 0" }}>
              {t("home.calib.desc")}
            </p>
          </button>
        </>
      )}

      <div className="section-title">{t("home.band.title")}</div>
      <div className="card">
        <div className="meter">
          <div className="head">
            <span>{t("home.band.coverage")}</span>
            <span>
              {stats ? `${stats.coverage.covered}/${stats.coverage.total}` : "–"}（
              {stats ? stats.coverage.pct : 0}%）
            </span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${stats?.coverage.pct ?? 0}%` }} />
          </div>
        </div>
        <div className="meter">
          <div className="head">
            <span>{t("home.band.retention")}</span>
            <span>
              {stats && stats.retentionPct != null
                ? t("home.band.retentionValue", { pct: stats.retentionPct, cards: stats.reviewCards })
                : t("home.band.noData")}
            </span>
          </div>
          <div className="track">
            <div className="fill green" style={{ width: `${stats?.retentionPct ?? 0}%` }} />
          </div>
        </div>
        {stats && stats.dueNow > 0 && (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            {t("home.band.dueNow", { n: stats.dueNow })}
          </p>
        )}
      </div>

      <div className="spacer" />

      <div className="stack">
        <button
          className="btn primary block"
          onClick={() => navigate({ name: "quiz", returnApp: null, continuous: true })}
        >
          {t("home.solve", { lang: langName(lang, targetLang) })}
        </button>
        <button className="btn ghost block" onClick={() => navigate({ name: "guide" })}>
          {t("home.setupAutomation")}
        </button>
      </div>
    </div>
  );
}
