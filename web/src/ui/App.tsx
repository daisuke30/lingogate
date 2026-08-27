import { useEffect, useState } from "react";
import { HomeView } from "./HomeView";
import { QuizScreen } from "./QuizScreen";
import { SettingsView } from "./SettingsView";
import { AutomationGuideView } from "./AutomationGuideView";
import { GateEntry } from "./GateEntry";
import { PlacementScreen } from "./PlacementScreen";
import { OnboardingFlow } from "./OnboardingFlow";
import { shouldShowOnboarding } from "../state/onboarding";

export type Route =
  | { name: "home" }
  // continuous: Home's "10問を解く" loops batch-after-batch until the learner
  // taps "終了" (LINGO-010 follow-up). /gate never sets this — gate stays a
  // single fixed 10-card toll.
  | { name: "quiz"; returnApp: string | null; seed?: number; continuous?: boolean }
  | { name: "gate"; returnApp: string | null }
  | { name: "settings" }
  | { name: "guide" }
  // LINGO-016: adaptive placement test (replaces the old fixed "calibration"
  // linear-triage flow — CalibrationScreen.tsx is retired, kept in git history).
  | { name: "placement" }
  // LINGO-017: "firstRun" = the automatic first-launch funnel (finishing leads
  // to course-select -> placement); "settings" = a replay via Settings' "アプ
  // リの説明を見る" (finishing/skipping just returns to Settings).
  | { name: "onboarding"; origin: "firstRun" | "settings" };

function routeFromLocation(): Route {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (path.startsWith("/gate")) {
    return { name: "gate", returnApp: params.get("return") };
  }
  return { name: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromLocation);

  // Keep in sync with browser back/forward.
  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // First-run onboarding (LINGO-017): only ever offered from the plain "/"
  // home route — never from /gate (an automation-triggered interrupt must
  // never be hijacked by a 5-screen intro). shouldShowOnboarding() is false
  // for both an existing user (any course already has progress) and anyone
  // who has already finished/skipped it once, so this is a no-op after the
  // very first check.
  useEffect(() => {
    if (route.name !== "home") return;
    let alive = true;
    shouldShowOnboarding().then((show) => {
      if (alive && show) navigate({ name: "onboarding", origin: "firstRun" });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name]);

  function navigate(next: Route) {
    // Only the URL-addressable routes update the address bar; in-app views are
    // pushed as history entries pointing back at "/" so Back returns home.
    if (next.name === "home") {
      window.history.pushState({}, "", "/");
    } else if (next.name === "gate") {
      const q = next.returnApp ? `?return=${encodeURIComponent(next.returnApp)}` : "";
      window.history.pushState({}, "", `/gate${q}`);
    } else {
      window.history.pushState({}, "", "/");
    }
    setRoute(next);
  }

  const goHome = () => navigate({ name: "home" });

  switch (route.name) {
    case "home":
      return <HomeView navigate={navigate} />;
    case "quiz":
      return (
        <QuizScreen
          returnApp={route.returnApp}
          seed={route.seed}
          continuous={route.continuous}
          onExit={goHome}
        />
      );
    case "gate":
      return <GateEntry returnApp={route.returnApp} onExit={goHome} />;
    case "settings":
      return (
        <SettingsView
          onBack={goHome}
          onShowOnboarding={() => navigate({ name: "onboarding", origin: "settings" })}
        />
      );
    case "guide":
      return <AutomationGuideView onBack={goHome} />;
    case "placement":
      return <PlacementScreen onExit={goHome} />;
    case "onboarding":
      return (
        <OnboardingFlow
          origin={route.origin}
          onFinish={(dest) => {
            if (dest === "placement") navigate({ name: "placement" });
            else if (dest === "settings") navigate({ name: "settings" });
            else navigate({ name: "home" });
          }}
        />
      );
  }
}
