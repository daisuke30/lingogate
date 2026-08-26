// LingoGate service worker — offline-first app shell.
//
// Strategy: precache the known static entry points at install, then cache-first
// with runtime population for every other same-origin GET (Vite emits
// hash-named JS/CSS whose names we can't know ahead of time, so we cache them on
// first fetch). After one online visit the app runs fully offline. Navigations
// fall back to the cached app shell ("/") so deep links like /gate?return=tiktok
// work offline too.
//
// CACHE is per-build (LINGO-010 follow-up, 2026-08-26): scripts/patch-sw-version.mjs
// replaces __BUILD_VERSION__ in dist/sw.js with the actual build stamp after
// `vite build`. A static cache name meant sw.js could look byte-identical
// across deploys, so the browser had no signal to install the new worker or
// evict the old cache — this makes every deploy produce a different sw.js
// (triggering the update check) and a fresh cache (old ones are swept below).
const CACHE = "lingogate-__BUILD_VERSION__";
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

// 2026-08-26 REDESIGN (black-screen incident, see state/appUpdate.ts for the
// full trace): install() used to call self.skipWaiting() unconditionally, so
// a newly-installed worker activated and claimed open pages on its own
// schedule regardless of what the page-side JS wanted — that's half of what
// turned a single real update into a reload loop. Now activation over an
// *existing* controller only ever happens via the explicit SKIP_WAITING
// message below, sent from exactly one boot-time check (once per tab
// session) or the manual "最新版に更新" button. A page's very first-ever SW
// install is unaffected: with no existing controller, the browser activates
// automatically regardless of skipWaiting.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The *only* path that activates a new worker over an existing controller —
// install() above no longer skips waiting on its own. Sent from
// state/appUpdate.ts: either the once-per-tab-session boot check, or the
// manual "最新版に更新" Settings button.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests: serve the SPA shell so any route works offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((m) => m || caches.match("/index.html"))),
    );
    return;
  }

  // Everything else: cache-first, populate on miss.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      });
    }),
  );
});
