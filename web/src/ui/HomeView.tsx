import { useEffect, useState } from "react";
import { DECK, PRIMARY_BAND, homeStats } from "../state/service";
import type { HomeStats } from "../state/service";
import { calibrationProgress } from "../state/calibration";
import type { CalibrationProgress } from "../state/calibration";
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
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [calib, setCalib] = useState<CalibrationProgress | null>(null);

  useEffect(() => {
    homeStats()
      .then(setStats)
      .catch((err) => console.error("homeStats failed", err));
    calibrationProgress()
      .then(setCalib)
      .catch((err) => {
        console.error("calibrationProgress failed", err);
        setCalib(fallbackCalibProgress());
      });
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="mark">Я</span>
          LingoGate
        </div>
        <div className="actions">
          <button className="iconbtn" onClick={() => navigate({ name: "guide" })} aria-label="ガイド">
            ？
          </button>
          <button
            className="iconbtn"
            onClick={() => navigate({ name: "settings" })}
            aria-label="設定"
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="val">{stats?.todayGates ?? "–"}</div>
          <div className="lbl">今日のゲート</div>
        </div>
        <div className="stat">
          <div className="val">{stats?.todayUnlocks ?? "–"}</div>
          <div className="lbl">解除</div>
        </div>
        <div className="stat">
          <div className="val">{stats && stats.knownRatePct != null ? `${stats.knownRatePct}%` : "–"}</div>
          <div className="lbl">既知率</div>
        </div>
      </div>

      {calib && !calib.done && (
        <>
          <div className="section-title">既知語の仕分け（キャリブレーション）</div>
          <button
            className="card calib-cta"
            onClick={() => navigate({ name: "calibration" })}
          >
            <div className="meter" style={{ marginTop: 0 }}>
              <div className="head">
                <span>{calib.judged > 0 ? "続きから仕分ける" : "1000語を仕分ける"}</span>
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
              知っている語を右、知らない語を左へ。カードの並びはあなたの既知語マップで最適化されます。
            </p>
          </button>
        </>
      )}

      <div className="section-title">band1 の進み具合</div>
      <div className="card">
        <div className="meter">
          <div className="head">
            <span>語彙カバー</span>
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
            <span>定着率</span>
            <span>
              {stats && stats.retentionPct != null
                ? `${stats.retentionPct}%（${stats.reviewCards}枚）`
                : "まだデータなし"}
            </span>
          </div>
          <div className="track">
            <div className="fill green" style={{ width: `${stats?.retentionPct ?? 0}%` }} />
          </div>
        </div>
        {stats && stats.dueNow > 0 && (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            復習の期限が来たカード: {stats.dueNow} 枚
          </p>
        )}
      </div>

      <div className="spacer" />

      <div className="stack">
        <button
          className="btn primary block"
          onClick={() => navigate({ name: "quiz", returnApp: null, continuous: true })}
        >
          ロシア語を解く
        </button>
        <button className="btn ghost block" onClick={() => navigate({ name: "guide" })}>
          オートメーションを設定する
        </button>
      </div>
    </div>
  );
}
