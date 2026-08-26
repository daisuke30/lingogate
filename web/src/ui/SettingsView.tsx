import { useEffect, useState } from "react";
import {
  UNLOCK_CHOICES,
  TTS_RATE_CHOICES,
  getUnlockMinutes,
  setUnlockMinutes,
  getQuizMode,
  getTtsEnabled,
  setTtsEnabled,
  getTtsRate,
  setTtsRate,
} from "../state/settings";
import type { QuizMode } from "../state/settings";
import { ruVoiceAvailable, subscribeVoices } from "../state/tts";
import { resetAll } from "../db/idb";
// LINGO-010 follow-up: build-time stamp (git sha + timestamp) so Katsuta can
// tell which deploy his device is actually running — see scripts/gen-version.mjs.
import versionInfo from "../content/version.generated.json";
import { checkForUpdate, hasPendingUpdate } from "../state/appUpdate";

function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [minutes, setMinutes] = useState(10);
  const [quizMode, setQuizModeState] = useState<QuizMode>("flashcard");
  const [ttsOn, setTtsOn] = useState(true);
  const [ttsRate, setTtsRateState] = useState(1.0);
  const [hasVoice, setHasVoice] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(false);

  useEffect(() => {
    getUnlockMinutes().then(setMinutes);
    getQuizMode().then(setQuizModeState);
    getTtsEnabled().then(setTtsOn);
    getTtsRate().then(setTtsRateState);
    hasPendingUpdate().then(setPendingUpdate);
    const unsub = subscribeVoices(() => setHasVoice(ruVoiceAvailable()));
    return unsub;
  }, []);

  function pick(m: number) {
    setMinutes(m);
    void setUnlockMinutes(m);
  }

  function toggleTts() {
    const next = !ttsOn;
    setTtsOn(next);
    void setTtsEnabled(next);
  }

  function pickRate(r: number) {
    setTtsRateState(r);
    void setTtsRate(r);
  }

  async function reset() {
    if (!confirm("学習状態（FSRS・履歴・設定）をすべて消去します。よろしいですか？")) return;
    await resetAll();
    location.reload();
  }

  async function updateNow() {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const result = await checkForUpdate();
      if (result === "updating") {
        setUpdateStatus("新しい版を適用します。まもなく再読み込みします…");
      } else if (result === "up-to-date") {
        setUpdateStatus(`最新版です（ビルド: ${versionInfo.version}）`);
      } else {
        setUpdateStatus("この環境では自動更新に対応していません（開発モード等）。");
      }
    } finally {
      setCheckingUpdate(false);
    }
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

      <div className="section-title">音声読み上げ</div>
      {hasVoice ? (
        <div className="list">
          <div className="row">
            <div>
              <div className="label">ロシア語を読み上げる</div>
              <div className="sub">カードを裏返した時に自動再生＋🔊で再再生</div>
            </div>
            <div className="seg">
              <button className={ttsOn ? "on" : ""} onClick={() => ttsOn || toggleTts()}>
                オン
              </button>
              <button className={!ttsOn ? "on" : ""} onClick={() => ttsOn && toggleTts()}>
                オフ
              </button>
            </div>
          </div>
          <div className="row">
            <div>
              <div className="label">読み上げ速度</div>
              <div className="sub">新しい語はゆっくりが聞き取りやすい</div>
            </div>
            <div className="seg">
              {TTS_RATE_CHOICES.map((r) => (
                <button key={r} className={ttsRate === r ? "on" : ""} onClick={() => pickRate(r)}>
                  {r === 1.0 ? "標準" : "0.8x"}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="muted">
          この端末にはロシア語の音声が見つかりません（iOSは設定＞アクセシビリティ＞読み上げコンテンツで
          ロシア語「Milena」を追加すると使えます）。
        </p>
      )}

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

      <div className="section-title">アプリの更新</div>
      <div className="list">
        <div className="row">
          <div>
            <div className="label">最新版を確認</div>
            <div className="sub">
              新しいビルドがあれば今すぐ取得して再読み込みします。何もしなければ次回このアプリを開いた時に自動で適用されます。
            </div>
          </div>
          <button className="btn" onClick={updateNow} disabled={checkingUpdate}>
            {checkingUpdate ? "確認中…" : "最新版に更新"}
          </button>
        </div>
      </div>
      {updateStatus ? (
        <p className="muted" style={{ marginTop: 10 }}>
          {updateStatus}
        </p>
      ) : (
        pendingUpdate && (
          <p className="muted" style={{ marginTop: 10 }}>
            新しいバージョンがあります（次回起動時に適用）
          </p>
        )
      )}

      <p className="muted" style={{ marginTop: 20, textAlign: "center", opacity: 0.6 }}>
        ビルド: {versionInfo.version}
        {versionInfo.builtAt ? `（${formatBuiltAt(versionInfo.builtAt)}）` : ""}
      </p>
    </div>
  );
}
