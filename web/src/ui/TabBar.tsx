// LINGO-030 — bottom tab bar (学習 / 育成). Rendered by App only on the two
// top-level tabs; every immersive flow (gate/quiz/placement/onboarding) hides
// it (see petDisplay.showTabBar). Icons are tiny inline SVGs (no asset deps,
// matching the app's dependency-free art approach).

import { useI18n } from "../i18n/i18n";
import type { Route } from "./App";
import { activeTab } from "../pet/petDisplay";

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5v-12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5v-12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PawIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <ellipse cx="12" cy="16" rx="4.4" ry="3.6" />
      <circle cx="6.5" cy="12.5" r="1.9" />
      <circle cx="17.5" cy="12.5" r="1.9" />
      <circle cx="9" cy="8" r="1.9" />
      <circle cx="15" cy="8" r="1.9" />
    </svg>
  );
}

export function TabBar({ routeName, navigate }: { routeName: string; navigate: (r: Route) => void }) {
  const { t } = useI18n();
  const active = activeTab(routeName);
  return (
    <nav className="tabbar" aria-label={t("pet.title")}>
      <button
        type="button"
        className={"tabbar-item" + (active === "learn" ? " on" : "")}
        aria-current={active === "learn" ? "page" : undefined}
        onClick={() => navigate({ name: "home" })}
      >
        <BookIcon />
        <span>{t("tab.learn")}</span>
      </button>
      <button
        type="button"
        className={"tabbar-item" + (active === "raise" ? " on" : "")}
        aria-current={active === "raise" ? "page" : undefined}
        onClick={() => navigate({ name: "pet" })}
      >
        <PawIcon />
        <span>{t("tab.raise")}</span>
      </button>
    </nav>
  );
}
