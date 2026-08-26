// Service-worker update plumbing (LINGO-010 follow-up).
//
// 2026-08-26 REDESIGN — after a black-screen incident on Katsuta's iPhone.
//
// Root cause (traced, not guessed): the previous version reloaded
// automatically on every `controllerchange` event, guarded only by an
// in-memory `let reloaded` flag in this module. `location.reload()` performs
// a full navigation, which discards the entire JS heap — every module-level
// variable, including that guard, resets to its initial value on the reloaded
// page. During the session that shipped that version we *also* deployed four
// distinct builds in quick succession (each with a different cache-name
// stamp, by design, so each looked like a genuine update to the browser). A
// device that reloaded to pick up build N could easily find build N+1 already
// available moments later (registration.update() ran again on the fresh page
// load), fire another real controllerchange, and reload again — the "guard"
// could never stop this because it never survived the reload that triggered
// it. Rapid repeated reloads on iOS Safari present as a frozen/black screen:
// React never gets a full paint before the next reload interrupts it.
// Separately, sw.js's `install` handler called `self.skipWaiting()`
// unconditionally, so a newly-installed worker activated and (via
// `clients.claim()`) took over the open page on its *own* schedule regardless
// of anything this module did — the page-side "defer while a quiz is active"
// logic never actually stopped the underlying activation, only delayed the
// reload() call itself, which is precisely the mechanism above kept re-firing.
//
// New design (Katsuta's explicit direction): no automatic reload while the
// app is in use, ever.
//   - On boot only: if a worker is already `waiting` (found on a *previous*
//     visit), activate it and reload — but at most once per browser tab
//     session. The guard is sessionStorage, not a JS variable, specifically
//     because it must survive the reload it causes.
//   - `registration.update()` still runs on every boot to check for a new
//     version, but anything it finds is left sitting as `waiting` — picked up
//     on the *next* boot (new session -> sessionStorage flag cleared), or via
//     the manual "最新版に更新" Settings button. Never mid-session.
//   - sw.js's `install` handler no longer force-skips waiting; only an
//     explicit `{type:'SKIP_WAITING'}` message (sent from exactly the two
//     places in this file that intend an immediate activation) does. A page's
//     very first-ever SW install is unaffected either way: with no existing
//     controller, the browser activates a new worker automatically regardless
//     of skipWaiting.

const RELOAD_ONCE_KEY = "lingogate.swReloadedThisSession";

function alreadyReloadedThisSession(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_ONCE_KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode etc.) — fail open, worst case one extra reload
  }
}

function markReloadedThisSession(): void {
  try {
    sessionStorage.setItem(RELOAD_ONCE_KEY, "1");
  } catch {
    /* ignore — see alreadyReloadedThisSession */
  }
}

/** Reload exactly once, the next time (and only the next time) the SW
 * controlling this page changes. */
function reloadOnNextControllerChange(): void {
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {
    once: true,
  });
}

/** Boot-time only: activate an already-waiting worker and reload — but at
 * most once per tab session (see RELOAD_ONCE_KEY above). No-ops if nothing is
 * waiting, or if this session already used its one reload. */
function applyWaitingUpdateOnce(registration: ServiceWorkerRegistration): void {
  if (!registration.waiting) return;
  if (alreadyReloadedThisSession()) return;
  markReloadedThisSession(); // set *before* reloading — must survive the reload it causes
  reloadOnNextControllerChange();
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
}

/** Registers the SW and applies at most one pending update, once, at boot.
 * Every failure mode is caught internally so a broken SW/update check can
 * never throw into the caller — React has already rendered by the time this
 * runs (see main.tsx: SW registration is deliberately wired up after the
 * initial render, on `load`), and this function's own promise rejecting must
 * not be able to affect anything else either. */
export async function registerServiceWorkerAutoUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    applyWaitingUpdateOnce(registration);
    // Check for a newer version in the background. Anything found here is
    // deliberately left as `waiting` for the *next* boot (or the manual
    // button) — never acted on automatically mid-session.
    registration.update().catch(() => {});
  } catch {
    /* offline support / SW registration is best-effort */
  }
}

export type UpdateCheckResult = "updating" | "up-to-date" | "unsupported";

/** Manual "最新版に更新" (Settings button). Unlike the boot-time flow, this
 * always applies an update immediately if one is found — it is an explicit,
 * one-off user action, not a background/automatic reload, so the usual
 * "never mid-session" caution doesn't apply here. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "unsupported";
  try {
    await reg.update();
  } catch {
    // Offline or transient failure — fall through to whatever's already there.
  }
  if (reg.waiting) {
    reloadOnNextControllerChange();
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
    return "updating";
  }
  if (reg.installing) {
    const worker = reg.installing;
    worker.addEventListener("statechange", function onChange() {
      if (worker.state === "installed") {
        worker.removeEventListener("statechange", onChange);
        reloadOnNextControllerChange();
        worker.postMessage({ type: "SKIP_WAITING" });
      }
    });
    return "updating";
  }
  return "up-to-date";
}

/** For the Settings "次回起動時に適用" hint: true if a new version has
 * already been fetched and is sitting `waiting` (or still `installing`) —
 * i.e. it will apply on the *next* boot even without pressing the button. */
export async function hasPendingUpdate(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg?.waiting || reg?.installing);
}
