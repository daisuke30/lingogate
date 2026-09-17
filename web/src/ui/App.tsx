import { useEffect, useState } from "react";
import { HomeView } from "./HomeView";
import { QuizScreen } from "./QuizScreen";
import { SettingsView } from "./SettingsView";
import { AutomationGuideView } from "./AutomationGuideView";
import { GateEntry } from "./GateEntry";
import { PlacementScreen } from "./PlacementScreen";
import { OnboardingFlow } from "./OnboardingFlow";
import { shouldShowOnboarding } from "../state/onboarding";
// LINGO-028: dev-only art preview, reached only by typing /pet-gallery. Not
// linked from any production nav. Lives entirely under src/pet/art/.
import { PetGallery } from "../pet/art/PetGallery";
// LINGO-030: 育成 tab + bottom tab bar.
import { PetView } from "./PetView";
// LINGO-049: reachable straight from a URL so the diagnostics panel can be
// screenshotted on a simulator/device without any tapping.
import { DiagnosticsSheet } from "./DiagnosticsSheet";
import { TabBar } from "./TabBar";
import { petAttention, showTabBar } from "../pet/petDisplay";
// LINGO-040: the pet read-model is owned here now, not by HomeView. Two
// consumers need it (Home's streak chip and the 育成 tab's attention dot), and
// reading it once at this level means they cannot disagree — and Home no
// longer carries a mini pet row that duplicated the tab bar beneath it.
import { peekPet } from "../state/pet";
import { overdueReviewCount } from "../state/service";
import type { PetSnapshot } from "../pet/engine";

export type Route =
  | { name: "home" }
  // continuous: Home's "10問を解く" loops batch-after-batch until the learner
  // taps "終了" (LINGO-010 follow-up). /gate never sets this — gate stays a
  // single fixed 10-card toll.
  // LINGO-050: `notes: true` runs a マイノート session (the learner's own
  // note/lesson imports) instead of the core curriculum. Same FSRS, same
  // rewards — a different pool, chosen deliberately.
  | { name: "quiz"; returnApp: string | null; seed?: number; continuous?: boolean; notes?: boolean }
  | { name: "gate"; returnApp: string | null }
  | { name: "settings" }
  | { name: "guide" }
  // LINGO-016: adaptive placement test (replaces the old fixed "calibration"
  // linear-triage flow — CalibrationScreen.tsx is retired, kept in git history).
  | { name: "placement" }
  // LINGO-017: "firstRun" = the automatic first-launch funnel (finishing leads
  // to course-select -> placement); "settings" = a replay via Settings' "アプ
  // リの説明を見る" (finishing/skipping just returns to Settings).
  | { name: "onboarding"; origin: "firstRun" | "settings" }
  // LINGO-028: dev-only art gallery (all 16 monsters × 4 faces + care props).
  | { name: "petGallery" }
  // LINGO-030: 育成 tab (the pet screen), reached from the bottom tab bar.
  | { name: "pet" };

/**
 * LINGO-049 — URL switches for measuring the app on a real device.
 *
 * The bottom-of-screen bug has only ever been observable on Katsuta's iPhone,
 * and asking him for a screenshot each round is both slow and his job to
 * refuse. These let whoever is debugging drive an iOS Simulator (real WebKit,
 * real safe-area insets) straight to the state they need to photograph:
 *
 *   /?diag=1  or  /diag            open the diagnostics panel immediately
 *   /?skipOnboarding=1             go straight to Home, no 5-screen intro
 *
 * Query-only and undocumented in the UI, so no ordinary user meets them; they
 * change nothing about what the app does, only which screen it opens on.
 */
export function debugFlags(): { diag: boolean; skipOnboarding: boolean } {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  // Either spelling of "show me the diagnostics" also implies "and don't put
  // the intro in front of it" — otherwise /diag lands on screen 1 of 5 with
  // the panel behind it, which is what the flag exists to avoid.
  const diag = path.startsWith("/diag") || params.get("diag") === "1";
  return { diag, skipOnboarding: diag || params.get("skipOnboarding") === "1" };
}

function routeFromLocation(): Route {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  // /diag renders Home (so the tab bar and the real shell are on screen and
  // therefore measurable) with the panel open over it.
  if (path.startsWith("/diag")) {
    return { name: "home" };
  }
  if (path.startsWith("/gate")) {
    return { name: "gate", returnApp: params.get("return") };
  }
  if (path.startsWith("/pet-gallery")) {
    return { name: "petGallery" };
  }
  if (path.startsWith("/pet")) {
    return { name: "pet" };
  }
  return { name: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [petSnap, setPetSnap] = useState<PetSnapshot | null>(null);
  const [diagOpen, setDiagOpen] = useState(() => debugFlags().diag);

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
    // LINGO-049: the debug switches win over the intro, so a simulator lands on
    // the screen being measured instead of on screen 1 of 5.
    if (debugFlags().skipOnboarding) return;
    let alive = true;
    shouldShowOnboarding().then((show) => {
      if (alive && show) navigate({ name: "onboarding", origin: "firstRun" });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name]);

  // Re-read the pet whenever a tabbed screen comes into view (feeding on the
  // 育成 tab must clear the dot as soon as the learner is back on 学習).
  // peekPet never ticks, so this can't trigger a hatch/evolve/depart — only
  // PetView's own tickPet does that.
  useEffect(() => {
    if (!showTabBar(route.name)) return;
    let alive = true;
    overdueReviewCount()
      .then((overdue) => peekPet(overdue))
      .then((s) => {
        if (alive) setPetSnap(s);
      })
      .catch((err) => console.error("peekPet failed", err));
    return () => {
      alive = false;
    };
  }, [route.name]);

  function navigate(next: Route) {
    // Only the URL-addressable routes update the address bar; in-app views are
    // pushed as history entries pointing back at "/" so Back returns home.
    if (next.name === "home") {
      window.history.pushState({}, "", "/");
    } else if (next.name === "gate") {
      const q = next.returnApp ? `?return=${encodeURIComponent(next.returnApp)}` : "";
      window.history.pushState({}, "", `/gate${q}`);
    } else if (next.name === "petGallery") {
      window.history.pushState({}, "", "/pet-gallery");
    } else if (next.name === "pet") {
      window.history.pushState({}, "", "/pet");
    } else {
      window.history.pushState({}, "", "/");
    }
    setRoute(next);
  }

  const goHome = () => navigate({ name: "home" });

  function renderRoute() {
    switch (route.name) {
      case "home":
        return <HomeView navigate={navigate} petSnap={petSnap} />;
      case "quiz":
        return (
          <QuizScreen
            returnApp={route.returnApp}
            seed={route.seed}
            continuous={route.continuous}
            notes={route.notes}
            onExit={goHome}
            onGoToPet={() => navigate({ name: "pet" })}
          />
        );
      case "gate":
        return <GateEntry returnApp={route.returnApp} onExit={goHome} />;
      case "settings":
        return (
          <SettingsView
            onBack={goHome}
            onShowOnboarding={() => navigate({ name: "onboarding", origin: "settings" })}
            navigate={navigate}
          />
        );
      case "guide":
        return <AutomationGuideView onBack={goHome} />;
      case "placement":
        return <PlacementScreen onExit={goHome} />;
      case "petGallery":
        return <PetGallery onBack={goHome} />;
      case "pet":
        return <PetView />;
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

  return (
    <>
      {renderRoute()}
      <DiagnosticsSheet open={diagOpen} onClose={() => setDiagOpen(false)} />
      {showTabBar(route.name) && (
        <TabBar
          routeName={route.name}
          navigate={navigate}
          raiseAttention={
            petSnap != null && (petAttention(petSnap).hungry || petAttention(petSnap).dirty)
          }
        />
      )}
    </>
  );
}
