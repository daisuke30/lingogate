import { useCallback, useEffect, useRef, useState } from "react";
import { Rating } from "../engine/fsrs";
import { commitSession, startSession } from "../state/service";
import type { StartedSession } from "../state/service";
import { getUnlockMinutes, getTtsSettings, setSuppressUntil } from "../state/settings";
import type { TtsSettings } from "../state/settings";
import { suppressUntil, returnDisplayName, returnTarget } from "../engine/gate";
import { FlashcardCard } from "./FlashcardCard";

type Phase = "loading" | "question" | "complete";

/**
 * Runs one 10-card flashcard gate. `returnApp` (e.g. "tiktok") means this was
 * launched from /gate — on completion we set the suppression window and offer a
 * "return" button; a null returnApp is a plain practice session from Home.
 */
export function QuizScreen({
  returnApp,
  seed,
  onExit,
}: {
  returnApp: string | null;
  seed?: number;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const sessionRef = useRef<StartedSession | null>(null);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const committedRef = useRef(false);
  const [unlockMin, setUnlockMin] = useState(10);
  const [tts, setTts] = useState<TtsSettings>({ enabled: true, rate: 1.0 });

  // Start a session on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [session, mins, ttsSettings] = await Promise.all([
        startSession(seed),
        getUnlockMinutes(),
        getTtsSettings(),
      ]);
      if (!alive) return;
      sessionRef.current = session;
      setUnlockMin(mins);
      setTts(ttsSettings);
      setPhase(session.runner.isComplete ? "complete" : "question");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || committedRef.current) return;
    committedRef.current = true;
    await commitSession(session, { appKey: returnApp, unlocked: true });
    if (returnApp) {
      await setSuppressUntil(returnApp, suppressUntil(Date.now(), unlockMin));
    }
  }, [returnApp, unlockMin]);

  const rate = useCallback(
    (r: Rating) => {
      const runner = sessionRef.current?.runner;
      if (!runner) return;
      const res = runner.submitRating(r, Date.now());
      if (res.sessionComplete) {
        setPhase("complete");
        void finish();
      } else {
        rerender();
      }
    },
    [finish, rerender],
  );

  const undo = useCallback(() => {
    const runner = sessionRef.current?.runner;
    if (runner?.undoLastRating()) rerender();
  }, [rerender]);

  if (phase === "loading") {
    return (
      <div className="app">
        <div className="center-screen">
          <p className="muted">読み込み中…</p>
        </div>
      </div>
    );
  }

  const runner = sessionRef.current!.runner;

  if (phase === "complete") {
    return (
      <CompleteScreen
        runner={{ correct: runner.firstTryCorrect, total: runner.totalCards }}
        returnApp={returnApp}
        unlockMin={unlockMin}
        onExit={onExit}
      />
    );
  }

  const sentence = runner.currentSentence!;
  const cardId = runner.currentCardID!;
  const done = runner.resolvedCount;
  const total = runner.totalCards;

  return (
    <div className="app">
      <div className="quiz">
        <div className="quiz-head">
          <button className="iconbtn" onClick={onExit} aria-label="やめる">
            ✕
          </button>
          <div className="qbar">
            <div className="fill" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span className="pill">
            {done}/{total}
          </span>
        </div>

        <FlashcardCard key={cardId} sentence={sentence} onRate={rate} tts={tts} />

        <div className="quiz-foot">
          <button className="linkbtn" onClick={undo} disabled={!runner.canUndo}>
            ↩ 直前を取り消す
          </button>
        </div>
      </div>
    </div>
  );
}

function CompleteScreen({
  runner,
  returnApp,
  unlockMin,
  onExit,
}: {
  runner: { correct: number; total: number };
  returnApp: string | null;
  unlockMin: number;
  onExit: () => void;
}) {
  const knownPct = runner.total > 0 ? Math.round((100 * runner.correct) / runner.total) : 0;
  const target = returnApp ? returnTarget(returnApp) : undefined;

  function goBack() {
    const urls = target?.urlCandidates ?? [];
    if (urls.length > 0) {
      // Best-effort deep link back to the target app (scheme is app-defined).
      window.location.href = urls[0];
    }
  }

  return (
    <div className="app">
      <div className="center-screen">
        <div className="big-emoji">🎉</div>
        <h1>10問クリア</h1>
        <p>{returnApp ? `${unlockMin}分間ひらけます` : "今日のロシア語、進みました"}</p>
        <div className="done-stats">
          <div>
            <div className="val">{knownPct}%</div>
            <div className="lbl">既知率</div>
          </div>
          <div>
            <div className="val">{runner.total}</div>
            <div className="lbl">枚</div>
          </div>
        </div>
        {returnApp ? (
          <div className="stack" style={{ width: "100%" }}>
            <button className="btn primary block" onClick={goBack}>
              {returnDisplayName(returnApp)}に戻る
            </button>
            <button className="btn ghost block" onClick={onExit}>
              ホームへ
            </button>
          </div>
        ) : (
          <button className="btn primary block" onClick={onExit}>
            ホームへ戻る
          </button>
        )}
      </div>
    </div>
  );
}
