import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { I18nProvider } from "./i18n/i18n";
import { registerServiceWorkerAutoUpdate } from "./state/appUpdate";
import "./ui/styles.css";

// React must get on screen no matter what — this is the only thing in this
// file that can put pixels on screen, so it runs first and is wrapped
// defensively (2026-08-26, post black-screen incident: SW/update-check logic
// must never be able to block or blank the app; see state/appUpdate.ts).
function boot(): void {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("lingogate: #root element missing");
  createRoot(rootEl).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
}

try {
  boot();
} catch (err) {
  console.error("lingogate: failed to render app", err);
}

// Service worker registration/update-check is production-only (in dev it
// would cache stale modules and fight Vite's HMR), deliberately wired up
// *after* the render above on `load` so it can never delay first paint, and
// fully isolated: registerServiceWorkerAutoUpdate() catches every internal
// failure itself, and the .catch() here is a second line of defense in case
// anything still escapes. See state/appUpdate.ts for the update flow (applies
// at most one pending update, once per tab session, at boot — no automatic
// reload while the app is in use).
if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void registerServiceWorkerAutoUpdate().catch((err) => {
      console.error("lingogate: service worker update check failed", err);
    });
  });
}
