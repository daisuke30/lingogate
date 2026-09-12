// LINGO-047 — on-device viewport diagnostics.
//
// "A black space at the bottom" took three attempts to fix because every
// diagnosis was made on a desktop browser, where env(safe-area-inset-bottom)
// is 0 and every viewport unit agrees with every other. On Katsuta's iPhone
// they do not, and nobody could see the numbers.
//
// This panel prints them. If the band ever comes back, one screenshot of this
// screen says which layer is lying — no more guessing across a chat round trip.
//
// Nothing here is a setting; it is read-only instrumentation, deliberately
// left in the shipped app because the bug only appears in the shipped app.

import { useEffect, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { SheetShell } from "./ListPicker";

interface Reading {
  label: string;
  value: string;
  /** Flagged rows are the ones that should agree but don't. */
  bad?: boolean;
}

/** Read one `env(safe-area-inset-*)` by letting the engine resolve it into a
 * throwaway element's padding — there is no direct API for these. */
function readSafeAreaInsets(): Record<"top" | "right" | "bottom" | "left", number> {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;" +
    "padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);" +
    "padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string) => Math.round(parseFloat(v) || 0);
  const out = {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
  probe.remove();
  return out;
}

/** Where does a `position:fixed; bottom:0` element actually land? This is the
 * single most useful number: if it is not equal to the viewport height, the
 * shell is not reaching the physical bottom of the screen. */
function readFixedBottomProbe(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:1px;height:1px;visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const bottom = Math.round(probe.getBoundingClientRect().bottom);
  probe.remove();
  return bottom;
}

function collect(): Reading[] {
  const vv = window.visualViewport;
  const root = document.querySelector("#root");
  const rootRect = root?.getBoundingClientRect();
  const insets = readSafeAreaInsets();
  const fixedBottom = readFixedBottomProbe();
  const innerH = window.innerHeight;

  const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

  const rows: Reading[] = [
    { label: "window.innerHeight", value: `${innerH}` },
    { label: "window.innerWidth", value: `${window.innerWidth}` },
    {
      label: "visualViewport.height",
      value: vv ? `${Math.round(vv.height)}` : "—",
      bad: !!vv && !near(Math.round(vv.height), innerH, 2),
    },
    { label: "visualViewport.offsetTop", value: vv ? `${Math.round(vv.offsetTop)}` : "—" },
    { label: "visualViewport.scale", value: vv ? vv.scale.toFixed(2) : "—" },
    { label: "screen.height", value: `${window.screen.height}` },
    { label: "documentElement.clientHeight", value: `${document.documentElement.clientHeight}` },
    { label: "devicePixelRatio", value: `${window.devicePixelRatio}` },
    {
      label: "#root bottom",
      value: rootRect ? `${Math.round(rootRect.bottom)}` : "—",
      bad: !!rootRect && !near(Math.round(rootRect.bottom), innerH),
    },
    {
      label: "#root height",
      value: rootRect ? `${Math.round(rootRect.height)}` : "—",
      bad: !!rootRect && !near(Math.round(rootRect.height), innerH),
    },
    {
      // THE number. Anything but innerHeight means the shell stops short of
      // the physical bottom and the OS paints the difference.
      label: "fixed bottom:0 → bottom",
      value: `${fixedBottom}`,
      bad: !near(fixedBottom, innerH),
    },
    ...(() => {
      // LINGO-049: the tab bar's own geometry and colour — the thing the
      // "black band below the footer" reports are actually about. Present
      // whenever the panel is opened over a tabbed screen (including /diag,
      // which deliberately renders over Home for exactly this reason).
      const tb = document.querySelector(".tabbar");
      if (!tb) return [] as Reading[];
      const r = tb.getBoundingClientRect();
      const cs = getComputedStyle(tb);
      return [
        {
          label: "tabbar bottom",
          value: `${Math.round(r.bottom)}`,
          bad: !near(Math.round(r.bottom), innerH),
        },
        { label: "tabbar height", value: `${Math.round(r.height)}` },
        { label: "tabbar background", value: cs.backgroundColor },
      ] as Reading[];
    })(),
    { label: "safe-area top", value: `${insets.top}px` },
    { label: "safe-area bottom", value: `${insets.bottom}px` },
    { label: "safe-area left / right", value: `${insets.left} / ${insets.right}px` },
    {
      label: "standalone (PWA)",
      value: window.matchMedia("(display-mode: standalone)").matches ? "yes" : "no",
    },
    {
      label: "page background",
      value: root ? getComputedStyle(root).backgroundColor : "—",
    },
    {
      label: "<meta theme-color>",
      value:
        document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "(none)",
    },
  ];
  return rows;
}

export function DiagnosticsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Reading[]>([]);

  useEffect(() => {
    if (!open) return;
    const read = () => setRows(collect());
    read();
    // Re-read while open: on iOS these values change as browser chrome hides
    // and on rotation, and a stale snapshot would be worse than none.
    window.visualViewport?.addEventListener("resize", read);
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.visualViewport?.removeEventListener("resize", read);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, [open]);

  return (
    <SheetShell
      open={open}
      title={t("settings.diagnostics.label")}
      onClose={onClose}
      closeLabel={t("common.close")}
    >
      <div className="detail-body">
        <p className="diag-hint">{t("settings.diagnostics.hint")}</p>
        {rows.map((r) => (
          <div key={r.label} className={"diag-row" + (r.bad ? " bad" : "")}>
            <span className="diag-key">{r.label}</span>
            <strong className="diag-val">{r.value}</strong>
          </div>
        ))}
      </div>
    </SheetShell>
  );
}
