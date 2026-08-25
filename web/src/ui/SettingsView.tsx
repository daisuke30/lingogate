import { useEffect, useState } from "react";
import { UNLOCK_CHOICES, getUnlockMinutes, setUnlockMinutes, getQuizMode } from "../state/settings";
import type { QuizMode } from "../state/settings";
import { resetAll } from "../db/idb";

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [minutes, setMinutes] = useState(10);
  const [quizMode, setQuizModeState] = useState<QuizMode>("flashcard");

  useEffect(() => {
    getUnlockMinutes().then(setMinutes);
    getQuizMode().then(setQuizModeState);
  }, []);

  function pick(m: number) {
    setMinutes(m);
    void setUnlockMinutes(m);
  }

  async function reset() {
    if (!confirm("学習状態（FSRS・履歴・設定）をすべて消去します。よろしいですか？")) return;
    await resetAll();
    location.reload();
  }

  return (
    <div className="app">
      <button className="backlink" onClick={onBack}>
        ‹ ホーム
      </button>
      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>設定</h1>

      <div className="section-title">解除時間</div>
      <div className="card">
        <div className="row" style={{ padding: 0, background: "transparent" }}>
          <div>
            <div className="label">クリア後にひらける時間</div>
            <div className="sub">この時間内に再度ゲートを開くとクイズをスキップ</div>
          </div>
          <div className="seg">
            {UNLOCK_CHOICES.map((m) => (
              <button key={m} className={minutes === m ? "on" : ""} onClick={() => pick(m)}>
                {m}分
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section-title">出題UI</div>
      <div className="list">
        <div className="row">
          <div>
            <div className="label">
              フラッシュカード<span className="badge">既定</span>
            </div>
            <div className="sub">EN→タップで裏返しRU→フリックで自己評価。FSRSに直結。</div>
          </div>
          <div className="seg">
            <button className={quizMode === "flashcard" ? "on" : ""} disabled>
              使用中
            </button>
          </div>
        </div>
        <div className="row">
          <div>
            <div className="label">
              厳格モード（4択）<span className="badge">準備中</span>
            </div>
            <div className="sub">Web版はまず反復テストが目的のため未実装（iOS版に温存）。</div>
          </div>
          <div className="seg">
            <button disabled>準備中</button>
          </div>
        </div>
      </div>

      <div className="section-title">データ</div>
      <div className="list">
        <div className="row">
          <div>
            <div className="label">学習状態をリセット</div>
            <div className="sub">FSRSスケジュール・ゲート履歴・設定を消去（dogfoodやり直し用）</div>
          </div>
          <button className="btn" onClick={reset} style={{ color: "var(--again)" }}>
            消去
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 20 }}>
        シールド（対象アプリの強制遮断）はiOSネイティブ専用機能のためWeb版にはありません。Web版は
        オートメーション方式（弱い強制力）で、クイズ×FSRSの反復UX検証に集中します。
      </p>
    </div>
  );
}
