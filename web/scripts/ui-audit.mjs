// Visual + layout audit of the real running app (LINGO-042).
//
// WHY THIS EXISTS
// LINGO-040 shipped a settings screen on which every row was invisible. Vitest
// was green (432/432), `tsc -b` was clean, the build succeeded, the deployed
// URLs returned 200, and the browser console was silent — because the DOM was
// perfectly correct. A flex-shrink bug had collapsed the rows' `overflow:
// hidden` container to 2px, so the markup existed and simply never painted.
//
// No unit test can catch that: it is a property of the laid-out page, not of
// the component tree. So this script drives the real app in a real browser and
// asserts on GEOMETRY — "this row is at least 40px tall and inside the
// viewport" — not just on the existence of elements. Screenshots are captured
// too, but they are evidence for a human, not the gate: the gate is the
// assertions, because a screenshot nobody opens catches nothing.
//
// USAGE
//   npm run ui-audit                 # audits the local production preview
//   npm run ui-audit -- <base-url>   # audits a deployment (e.g. after deploy)
//   npm run ui-audit -- <url> <dir>  # also choose where screenshots land
//
// Exits non-zero on any failure. Every deploy must pass it — see README.

import { chromium, webkit, devices } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const argBase = process.argv[2];
const outDir = process.argv[3] || "ui-audit-out";

// With no URL given, audit the local production build — and start (and later
// stop) the preview server ourselves, so `npm run ui-audit` is one command
// that always works rather than a script that fails unless you remembered to
// run `npm run preview` in another terminal first.
let preview = null;
async function ensureLocalServer(url) {
  const reachable = await fetch(url).then((r) => r.ok).catch(() => false);
  if (reachable) return;
  preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], {
    stdio: "ignore",
    detached: false,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await fetch(url).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("ui-audit: vite preview did not come up on http://localhost:4173");
}

const base = (argBase || "http://localhost:4173").replace(/\/$/, "");
if (!argBase) await ensureLocalServer(base + "/");

const VIEWPORT = { width: 390, height: 844 }; // iPhone 14-ish, Katsuta's device class

const failures = [];
const notes = [];

await mkdir(outDir, { recursive: true });

/**
 * The whole audit, run once per browser engine. Chromium alone was not enough:
 * Katsuta's device is an iPhone, and the bugs that reach him live in WebKit's
 * rendering (LINGO-045 — a translucent tab bar that let content show through
 * it, and a `color-mix()` background with no fallback that older Safari would
 * have dropped entirely). Failures are prefixed with the engine so a
 * WebKit-only regression is obvious.
 */
async function runAudit(engineName, engine) {
const label0 = engineName;
function check(ok, message) {
  if (!ok) failures.push(`[${label0}] ${message}`);
  return ok;
}
const browser = await engine.launch();
const page = await browser.newPage({ ...devices["iPhone 13"], viewport: VIEWPORT });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 300)));

const shot = (name) => page.screenshot({ path: `${outDir}/${engineName}-${name}.png`, fullPage: false });

/** Geometry of the first match, as the user's screen sees it. */
async function boxOf(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      top: Math.round(r.top),
      left: Math.round(r.left),
      right: Math.round(r.right),
      scrollH: el.scrollHeight,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
    };
  }, selector);
}

/**
 * The assertion that would have caught LINGO-040's regression: an element that
 * exists in the DOM but is clipped, collapsed or pushed off-screen is a broken
 * element, however correct its markup.
 */
async function assertReallyVisible(selector, label, minHeight = 40) {
  const b = await boxOf(selector);
  if (!check(b !== null, `${label}: '${selector}' not in the DOM`)) return null;
  check(b.h >= minHeight, `${label}: only ${b.h}px tall (expected >= ${minHeight}px)`);
  check(
    b.scrollH <= b.h + 2,
    `${label}: content is clipped — scrollHeight ${b.scrollH}px inside a ${b.h}px box`,
  );
  check(b.w > 0 && b.visibility !== "hidden" && Number(b.opacity) > 0.01, `${label}: not painted`);
  check(b.left >= 0 && b.right <= VIEWPORT.width, `${label}: outside the viewport horizontally`);
  return b;
}

/** Nothing may sit flush against the screen edge (the details-sheet bug). */
async function assertHasSideMargin(selector, label, min = 8) {
  const b = await boxOf(selector);
  if (!check(b !== null, `${label}: '${selector}' not in the DOM`)) return;
  check(
    b.left >= min && VIEWPORT.width - b.right >= min,
    `${label}: touches the screen edge (left ${b.left}px, right gap ${VIEWPORT.width - b.right}px)`,
  );
}

/** The page must never be able to scroll sideways. */
async function assertNoHorizontalOverflow(label) {
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    const root = document.querySelector("#root");
    return Math.max(d.scrollWidth - d.clientWidth, root ? root.scrollWidth - root.clientWidth : 0);
  });
  check(over <= 1, `${label}: horizontal overflow of ${over}px`);
}

/**
 * The bottom "black band": the strip of page just above the fixed tab bar must
 * be painted in the app's own background, and the tab bar must sit flush with
 * the bottom of the viewport with no unpainted gap beneath it.
 *
 * Done in the page rather than by sampling image pixels, so it needs no
 * optional native module and can never silently skip — a gate that quietly
 * passes when a dependency is missing is not a gate.
 */
async function assertNoBottomBand(label) {
  const r = await page.evaluate(() => {
    const tabbar = document.querySelector(".tabbar");
    if (!tabbar) return { noTabbar: true };
    const tb = tabbar.getBoundingClientRect();
    const pageBg = getComputedStyle(document.querySelector("#root")).backgroundColor;
    // What is painted immediately above the bar, at the left edge (outside the
    // centred .app column on wide screens, inside it on phones)?
    const probeY = Math.round(tb.top - 6);
    const el = document.elementFromPoint(4, probeY);
    let bg = "rgba(0, 0, 0, 0)";
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
        bg = c;
        break;
      }
    }
    return {
      pageBg,
      bgAboveTabbar: bg,
      gapBelowTabbar: Math.round(window.innerHeight - tb.bottom),
      tabbarHeight: Math.round(tb.height),
    };
  });
  if (r.noTabbar) {
    check(false, `${label}: tab bar missing, cannot check the bottom band`);
    return;
  }
  check(
    r.bgAboveTabbar === r.pageBg,
    `${label}: strip above the tab bar is ${r.bgAboveTabbar}, page background is ${r.pageBg}`,
  );
  check(
    r.gapBelowTabbar <= 0,
    `${label}: ${r.gapBelowTabbar}px of unpainted page below the tab bar`,
  );
}

/**
 * Background continuity (LINGO-045). Katsuta reported a "black space" at the
 * bottom of Home and the pet tab on a real iPhone that no Chromium check saw.
 * There was no gap — the causes were tonal, and these assertions pin them:
 *
 *  - the tab bar must be OPAQUE. It used to be `color-mix(... 92%, transparent)`
 *    over a near-black page, so content scrolled visibly through it and it did
 *    not read as a bar at all.
 *  - it must be exactly the same colour as the strip painted below it for the
 *    home indicator. Those two differed (translucent bar vs solid ::after), so
 *    on a device with a safe-area inset they met in a visible seam — invisible
 *    in headless testing, where env(safe-area-inset-bottom) is 0.
 *  - html / body / #root must all paint the same base colour, so no ancestor
 *    can show a different shade through any gap.
 */
async function assertBackgroundContinuity(label) {
  const r = await page.evaluate(() => {
    const tabbar = document.querySelector(".tabbar");
    const bg = (el, pseudo) => (el ? getComputedStyle(el, pseudo).backgroundColor : null);
    return {
      html: bg(document.documentElement),
      body: bg(document.body),
      root: bg(document.querySelector("#root")),
      tabbar: tabbar ? bg(tabbar) : null,
      tabbarAfter: tabbar ? bg(tabbar, "::after") : null,
      tabbarRaw: tabbar ? getComputedStyle(tabbar).background : null,
    };
  });
  if (!r.tabbar) return; // screens without a tab bar
  // Computed colours arrive as `rgb()`, `rgba()` or — for a color-mix() result —
  // `color(srgb r g b / a)`. Alpha has to be read out of all three forms, or
  // the very case this guards against (a translucent bar) reads as opaque.
  const alpha = (c) => {
    if (!c) return 1;
    const slash = /\/\s*([\d.]+)\s*\)/.exec(c); // color(srgb ... / 0.92)
    if (slash) return Number(slash[1]);
    const rgba = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(c);
    return rgba ? Number(rgba[1]) : 1;
  };
  check(
    alpha(r.tabbar) === 1,
    `${label}: tab bar is translucent (${r.tabbar}) — content scrolls visibly through it`,
  );
  check(
    r.tabbar === r.tabbarAfter,
    `${label}: tab bar (${r.tabbar}) and the strip beneath it (${r.tabbarAfter}) are different colours — a seam appears wherever the safe-area inset is non-zero`,
  );
  check(
    r.html === r.body && r.body === r.root,
    `${label}: page base colours differ — html ${r.html}, body ${r.body}, #root ${r.root}`,
  );
}

/** #root must be the only scroller: html/body never move (iOS bounce fix). */
async function assertRootIsTheScroller(label) {
  const r = await page.evaluate(() => {
    const root = document.querySelector("#root");
    return {
      docScrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
      rootClientH: root.clientHeight,
      innerH: window.innerHeight,
      rootScrollH: root.scrollHeight,
    };
  });
  check(r.docScrollTop === 0 && r.bodyScrollTop === 0, `${label}: the document itself scrolled`);
  check(
    Math.abs(r.rootClientH - r.innerH) <= 1,
    `${label}: #root is ${r.rootClientH}px in a ${r.innerH}px viewport`,
  );
}

/** Scroll #root to the bottom and confirm it actually moved. */
async function scrollToBottom() {
  return page.evaluate(() => {
    const root = document.querySelector("#root");
    root.scrollTop = root.scrollHeight;
    return { scrollTop: Math.round(root.scrollTop), scrollable: root.scrollHeight > root.clientHeight };
  });
}

/** The last row of a long screen must be fully clear of the fixed tab bar. */
async function assertLastRowReachable(selector, label) {
  const r = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    if (!els.length) return null;
    const last = els[els.length - 1].getBoundingClientRect();
    const tabbar = document.querySelector(".tabbar");
    const limit = tabbar ? tabbar.getBoundingClientRect().top : window.innerHeight;
    return { bottom: Math.round(last.bottom), h: Math.round(last.height), limit: Math.round(limit) };
  }, selector);
  if (!check(r !== null, `${label}: no '${selector}' to check`)) return;
  check(r.h >= 40, `${label}: last row only ${r.h}px tall`);
  check(r.bottom <= r.limit + 1, `${label}: last row is hidden behind the tab bar / viewport edge`);
}

/**
 * Dismiss the first-run intro if it is up. Scoped to `.onboard`: Home's own
 * "あとで（すぐ始める）" button also matches a loose "あとで" search, and
 * clicking that starts a quiz — which silently took the audit off the screen
 * it was about to assert on.
 */
async function dismissOnboarding() {
  const onboard = page.locator(".onboard");
  if (!(await onboard.count())) return;
  for (const label of ["スキップ", "Skip", "Пропустить"]) {
    const el = onboard.getByText(label, { exact: false }).first();
    if (await el.count()) {
      await el.click().catch(() => {});
      await page.waitForTimeout(800);
      return;
    }
  }
  notes.push("onboarding was on screen but no skip control matched");
}

// ---------------------------------------------------------------- 1. Home ---
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await dismissOnboarding();
await page.waitForTimeout(400);
await shot("01-home");

await assertReallyVisible(".course-chip", "home: course chip", 30);
await assertReallyVisible(".home-hero", "home: today block", 100);
await assertReallyVisible(".home-progress", "home: progress block", 80);
await assertReallyVisible(".btn.primary", "home: primary CTA", 44);
await assertHasSideMargin(".home-progress", "home: progress block");
await assertNoHorizontalOverflow("home");
await assertNoBottomBand("home");
await assertBackgroundContinuity("home");

// Exactly one goal on the home screen (LINGO-042, Katsuta's instruction).
const meterCount = await page.locator(".home-progress .meter").count();
check(meterCount === 1, `home: expected exactly 1 progress bar, found ${meterCount}`);

// ------------------------------------------------------- 2. Details sheet ---
const details = page.locator(".progress-more").first();
if (check(await details.count(), "home: 'くわしく' button missing")) {
  await details.click();
  await page.waitForTimeout(600);
  await shot("02-details-sheet");
  await assertReallyVisible(".sheet", "details sheet", 200);
  await assertHasSideMargin(".detail-body .detail-row", "details sheet: row");
  await assertNoHorizontalOverflow("details sheet");

  // The internal band size (998 etc.) must never reach the screen — the whole
  // point of the LINGO-040 ruling.
  const sheetText = await page.locator(".sheet").innerText();
  check(!/\/\s*9\d\d\b/.test(sheetText), `details sheet: raw denominator leaked — ${sheetText.slice(0, 200)}`);
  // No label may be repeated inside its own value ("次のステップまで /
  // 次のステップまで あと899語").
  const dupes = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".detail-row"))
      .map((r) => [r.firstElementChild?.textContent?.trim() ?? "", r.querySelector("strong")?.textContent?.trim() ?? ""])
      .filter(([label, value]) => label.length > 3 && value.includes(label))
      .map(([label, value]) => `${label} / ${value}`),
  );
  check(dupes.length === 0, `details sheet: label duplicated in its value — ${dupes.join("; ")}`);

  await page.keyboard.press("Escape").catch(() => {});
  await page.locator(".sheet-cancel").first().click().catch(() => {});
  await page.waitForTimeout(400);
}

// ------------------------------------------------------------ 3. Settings ---
await page.locator('[aria-label*="設定"], [aria-label*="Settings" i]').first().click();
await page.waitForTimeout(900);
await shot("03-settings");

// THE regression guard: every settings row must be a real, tappable row.
const rowStats = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".list")).map((list) => ({
    listH: Math.round(list.getBoundingClientRect().height),
    listScrollH: list.scrollHeight,
    rows: Array.from(list.querySelectorAll(".row")).map((r) => Math.round(r.getBoundingClientRect().height)),
  })),
);
check(rowStats.length > 0, "settings: no .list containers rendered at all");
rowStats.forEach((l, i) => {
  check(l.listH >= 40, `settings: list #${i} collapsed to ${l.listH}px (rows are invisible)`);
  check(
    l.listScrollH <= l.listH + 2,
    `settings: list #${i} clips its rows — ${l.listScrollH}px of content in a ${l.listH}px box`,
  );
  l.rows.forEach((h, j) => check(h >= 40, `settings: list #${i} row #${j} only ${h}px tall`));
});
await assertNoHorizontalOverflow("settings");

// A row must actually open its sheet when tapped.
const firstRow = page.locator(".list .row-link").first();
if (check(await firstRow.count(), "settings: no tappable row found")) {
  await firstRow.click();
  await page.waitForTimeout(600);
  await shot("04-settings-sheet");
  await assertReallyVisible(".sheet", "settings: sheet opened by row tap", 120);
  await assertReallyVisible(".sheet-option", "settings: sheet option", 40);
  await page.locator(".sheet-cancel").first().click().catch(() => {});
  await page.waitForTimeout(400);
}

// Scrolled to the bottom, the last row must still be whole and reachable.
await assertRootIsTheScroller("settings");
const scrolled = await scrollToBottom();
check(scrolled.scrollable, "settings: the screen is taller than the viewport but #root does not scroll");
check(scrolled.scrollTop > 0, "settings: #root did not actually scroll");
await page.waitForTimeout(500);
await shot("05-settings-bottom");
await assertLastRowReachable(".list .row", "settings (scrolled)");
await assertNoHorizontalOverflow("settings (scrolled)");

// ----------------------------------------------------------------- 4. Pet ---
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await dismissOnboarding();
const petTab = page.locator(".tabbar-item").nth(1);
if (check(await petTab.count(), "tab bar: 育成 tab missing")) {
  await petTab.click();
  await page.waitForTimeout(1400);
  // A hatch/evolve celebration covers the screen on a first visit; dismiss it,
  // then confirm it really is gone — otherwise every assertion below would be
  // measuring the modal backdrop instead of the pet screen.
  for (let i = 0; i < 3; i++) {
    const modal = page.locator(".pet-event-backdrop, .pet-event").first();
    if (!(await modal.count())) break;
    await modal.locator(".btn.primary").first().click().catch(() => {});
    await page.waitForTimeout(700);
  }
  check(
    (await page.locator(".pet-event-backdrop, .pet-event").count()) === 0,
    "pet: the celebration modal could not be dismissed",
  );
  await page.waitForTimeout(400);
  await shot("06-pet");
  await assertNoHorizontalOverflow("pet");
  await assertNoBottomBand("pet");
await assertBackgroundContinuity("pet");
  await assertRootIsTheScroller("pet");
  await scrollToBottom();
  await page.waitForTimeout(500);
  await shot("07-pet-bottom");
  const petRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".row")).map((r) => Math.round(r.getBoundingClientRect().height)),
  );
  petRows.forEach((h, i) => check(h >= 40, `pet: care row #${i} only ${h}px tall`));
  await assertLastRowReachable(".row", "pet (scrolled)");
}

// ---------------------------------------------------------------- 5. Gate ---
await page.goto(base + "/gate?return=tiktok", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await shot("08-gate");
await assertNoHorizontalOverflow("gate");
const gateText = await page.locator("body").innerText();
check(
  !/band\s*\d|解除ウィンドウ|既知率|語帯/.test(gateText),
  "gate: internal vocabulary is on screen",
);

// ------------------------------------------- 6. Narrowest supported phone ---
// 320px (iPhone SE 1st gen / Android small) is where text-heavy Japanese and
// Russian copy overflows first. Layout only — the flows above already covered
// behaviour.
{
  const narrow = await browser.newPage({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 });
  const narrowErrors = [];
  narrow.on("pageerror", (e) => narrowErrors.push(String(e).slice(0, 200)));
  for (const [name, path] of [
    ["09-narrow-home", "/"],
    ["10-narrow-gate", "/gate?return=tiktok"],
  ]) {
    await narrow.goto(base + path, { waitUntil: "networkidle" });
    await narrow.waitForTimeout(1100);
    const onboard = narrow.locator(".onboard");
    if (await onboard.count()) {
      const skip = onboard.getByText("スキップ", { exact: false }).first();
      if (await skip.count()) {
        await skip.click().catch(() => {});
        await narrow.waitForTimeout(700);
      }
    }
    await narrow.screenshot({ path: `${outDir}/${name}.png` });
    const over = await narrow.evaluate(() => {
      const root = document.querySelector("#root");
      return root ? root.scrollWidth - root.clientWidth : 0;
    });
    check(over <= 1, `320px ${path}: horizontal overflow of ${over}px`);
  }
  check(narrowErrors.length === 0, `320px: page errors — ${narrowErrors.join(" | ")}`);
  await narrow.close();
}

// --------------------------------------------------------------- verdict ---
check(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);

await browser.close();
}

await runAudit("chromium", chromium);
await runAudit("webkit", webkit);

if (preview) preview.kill();

console.log(`\nui-audit — ${base}`);
console.log(`screenshots: ${outDir}/`);
for (const n of notes) console.log(`  note: ${n}`);
if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ all checks passed");
