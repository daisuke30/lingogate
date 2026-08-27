import { useEffect, useState } from "react";
import { getSuppressUntil } from "../state/settings";
import { isSuppressed, returnDisplayName, returnTarget } from "../engine/gate";
import { useT } from "../i18n/i18n";
import { QuizScreen } from "./QuizScreen";

type Decision = "checking" | "quiz" | "skip";

/**
 * Entry point for /gate?return=<app>. If the target app is still inside its
 * suppression window (recently unlocked), skip the quiz and offer an immediate
 * return — matching the iOS "抑制ウィンドウ内は即復帰" behaviour. Otherwise run
 * the 10-card gate.
 */
export function GateEntry({ returnApp, onExit }: { returnApp: string | null; onExit: () => void }) {
  const t = useT();
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
          <p className="muted">{t("common.checking")}</p>
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
          <h1>{t("gate.unlockedTitle")}</h1>
          <p>{t("gate.unlockedMsg")}</p>
          <div className="stack" style={{ width: "100%", marginTop: 22 }}>
            <button className="btn primary block" onClick={goBack}>
              {t("quiz.complete.returnTo", { app: returnDisplayName(returnApp) })}
            </button>
            <button className="btn ghost block" onClick={onExit}>
              {t("quiz.complete.home")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <QuizScreen returnApp={returnApp} onExit={onExit} />;
}
