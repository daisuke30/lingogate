import { useCallback, useEffect, useRef, useState } from "react";
import { Rating } from "../engine/fsrs";
import { commitPartialSession, commitSession, startSession } from "../state/service";
import type { StartedSession } from "../state/service";
import { getUnlockMinutes, getTtsSettings, setSuppressUntil } from "../state/settings";
import type { TtsSettings } from "../state/settings";
import { suppressUntil, returnDisplayName, returnTarget } from "../engine/gate";
import { setQuizActive } from "../state/appUpdate";
import { FlashcardCard } from "./FlashcardCard";

type Phase = "loading" | "question" | "complete" | "batchComplete";

/**
 * Runs 10-card flashcard batches. `returnApp` (e.g. "tiktok") means this was
 * launched from /gate — always a single fixed 10-card toll; on completion we
 * set the suppression window and offer a "return" button.
 *
 * `continuous` (Home's "ロシア語を解く", LINGO-010 follow-up) loops: each
 * completed batch shows a summary with "続ける" (starts the next batch in
 * place) instead of bouncing to Home. The header "終了" is available at any
 * point mid-batch — whatever was graded so far is committed, the rest of the
 * batch is simply dropped (see state/service.ts commitPartialSession).
 */
export function QuizScreen({
  returnApp,
  seed,
  continuous,
  onExit,
}: {
  returnApp: string | null;
  seed?: number;
  continuous?: boolean;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const sessionRef = useRef<StartedSession | null>(null);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const committedRef = useRef(false); // guards double-commit between finish() and exitNow()
  const exitingRef = useRef(false); // guards a double-tap on "終了"
  const mountedRef = useRef(true);
  const [unlockMin, setUnlockMin] = useState(10);
  const [tts, setTts] = useState<TtsSettings>({ enabled: true, rate: 1.0 });
  const [batchNumber, setBatchNumber] = useState(1);

  // Tell the SW-update flow a session is on screen so a background update
  // never yanks a card out from under an in-progress flip/flick — the reload
  // it would otherwise trigger is deferred until this unmounts (LINGO-010
  // follow-up, 2026-08-26; see state/appUpdate.ts).
  useEffect(() => {
    setQuizActive(true);
    return () => {
      mountedRef.current = false;
      setQuizActive(false);
    };
  }, []);

  const loadBatch = useCallback(async () => {
    setPhase("loading");
    committedRef.current = false;
    const [session, mins, ttsSettings] = await Promise.all([
      startSession(seed),
      getUnlockMinutes(),
      getTtsSettings(),
    ]);
    if (!mountedRef.current) return;
    sessionRef.current = session;
    setUnlockMin(mins);
    setTts(ttsSettings);
    setPhase(session.runner.isComplete ? "complete" : "question");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the first batch on mount.
  useEffect(() => {
    void loadBatch();
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
        setPhase(continuous && !returnApp ? "batchComplete" : "complete");
        void finish();
      } else {
        rerender();
      }
    },
    [continuous, returnApp, finish, rerender],
  );

  const undo = useCallback(() => {
    const runner = sessionRef.current?.runner;
    if (runner?.undoLastRating()) rerender();
  }, [rerender]);

  // Leave at any point: commit whatever was graded so far (partial — no
  // GateSession stat row for an incomplete batch), drop the rest, go home.
  // Guarded so a double-tap or a race with finish() never double-commits.
  const exitNow = useCallback(async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    const session = sessionRef.current;
    if (session && !committedRef.current) {
      committedRef.current = true;
      await commitPartialSession(session);
    }
    onExit();
  }, [onExit]);

  const nextBatch = useCallback(() => {
    setBatchNumber((n) => n + 1);
    void loadBatch();
  }, [loadBatch]);

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

  if (phase === "batchComplete") {
    return (
      <BatchCompleteScreen
        runner={{ correct: runner.firstTryCorrect, total: runner.totalCards }}
        batchNumber={batchNumber}
        onContinue={nextBatch}
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
          <button className="iconbtn" onClick={() => void exitNow()} aria-label="終了">
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

/** Per-batch summary in continuous (Home practice) mode: "続ける" starts the
 * next 10-card batch in place; "終了" leaves (the just-finished batch is
 * already fully committed via finish(), so this is a plain exit). */
function BatchCompleteScreen({
  runner,
  batchNumber,
  onContinue,
  onExit,
}: {
  runner: { correct: number; total: number };
  batchNumber: number;
  onContinue: () => void;
  onExit: () => void;
}) {
  const knownPct = runner.total > 0 ? Math.round((100 * runner.correct) / runner.total) : 0;
  return (
    <div className="app">
      <div className="center-screen">
        <div className="big-emoji">✅</div>
        <h1>{batchNumber}セット目クリア</h1>
        <p>続けるか、ここで終えるか選べます</p>
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
        <div className="stack" style={{ width: "100%" }}>
          <button className="btn primary block" onClick={onContinue}>
            続ける（次の10問）
          </button>
          <button className="btn ghost block" onClick={onExit}>
            終了してホームへ
          </button>
        </div>
      </div>
    </div>
  );
}
