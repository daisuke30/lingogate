import { useEffect, useState } from "react";
import { HomeView } from "./HomeView";
import { QuizScreen } from "./QuizScreen";
import { SettingsView } from "./SettingsView";
import { AutomationGuideView } from "./AutomationGuideView";
import { GateEntry } from "./GateEntry";
import { CalibrationScreen } from "./CalibrationScreen";

export type Route =
  | { name: "home" }
  | { name: "quiz"; returnApp: string | null; seed?: number }
  | { name: "gate"; returnApp: string | null }
  | { name: "settings" }
  | { name: "guide" }
  | { name: "calibration" };

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
      return <QuizScreen returnApp={route.returnApp} seed={route.seed} onExit={goHome} />;
    case "gate":
      return <GateEntry returnApp={route.returnApp} onExit={goHome} />;
    case "settings":
      return <SettingsView onBack={goHome} />;
    case "guide":
      return <AutomationGuideView onBack={goHome} />;
    case "calibration":
      return <CalibrationScreen onExit={goHome} />;
  }
}
