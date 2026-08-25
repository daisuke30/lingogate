import { useEffect, useState } from "react";
import { homeStats } from "../state/service";
import type { HomeStats } from "../state/service";
import type { Route } from "./App";

export function HomeView({ navigate }: { navigate: (r: Route) => void }) {
  const [stats, setStats] = useState<HomeStats | null>(null);

  useEffect(() => {
    homeStats().then(setStats);
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
        <button className="btn primary block" onClick={() => navigate({ name: "quiz", returnApp: null })}>
          ロシア語 10問を解く
        </button>
        <button className="btn ghost block" onClick={() => navigate({ name: "guide" })}>
          オートメーションを設定する
        </button>
      </div>
    </div>
  );
}
