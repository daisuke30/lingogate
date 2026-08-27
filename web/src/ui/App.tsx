import { useEffect, useState } from "react";
import { HomeView } from "./HomeView";
import { QuizScreen } from "./QuizScreen";
import { SettingsView } from "./SettingsView";
import { AutomationGuideView } from "./AutomationGuideView";
import { GateEntry } from "./GateEntry";
import { PlacementScreen } from "./PlacementScreen";

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
  | { name: "placement" };

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
      return <SettingsView onBack={goHome} />;
    case "guide":
      return <AutomationGuideView onBack={goHome} />;
    case "placement":
      return <PlacementScreen onExit={goHome} />;
  }
}
