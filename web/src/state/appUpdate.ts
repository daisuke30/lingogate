// Service-worker update plumbing (LINGO-010 follow-up, 2026-08-26). Bug: an
// old SW (static cache name, deployed before the versioned-cache fix) can sit
// installed on a device indefinitely — iOS PWAs in particular don't reliably
// re-check for updates on their own, so a phone can be stuck showing a build
// from before the calibration/continuous-mode work shipped with no user-visible
// signal that anything is wrong. This module wires an active update flow:
// explicit `registration.update()` calls, immediate skipWaiting handoff once a
// new worker installs, and a single guarded reload on controllerchange — but
// never mid-quiz, so a card flip never gets yanked out from under the learner.

let quizActive = false;
let reloadPending = false;
let reloaded = false; // guards against a reload loop if controllerchange fires more than once

/** Mark whether a quiz session (question phase) is currently on screen. A
 * pending reload (from an SW update taking control) is deferred until this
 * flips back to false. */
export function setQuizActive(active: boolean): void {
  quizActive = active;
  if (!active && reloadPending) {
    doReload();
  }
}

/** Called from the `controllerchange` handler: reload to pick up the new SW's
 * assets, unless a quiz is in progress (in which case it's deferred). */
export function requestReloadForUpdate(): void {
  if (quizActive) {
    reloadPending = true;
    return;
  }
  doReload();
}

function doReload(): void {
  if (reloaded) return; // never more than one reload per controllerchange sequence
  reloaded = true;
  location.reload();
}

export type UpdateCheckResult = "updating" | "up-to-date" | "unsupported";

/** Explicit "check for updates now" — used by main.tsx on load and by the
 * Settings "最新版に更新" button. Forces a registration.update() (iOS PWAs can
 * be slow to do this on their own), and if a new worker is already waiting,
 * asks it to skip waiting immediately rather than waiting for the next
 * `updatefound`/statechange cycle. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "unsupported";
  try {
    await reg.update();
  } catch {
    // Offline or transient failure — treat as "nothing new found" rather than crash.
    return reg.waiting || reg.installing ? "updating" : "up-to-date";
  }
  if (reg.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
    return "updating";
  }
  if (reg.installing) {
    // The `updatefound` listener registered in main.tsx will postMessage
    // SKIP_WAITING once this worker reaches "installed".
    return "updating";
  }
  return "up-to-date";
}

/** Registers the full auto-update flow. Call once, in production only (in dev
 * the SW isn't registered at all — see main.tsx). */
export function registerServiceWorkerAutoUpdate(): void {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      // iOS PWAs (home-screen installs especially) can go a long time without
      // checking for updates on their own — ask explicitly on every load.
      registration.update().catch(() => {});

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          // "installed" + an existing controller = a genuine update (not the
          // very first install, which has no controller yet). Ask the new
          // worker to activate immediately instead of waiting for all tabs
          // to close.
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    })
    .catch(() => {
      /* offline support is best-effort */
    });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    requestReloadForUpdate();
  });
}
