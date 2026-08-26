import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { registerServiceWorkerAutoUpdate } from "./state/appUpdate";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker only in a production build; in dev it would cache
// stale modules and fight Vite's HMR. See state/appUpdate.ts for the auto-update
// flow (registration.update() on load, skipWaiting handoff, guarded reload).
if (import.meta.env.PROD) {
  window.addEventListener("load", registerServiceWorkerAutoUpdate);
}
