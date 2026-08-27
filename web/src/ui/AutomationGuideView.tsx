import { useT } from "../i18n/i18n";

/**
 * iOS Shortcuts automation setup guide. The gate URL uses the live origin so
 * the exact string the user must paste is always correct for wherever the app
 * is being served (localhost, a LAN IP with --host, or a future host).
 */

/** Render a translated string with **bold** spans (the catalog marks the words
 * the user taps in Shortcuts). Keeps the bold in every UI language. */
function renderBold(text: string): JSX.Element {
  const parts = text.split("**");
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}
    </>
  );
}

export function AutomationGuideView({ onBack }: { onBack: () => void }) {
  const t = useT();
  const gateURL = `${window.location.origin}/gate?return=tiktok`;

  const steps = ["guide.step1", "guide.step2", "guide.step3", "guide.step4", "guide.step5", "guide.step6"];

  return (
    <div className="app">
      <button className="backlink" onClick={onBack}>
        {t("common.backHome")}
      </button>
      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>{t("guide.title")}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("guide.intro")}
      </p>

      <div className="section-title">{t("guide.section.steps")}</div>
      <div className="steps">
        {steps.map((key, i) => (
          <div className="step" key={key}>
            <div className="num">{i + 1}</div>
            <div className="body">{renderBold(t(key))}</div>
          </div>
        ))}
      </div>

      <div className="section-title">{t("guide.section.url")}</div>
      <code className="urlbox">{gateURL}</code>
      <button
        className="btn block"
        style={{ marginTop: 10 }}
        onClick={() => navigator.clipboard?.writeText(gateURL)}
      >
        {t("guide.copyUrl")}
      </button>

      <p className="muted" style={{ marginTop: 18 }}>
        {t("guide.note")}
      </p>
    </div>
  );
}
