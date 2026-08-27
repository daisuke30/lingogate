import { useCallback, useEffect, useRef, useState } from "react";
import { Rating } from "../engine/fsrs";
import type { RatingSummary } from "../engine/session";
import {
  activeCourse,
  activeFrontLanguage,
  commitPartialSession,
  commitSession,
  startSession,
} from "../state/service";
import type { StartedSession } from "../state/service";
import { getUnlockMinutes, getTtsSettings, setSuppressUntil } from "../state/settings";
import type { TtsSettings } from "../state/settings";
import { resolveCourse } from "../content/courses";
import { suppressUntil, returnDisplayName, returnTarget } from "../engine/gate";
import { langName, useI18n, useT } from "../i18n/i18n";
import type { Lang } from "../i18n/i18n";
import { FlashcardCard } from "./FlashcardCard";

const BATCH_SIZE = 10;

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
  const t = useT();
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
  const [langs, setLangs] = useState<{ target: string; front: Lang }>({
    target: "ru",
    front: "en",
  });

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadBatch = useCallback(async () => {
    setPhase("loading");
    committedRef.current = false;
    const [session, mins, ttsSettings] = await Promise.all([
      startSession({ seed, continuous }),
      getUnlockMinutes(),
      getTtsSettings(),
    ]);
    if (!mountedRef.current) return;
    sessionRef.current = session;
    setUnlockMin(mins);
    setTts(ttsSettings);
    // startSession() -> loadStore() has already ensured the active course.
    setLangs({ target: resolveCourse(activeCourse()).targetLang, front: activeFrontLanguage() });
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
          <p className="muted">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  const runner = sessionRef.current!.runner;

  if (phase === "complete") {
    return (
      <CompleteScreen
        summary={runner.ratingSummary}
        returnApp={returnApp}
        unlockMin={unlockMin}
        targetLang={langs.target}
        onExit={onExit}
      />
    );
  }

  if (phase === "batchComplete") {
    return (
      <BatchCompleteScreen
        summary={runner.ratingSummary}
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
          <button className="iconbtn" onClick={() => void exitNow()} aria-label={t("quiz.exit")}>
            ✕
          </button>
          <div className="qbar">
            <div className="fill" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span className="pill">
            {done}/{total}
          </span>
        </div>

        <FlashcardCard
          key={cardId}
          sentence={sentence}
          onRate={rate}
          tts={tts}
          targetLang={langs.target}
          frontLang={langs.front}
        />

        <div className="quiz-foot">
          <button className="linkbtn" onClick={undo} disabled={!runner.canUndo}>
            {t("quiz.undo")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "10枚中 覚えていた n / 曖昧 m / 覚えていない k" — a per-card first-grading
 * tally (LINGO-010 follow-up, 2026-08-26; replaces a "正答率" % that read as a
 * test score when this is a spaced-repetition practice tool, not a quiz). */
function RatingBreakdown({ summary }: { summary: RatingSummary }) {
  const t = useT();
  return (
    <>
      <p className="muted" style={{ margin: "2px 0 0" }}>
        {t("quiz.breakdown.of", { n: summary.total })}
      </p>
      <div className="done-stats">
        <div>
          <div className="val">{summary.good}</div>
          <div className="lbl">{t("quiz.breakdown.good")}</div>
        </div>
        <div>
          <div className="val">{summary.hard}</div>
          <div className="lbl">{t("quiz.breakdown.hard")}</div>
        </div>
        <div>
          <div className="val">{summary.again}</div>
          <div className="lbl">{t("quiz.breakdown.again")}</div>
        </div>
      </div>
    </>
  );
}

function CompleteScreen({
  summary,
  returnApp,
  unlockMin,
  targetLang,
  onExit,
}: {
  summary: RatingSummary;
  returnApp: string | null;
  unlockMin: number;
  targetLang: string;
  onExit: () => void;
}) {
  const { lang, t } = useI18n();
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
        <h1>{t("quiz.complete.title", { n: BATCH_SIZE })}</h1>
        <p>
          {returnApp
            ? t("quiz.complete.unlockMsg", { min: unlockMin })
            : t("quiz.complete.practiceMsg", { lang: langName(lang, targetLang as Lang) })}
        </p>
        <RatingBreakdown summary={summary} />
        {returnApp ? (
          <div className="stack" style={{ width: "100%" }}>
            <button className="btn primary block" onClick={goBack}>
              {t("quiz.complete.returnTo", { app: returnDisplayName(returnApp) })}
            </button>
            <button className="btn ghost block" onClick={onExit}>
              {t("quiz.complete.home")}
            </button>
          </div>
        ) : (
          <button className="btn primary block" onClick={onExit}>
            {t("quiz.complete.homeReturn")}
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
  summary,
  batchNumber,
  onContinue,
  onExit,
}: {
  summary: RatingSummary;
  batchNumber: number;
  onContinue: () => void;
  onExit: () => void;
}) {
  const t = useT();
  return (
    <div className="app">
      <div className="center-screen">
        <div className="big-emoji">✅</div>
        <h1>{t("quiz.batch.title", { n: batchNumber })}</h1>
        <p>{t("quiz.batch.sub")}</p>
        <RatingBreakdown summary={summary} />
        <div className="stack" style={{ width: "100%" }}>
          <button className="btn primary block" onClick={onContinue}>
            {t("quiz.batch.continue")}
          </button>
          <button className="btn ghost block" onClick={onExit}>
            {t("quiz.batch.exit")}
          </button>
        </div>
      </div>
    </div>
  );
}
