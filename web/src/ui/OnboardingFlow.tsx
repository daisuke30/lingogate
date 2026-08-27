import { useState } from "react";
import { advanceOnboarding } from "../engine/onboarding";
import { COURSES } from "../content/courses";
import { completeOnboardingWithCourse, markOnboardingSeen } from "../state/onboarding";
import { NATIVE_LANG_NAME, langName, useI18n } from "../i18n/i18n";

/**
 * First-run onboarding (LINGO-017): 5 static screens explaining the app's
 * design (design §3.5, copy confirmed — used verbatim via i18n), followed by
 * a course-select step (§4) that hands off to the placement test. Every
 * screen (including course-select) has a skip/"choose later" escape hatch —
 * "いつでもスキップ可" is a hard product requirement, not a nice-to-have.
 *
 * `origin` distinguishes the two ways this screen is reached:
 *  - "firstRun": the automatic first-launch funnel. Finishing the intro leads
 *    to course-select -> placement; skipping leads straight to Home.
 *  - "settings": a replay via Settings' "アプリの説明を見る" for a learner who
 *    already has a course set up — finishing OR skipping both just return to
 *    Settings, no course-select, no re-running placement.
 */
export function OnboardingFlow({
  origin,
  onFinish,
}: {
  origin: "firstRun" | "settings";
  onFinish: (dest: "home" | "placement" | "settings") => void;
}) {
  const { lang, t } = useI18n();
  const [phase, setPhase] = useState<"intro" | "course">("intro");
  const [screenIndex, setScreenIndex] = useState(0);

  async function leaveToHome() {
    await markOnboardingSeen(true);
    onFinish("home");
  }

  function handleIntroAction(action: "next" | "back" | "skip") {
    if (origin === "settings" && (action === "skip" || (action === "next" && screenIndex === SCREENS.length - 1))) {
      // A replay from Settings never re-runs course-select/placement — it's
      // purely informational for a learner who already has a course.
      onFinish("settings");
      return;
    }
    const result = advanceOnboarding(screenIndex, action);
    if (result === "skipped") {
      void leaveToHome();
      return;
    }
    if (result === "completed") {
      setPhase("course");
      return;
    }
    setScreenIndex(result);
  }

  async function pickCourse(courseId: string) {
    await completeOnboardingWithCourse(courseId, lang);
    onFinish("placement");
  }

  if (phase === "course") {
    return (
      <div className="app">
        <div className="onboard">
          <div className="onboard-top">
            <button className="linkbtn" onClick={() => void leaveToHome()}>
              {t("onboard.course.skip")}
            </button>
          </div>
          <div className="onboard-body">
            <div className="big-emoji">🌐</div>
            <h1>{t("onboard.course.title")}</h1>
            <p>{t("onboard.course.frontNote", { lang: NATIVE_LANG_NAME[lang] })}</p>
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {COURSES.map((c) => {
              const available = c.status === "available";
              return (
                <div className="row" key={c.courseId}>
                  <div>
                    <div className="label">
                      {langName(lang, c.targetLang)}
                      {!available && <span className="badge">{t("badge.comingSoon")}</span>}
                    </div>
                    <div className="sub">{NATIVE_LANG_NAME[c.targetLang]}</div>
                  </div>
                  {available ? (
                    <button className="btn primary" onClick={() => void pickCourse(c.courseId)}>
                      {t("onboard.next")}
                    </button>
                  ) : (
                    <button className="btn" disabled>
                      {t("badge.comingSoon")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const screen = SCREENS[screenIndex];

  return (
    <div className="app">
      <div className="onboard">
        <div className="onboard-top">
          <button className="linkbtn" onClick={() => handleIntroAction("skip")}>
            {t("onboard.skip")}
          </button>
        </div>
        <div className="onboard-body">
          <div className="onboard-figure">
            <screen.Figure />
          </div>
          <h1>{t(screen.titleKey)}</h1>
          <p>{t(screen.bodyKey)}</p>
        </div>
        <div className="onboard-dots">
          {SCREENS.map((_, i) => (
            <div key={i} className={"onboard-dot" + (i === screenIndex ? " on" : "")} />
          ))}
        </div>
        <div className="onboard-nav">
          {screenIndex === SCREENS.length - 1 ? (
            <button className="btn primary block" onClick={() => handleIntroAction("next")}>
              {t("onboard.screen5.cta")}
            </button>
          ) : (
            <button className="btn primary block" onClick={() => handleIntroAction("next")}>
              {t("onboard.next")}
            </button>
          )}
          {screenIndex > 0 && (
            <div className="onboard-nav-row">
              <button className="linkbtn" onClick={() => handleIntroAction("back")}>
                {t("onboard.back")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -- Screen figures: dependency-free inline SVG, deterministic, minimal ------

function CoverageCurveSVG() {
  const points = [
    { x: 93, y: 33.5, pct: "85%", label: "1000" },
    { x: 166, y: 29, pct: "90%", label: "2000" },
    { x: 240, y: 24.5, pct: "95%", label: "3000" },
  ];
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true">
      <line x1="20" y1="110" x2="240" y2="110" style={{ stroke: "var(--line)" }} strokeWidth={1.5} />
      <path
        d="M20,110 C50,90 70,45 93,33.5 C115,28 145,29 166,29 C190,29 220,25 240,24.5"
        fill="none"
        style={{ stroke: "var(--indigo-bright)" }}
        strokeWidth={3}
        strokeLinecap="round"
      />
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r={4.5} style={{ fill: "var(--indigo-bright)" }} />
          <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={10} style={{ fill: "var(--ink)" }}>
            {p.pct}
          </text>
          <text x={p.x} y={126} textAnchor="middle" fontSize={9} style={{ fill: "var(--ink-faint)" }}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function KnownMapSVG() {
  const cols = 10;
  const rows = 4;
  const size = 20;
  const gap = 4;
  const totalW = cols * size + (cols - 1) * gap;
  const totalH = rows * size + (rows - 1) * gap;
  const cells: { x: number; y: number; isNew: boolean }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      cells.push({ x: c * (size + gap), y: r * (size + gap), isNew: i % 4 === 0 });
    }
  }
  return (
    <svg viewBox={`0 0 ${totalW} ${totalH}`} aria-hidden="true">
      {cells.map((cell, i) => (
        <rect
          key={i}
          x={cell.x}
          y={cell.y}
          width={size}
          height={size}
          rx={4}
          style={{ fill: cell.isNew ? "var(--indigo-bright)" : "var(--bg-elev-2)" }}
        />
      ))}
    </svg>
  );
}

function ForgettingCurveSVG() {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true">
      <line x1="10" y1="120" x2="250" y2="120" style={{ stroke: "var(--line)" }} strokeWidth={1.5} />
      <path
        d="M10,30 C40,55 60,85 72,108"
        fill="none"
        style={{ stroke: "var(--again)" }}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <line x1={72} y1={108} x2={72} y2={18} style={{ stroke: "var(--indigo-bright)" }} strokeWidth={2} strokeDasharray="3 3" />
      <path
        d="M72,18 C100,35 125,60 140,82"
        fill="none"
        style={{ stroke: "var(--again)" }}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <line x1={140} y1={82} x2={140} y2={14} style={{ stroke: "var(--indigo-bright)" }} strokeWidth={2} strokeDasharray="3 3" />
      <path
        d="M140,14 C170,24 205,38 230,54"
        fill="none"
        style={{ stroke: "var(--again)" }}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <line x1={230} y1={54} x2={230} y2={10} style={{ stroke: "var(--indigo-bright)" }} strokeWidth={2} strokeDasharray="3 3" />
      <path
        d="M230,10 C240,14 246,18 250,22"
        fill="none"
        style={{ stroke: "var(--good)" }}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SentenceCardSVG() {
  const words = [
    { w: 30, known: true },
    { w: 46, known: true },
    { w: 38, known: false }, // the one new (target) word
    { w: 34, known: true },
    { w: 50, known: true },
  ];
  let x = 20;
  const y = 60;
  const h = 22;
  const gap = 8;
  const chips = words.map((wd) => {
    const chip = { x, w: wd.w, known: wd.known };
    x += wd.w + gap;
    return chip;
  });
  const totalW = x - gap + 20;
  return (
    <svg viewBox={`0 0 ${totalW} 140`} aria-hidden="true">
      <rect
        x={6}
        y={30}
        width={totalW - 12}
        height={80}
        rx={14}
        fill="none"
        style={{ stroke: "var(--line)" }}
        strokeWidth={2}
      />
      {chips.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={y}
          width={c.w}
          height={h}
          rx={6}
          style={{ fill: c.known ? "var(--bg-elev-2)" : "var(--indigo-bright)" }}
        />
      ))}
    </svg>
  );
}

function GateIntroSVG() {
  return (
    <svg viewBox="0 0 160 140" aria-hidden="true">
      <rect x={40} y={16} width={80} height={108} rx={16} fill="none" style={{ stroke: "var(--line)" }} strokeWidth={3} />
      <circle cx={80} cy={70} r={22} style={{ fill: "var(--indigo-bright)" }} opacity={0.9} />
      <path
        d="M71,70 l6,7 l13,-15"
        fill="none"
        style={{ stroke: "var(--bg)" }}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface OnboardScreen {
  titleKey: string;
  bodyKey: string;
  Figure: () => JSX.Element;
}

const SCREENS: OnboardScreen[] = [
  { titleKey: "onboard.screen1.title", bodyKey: "onboard.screen1.body", Figure: CoverageCurveSVG },
  { titleKey: "onboard.screen2.title", bodyKey: "onboard.screen2.body", Figure: KnownMapSVG },
  { titleKey: "onboard.screen3.title", bodyKey: "onboard.screen3.body", Figure: ForgettingCurveSVG },
  { titleKey: "onboard.screen4.title", bodyKey: "onboard.screen4.body", Figure: SentenceCardSVG },
  { titleKey: "onboard.screen5.title", bodyKey: "onboard.screen5.body", Figure: GateIntroSVG },
];
