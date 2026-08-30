import { useEffect, useRef, useState } from "react";
import {
  UNLOCK_CHOICES,
  TTS_RATE_CHOICES,
  getUnlockMinutes,
  setUnlockMinutes,
  getQuizMode,
  getTtsEnabled,
  setTtsEnabled,
  getTtsRate,
  setTtsRate,
  getActiveCourse,
  setActiveCourse,
  getFrontLang,
  setFrontLang,
} from "../state/settings";
import type { QuizMode } from "../state/settings";
import { voiceAvailable, subscribeVoices } from "../state/tts";
import { COURSES, resolveCourse } from "../content/courses";
import type { Lang } from "../content/courses";
import { resetAll } from "../db/idb";
// LINGO-010 follow-up: build-time stamp (git sha + timestamp) so Katsuta can
// tell which deploy his device is actually running — see scripts/gen-version.mjs.
import versionInfo from "../content/version.generated.json";
import { checkForUpdate, hasPendingUpdate } from "../state/appUpdate";
import { downloadBackupFile, exportBackup, importBackupText } from "../state/backup";
import type { ImportOutcome } from "../state/backup";
import { currentStoragePersisted, formatBytes, storageEstimate } from "../state/persistence";
import { NATIVE_LANG_NAME, UI_LANGS, useI18n } from "../i18n/i18n";
import { ListPicker, ListRow } from "./ListPicker";

function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function SettingsView({
  onBack,
  onShowOnboarding,
}: {
  onBack: () => void;
  onShowOnboarding: () => void;
}) {
  const { lang: uiLang, setLang, t } = useI18n();
  const [minutes, setMinutes] = useState(10);
  const [quizMode, setQuizModeState] = useState<QuizMode>("flashcard");
  const [ttsOn, setTtsOn] = useState(true);
  const [ttsRate, setTtsRateState] = useState(1.0);
  const [hasVoice, setHasVoice] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  // LINGO-014 language axes.
  const [courseId, setCourseId] = useState("ru");
  const [frontLang, setFrontLangState] = useState<Lang>("en");
  // LINGO-021: storage protection + usage (display only — the actual
  // persist() request already happened once at boot, in main.tsx).
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);
  const [replaceAll, setReplaceAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const course = resolveCourse(courseId);

  useEffect(() => {
    getUnlockMinutes().then(setMinutes);
    getQuizMode().then(setQuizModeState);
    getTtsEnabled().then(setTtsOn);
    getTtsRate().then(setTtsRateState);
    hasPendingUpdate().then(setPendingUpdate);
    getActiveCourse().then((c) => {
      setCourseId(c);
      getFrontLang(c).then(setFrontLangState);
      setHasVoice(voiceAvailable(resolveCourse(c).targetLang));
    });
    const unsub = subscribeVoices(() =>
      getActiveCourse().then((c) => setHasVoice(voiceAvailable(resolveCourse(c).targetLang))),
    );
    currentStoragePersisted().then(setPersisted);
    storageEstimate().then((e) => {
      setUsageBytes(e.usageBytes);
      setQuotaBytes(e.quotaBytes);
    });
    return unsub;
  }, []);

  function pickMinutes(v: string) {
    const m = Number(v);
    setMinutes(m);
    void setUnlockMinutes(m);
  }

  function pickTtsOn(v: "on" | "off") {
    const next = v === "on";
    setTtsOn(next);
    void setTtsEnabled(next);
  }

  function pickRate(v: string) {
    const r = Number(v);
    setTtsRateState(r);
    void setTtsRate(r);
  }

  async function pickCourse(id: string) {
    if (id === courseId) return;
    await setActiveCourse(id);
    // Switching courses swaps the loaded content pack + progress namespace; a
    // reload re-initialises everything cleanly from the persisted active course.
    location.reload();
  }

  function pickFrontLang(l: string) {
    setFrontLangState(l as Lang);
    void setFrontLang(courseId, l as Lang);
  }

  async function reset() {
    if (!confirm(t("settings.data.resetConfirm"))) return;
    await resetAll();
    location.reload();
  }

  // LINGO-021: export -----------------------------------------------------
  async function handleExport() {
    const file = await exportBackup();
    downloadBackupFile(file);
  }

  // LINGO-021: import -----------------------------------------------------
  function importErrorKey(error: ImportOutcome["error"]): string {
    if (error === "unsupported-schema-version") return "settings.backup.import.error.unsupportedVersion";
    return "settings.backup.import.error.invalid"; // invalid-json / missing-schema-version / unknown
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same filename later
    if (!file) return;
    if (replaceAll && !confirm(t("settings.backup.import.confirmReplace"))) return;

    setImporting(true);
    setImportStatus(null);
    try {
      const text = await file.text();
      const result = await importBackupText(text, replaceAll);
      if (result.ok) {
        setImportStatus(t("settings.backup.import.success"));
        // Brief confirmation flash before the reload every import needs
        // (fresh course packs / progress caches all read at boot).
        setTimeout(() => location.reload(), 800);
      } else {
        setImportStatus(t(importErrorKey(result.error)));
      }
    } catch {
      setImportStatus(t("settings.backup.import.error.invalid"));
    } finally {
      setImporting(false);
    }
  }

  async function updateNow() {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const result = await checkForUpdate();
      if (result === "updating") {
        setUpdateStatus(t("settings.update.updating"));
      } else if (result === "up-to-date") {
        setUpdateStatus(t("settings.update.upToDate", { v: versionInfo.version }));
      } else {
        setUpdateStatus(t("settings.update.unsupported"));
      }
    } finally {
      setCheckingUpdate(false);
    }
  }

  const closeLabel = t("common.close");
  // LINGO-026 (Katsuta-approved design): language names in every picker are
  // ALWAYS endonyms (日本語/English/Русский) — never translated into the UI
  // language, never a flag. NATIVE_LANG_NAME is exactly that lookup.
  const targetLangName = NATIVE_LANG_NAME[course.targetLang];

  return (
    <div className="app">
      <button className="backlink" onClick={onBack}>
        {t("common.backHome")}
      </button>
      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>{t("settings.title")}</h1>

      {/* -- App language (UI) -- */}
      <div className="section-title">{t("settings.section.appLang")}</div>
      <div className="list">
        <ListPicker
          label={t("settings.section.appLang")}
          sub={t("settings.appLang.sub")}
          options={UI_LANGS.map((l) => ({ value: l, label: NATIVE_LANG_NAME[l] }))}
          selected={uiLang}
          onSelect={setLang}
          closeLabel={closeLabel}
        />
      </div>

      {/* -- LINGO-017: replay the first-run intro on demand -- */}
      <div className="list" style={{ marginTop: 8 }}>
        <ListRow label={t("settings.viewOnboarding")} onClick={onShowOnboarding} />
      </div>

      {/* -- Course (back-of-card language) -- */}
      <div className="section-title">{t("settings.section.course")}</div>
      <div className="list">
        <ListPicker
          label={t("settings.section.course")}
          sub={t("settings.course.sub")}
          options={COURSES.map((c) => ({
            value: c.courseId,
            label: NATIVE_LANG_NAME[c.targetLang],
            disabled: c.status !== "available",
            badge: c.status === "available" ? undefined : t("badge.comingSoon"),
          }))}
          selected={courseId}
          onSelect={(id) => void pickCourse(id)}
          closeLabel={closeLabel}
        />
      </div>

      {/* -- Front (prompt) language -- */}
      <div className="section-title">{t("settings.section.frontLang")}</div>
      <div className="list">
        <ListPicker
          label={t("settings.section.frontLang")}
          sub={t("settings.frontLang.sub")}
          options={course.availableFrontLangs.map((l) => ({ value: l, label: NATIVE_LANG_NAME[l] }))}
          selected={frontLang}
          onSelect={pickFrontLang}
          closeLabel={closeLabel}
        />
      </div>

      <div className="section-title">{t("settings.section.unlock")}</div>
      <div className="list">
        <ListPicker
          label={t("settings.unlock.label")}
          sub={t("settings.unlock.sub")}
          options={UNLOCK_CHOICES.map((m) => ({ value: String(m), label: t("settings.unlock.minutes", { m }) }))}
          selected={String(minutes)}
          onSelect={pickMinutes}
          closeLabel={closeLabel}
        />
      </div>

      <div className="section-title">{t("settings.section.tts")}</div>
      {hasVoice ? (
        <div className="list">
          <ListPicker
            label={t("settings.tts.label", { lang: targetLangName })}
            sub={t("settings.tts.sub")}
            options={[
              { value: "on", label: t("common.on") },
              { value: "off", label: t("common.off") },
            ]}
            selected={ttsOn ? "on" : "off"}
            onSelect={pickTtsOn}
            closeLabel={closeLabel}
          />
          <ListPicker
            label={t("settings.tts.rateLabel")}
            sub={t("settings.tts.rateSub")}
            options={TTS_RATE_CHOICES.map((r) => ({
              value: String(r),
              label: r === 1.0 ? t("settings.tts.rateNormal") : "0.8x",
            }))}
            selected={String(ttsRate)}
            onSelect={pickRate}
            closeLabel={closeLabel}
          />
        </div>
      ) : (
        <p className="muted">{t("settings.tts.noVoice", { lang: targetLangName })}</p>
      )}

      <div className="section-title">{t("settings.section.quizUI")}</div>
      <div className="list">
        <ListPicker
          label={t("settings.section.quizUI")}
          options={[
            { value: "flashcard", label: t("settings.quiz.flashcard"), sub: t("settings.quiz.flashcardSub"), badge: t("badge.default") },
            { value: "strict", label: t("settings.quiz.strict"), sub: t("settings.quiz.strictSub"), disabled: true, badge: t("badge.comingSoon") },
          ]}
          selected={quizMode}
          onSelect={() => setQuizModeState("flashcard")} // strict is disabled -> only a no-op re-select is reachable
          closeLabel={closeLabel}
        />
      </div>

      <div className="section-title">{t("settings.section.data")}</div>
      <div className="list">
        <div className="row">
          <div>
            <div className="label">{t("settings.backup.export.label")}</div>
            <div className="sub">{t("settings.backup.export.sub")}</div>
          </div>
          <button className="btn" onClick={() => void handleExport()}>
            {t("settings.backup.export.btn")}
          </button>
        </div>
        <div className="row">
          <div>
            <div className="label">{t("settings.backup.import.label")}</div>
            <div className="sub">{t("settings.backup.import.sub")}</div>
          </div>
          <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? t("settings.backup.import.importing") : t("settings.backup.import.btn")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => void handleImportFile(e)}
          />
        </div>
        <div className="row">
          <label style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={replaceAll}
              onChange={(e) => setReplaceAll(e.target.checked)}
            />
            <span className="label">{t("settings.backup.import.replaceAll")}</span>
          </label>
        </div>
        <div className="row">
          <div>
            <div className="label">{t("settings.data.resetLabel")}</div>
            <div className="sub">{t("settings.data.resetSub")}</div>
          </div>
          <button className="btn" onClick={reset} style={{ color: "var(--again)" }}>
            {t("settings.data.resetBtn")}
          </button>
        </div>
      </div>
      {importStatus && (
        <p className="muted" style={{ marginTop: 10 }}>
          {importStatus}
        </p>
      )}

      <p className="muted" style={{ marginTop: 20 }}>
        {t("settings.shieldNote")}
      </p>

      <div className="section-title">{t("settings.section.update")}</div>
      <div className="list">
        <div className="row">
          <div>
            <div className="label">{t("settings.update.label")}</div>
            <div className="sub">{t("settings.update.sub")}</div>
          </div>
          <button className="btn" onClick={updateNow} disabled={checkingUpdate}>
            {checkingUpdate ? t("settings.update.checking") : t("settings.update.btn")}
          </button>
        </div>
      </div>
      {updateStatus ? (
        <p className="muted" style={{ marginTop: 10 }}>
          {updateStatus}
        </p>
      ) : (
        pendingUpdate && (
          <p className="muted" style={{ marginTop: 10 }}>
            {t("settings.update.pending")}
          </p>
        )
      )}

      <p className="muted" style={{ marginTop: 20, textAlign: "center", opacity: 0.6 }}>
        {t("settings.build", { v: versionInfo.version })}
        {versionInfo.builtAt ? t("settings.buildAt", { at: formatBuiltAt(versionInfo.builtAt) }) : ""}
      </p>
      {/* LINGO-021: storage protection status + usage estimate — small, at
          the very bottom, purely informational (the actual persist() request
          already happened once at boot in main.tsx; this only displays the
          resulting status). */}
      <p className="muted" style={{ marginTop: 4, textAlign: "center", opacity: 0.6 }}>
        {persisted === true
          ? t("settings.storage.protected")
          : persisted === false
            ? t("settings.storage.unprotected")
            : t("settings.storage.unknown")}
        {(() => {
          const used = formatBytes(usageBytes);
          const quota = formatBytes(quotaBytes);
          if (!used) return null;
          return " · " + (quota ? t("settings.storage.usage", { used, quota }) : t("settings.storage.usageOnly", { used }));
        })()}
      </p>
    </div>
  );
}
