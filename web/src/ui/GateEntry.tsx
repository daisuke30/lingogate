import { useEffect, useState } from "react";
import { getSuppressUntil } from "../state/settings";
import { isSuppressed, returnDisplayName, returnTarget } from "../engine/gate";
import { QuizScreen } from "./QuizScreen";

type Decision = "checking" | "quiz" | "skip";

/**
 * Entry point for /gate?return=<app>. If the target app is still inside its
 * suppression window (recently unlocked), skip the quiz and offer an immediate
 * return — matching the iOS "抑制ウィンドウ内は即復帰" behaviour. Otherwise run
 * the 10-card gate.
 */
export function GateEntry({ returnApp, onExit }: { returnApp: string | null; onExit: () => void }) {
  const [decision, setDecision] = useState<Decision>("checking");

  useEffect(() => {
    (async () => {
      if (!returnApp) {
        setDecision("quiz");
        return;
      }
      const until = await getSuppressUntil(returnApp);
      setDecision(isSuppressed(until, Date.now()) ? "skip" : "quiz");
    })();
  }, [returnApp]);

  if (decision === "checking") {
    return (
      <div className="app">
        <div className="center-screen">
          <p className="muted">確認中…</p>
        </div>
      </div>
    );
  }

  if (decision === "skip" && returnApp) {
    const target = returnTarget(returnApp);
    const goBack = () => {
      const urls = target?.urlCandidates ?? [];
      if (urls.length > 0) window.location.href = urls[0];
    };
    return (
      <div className="app">
        <div className="center-screen">
          <div className="big-emoji">✅</div>
          <h1>解除済み</h1>
          <p>まだ解除ウィンドウ内です。そのまま戻れます。</p>
          <div className="stack" style={{ width: "100%", marginTop: 22 }}>
            <button className="btn primary block" onClick={goBack}>
              {returnDisplayName(returnApp)}に戻る
            </button>
            <button className="btn ghost block" onClick={onExit}>
              ホームへ
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <QuizScreen returnApp={returnApp} onExit={onExit} />;
}
