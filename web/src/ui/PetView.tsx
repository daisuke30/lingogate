// LINGO-030 — the 育成 (pet) tab. Reads the pure engine's snapshot (never the
// clock or ContentStore directly — the overdue count is injected from the
// state layer per the LINGO-029 contract), lets the learner 餌をあげる /
// 掃除する, celebrates hatch/evolve/depart events, and opens the 図鑑.
//
// The growth logic all lives in pet/engine.ts; presentation rules (face
// selection, button enable) live in pet/petDisplay.ts (unit-tested). This file
// is the wiring + markup only.

import { useEffect, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { Lang } from "../i18n/i18n";
import {
  loadPet,
  tickPet,
  feedPet,
  cleanPet,
  loadCollection,
  getPetName,
  setPetName,
  setPetSettings,
} from "../state/pet";
import { overdueReviewCount } from "../state/service";
import { MAX_POOP } from "../pet/engine";
import type { PetSnapshot, PetEvent, PetStage } from "../pet/engine";
import { PET_SPECIES_BY_ID } from "../pet/art";
import { SPECIES_META } from "../pet/art/catalog";
import { PetSprite } from "../pet/art/sprite";
import { EggSprite, PoopSprite, FoodSprite } from "../pet/art/props";
import { chooseExpression, feedDisabled, cleanDisabled } from "../pet/petDisplay";

const STAGE_KEY: Record<PetStage, string> = {
  egg: "pet.stage.egg",
  baby: "pet.stage.baby",
  child: "pet.stage.child",
  adult: "pet.stage.adult",
  perfect: "pet.stage.perfect",
  ultimate: "pet.stage.ultimate",
};

function speciesName(speciesId: string, lang: Lang): string {
  return PET_SPECIES_BY_ID[speciesId]?.name[lang as "ja" | "en" | "ru"] ?? speciesId;
}

export function PetView() {
  const { t, lang } = useI18n();
  const [snapshot, setSnapshot] = useState<PetSnapshot | null>(null);
  const [overdue, setOverdue] = useState(0);
  const [petName, setPetNameState] = useState<string | null>(null);
  const [hardMode, setHardMode] = useState(false);
  const [events, setEvents] = useState<PetEvent[]>([]);
  const [showDex, setShowDex] = useState(false);
  const [discovered, setDiscovered] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [bounce, setBounce] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const oc = await overdueReviewCount();
      const { snapshot: snap, events: evts } = await tickPet(oc);
      const [pet, collection, name] = await Promise.all([
        loadPet(),
        loadCollection(),
        getPetName(snap.generation),
      ]);
      if (!alive) return;
      setOverdue(oc);
      setSnapshot(snap);
      setEvents(evts);
      setHardMode(pet.settings.hardMode);
      setDiscovered(new Set(collection.map((e) => e.speciesId)));
      setPetNameState(name);
    })().catch((err) => console.error("pet init failed", err));
    return () => {
      alive = false;
    };
  }, []);

  async function handleFeed() {
    if (!snapshot) return;
    setBounce(true);
    window.setTimeout(() => setBounce(false), 420);
    const next = await feedPet(overdue);
    setSnapshot(next);
  }

  async function handleClean() {
    if (!snapshot) return;
    const next = await cleanPet(overdue);
    setSnapshot(next);
  }

  async function saveName() {
    if (!snapshot) return;
    const name = nameDraft.trim();
    if (name) {
      await setPetName(snapshot.generation, name);
      setPetNameState(name);
    }
    setNaming(false);
  }

  async function toggleHardMode() {
    const next = !hardMode;
    setHardMode(next);
    await setPetSettings({ hardMode: next });
  }

  function dismissEvent() {
    setEvents((q) => q.slice(1));
  }

  if (!snapshot) {
    return (
      <div className="app">
        <div className="pet-topbar">
          <div className="brand">
            <span className="mark">Я</span>
            {t("pet.title")}
          </div>
        </div>
        <div className="center-screen">
          <p>{t("pet.loading")}</p>
        </div>
      </div>
    );
  }

  if (showDex) {
    return <PetCollection lang={lang} discovered={discovered} onBack={() => setShowDex(false)} />;
  }

  const displayName = petName ?? speciesName(snapshot.speciesId, lang);
  const expr = chooseExpression(snapshot);
  const cleanlinessPct = Math.round(100 * (1 - snapshot.poop / MAX_POOP));
  const currentEvent = events[0];

  return (
    <div className="app">
      <div className="pet-topbar">
        <div className="brand">
          <span className="mark">Я</span>
          {t("pet.title")}
        </div>
        <button type="button" className="btn ghost pet-dex-btn" onClick={() => setShowDex(true)}>
          {t("pet.dex.open")}
        </button>
      </div>

      <button type="button" className="pet-name" onClick={() => { setNameDraft(petName ?? ""); setNaming(true); }}>
        <span className="pet-name-text">{displayName}</span>
        <span className="pet-name-edit" aria-hidden="true">✎</span>
      </button>
      <div className="pet-meta">
        {t("pet.meta", {
          stage: t(STAGE_KEY[snapshot.stage]),
          age: Math.floor(snapshot.ageDays),
          gen: snapshot.generation,
        })}
        {snapshot.studyStreak > 0 && <span className="pet-streak"> · {t("pet.streak", { n: snapshot.studyStreak })}</span>}
      </div>

      <div className="pet-stage">
        <div className={"pet-sprite-wrap" + (bounce ? " bounce" : "")}>
          {snapshot.stage === "egg" ? (
            <EggSprite size={168} />
          ) : (
            <PetSprite speciesId={snapshot.speciesId} expr={expr} size={168} />
          )}
        </div>
        <div className="pet-poop-row" aria-label={t("pet.poop.label", { n: snapshot.poop, max: MAX_POOP })}>
          {snapshot.poop > 0 ? (
            Array.from({ length: snapshot.poop }).map((_, i) => <PoopSprite key={i} size={30} />)
          ) : (
            <span className="pet-poop-clean">{t("pet.poop.none")}</span>
          )}
        </div>
      </div>

      <div className="card pet-gauges">
        <div className="meter">
          <div className="head">
            <span>{t("pet.gauge.satiety")}</span>
            <span>{Math.round(snapshot.satiety)}%</span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${Math.round(snapshot.satiety)}%` }} />
          </div>
        </div>
        <div className="meter">
          <div className="head">
            <span>{t("pet.gauge.cleanliness")}</span>
            <span>{t("pet.poop.label", { n: snapshot.poop, max: MAX_POOP })}</span>
          </div>
          <div className="track">
            <div className="fill green" style={{ width: `${cleanlinessPct}%` }} />
          </div>
        </div>
      </div>

      <div className="pet-actions">
        <button
          type="button"
          className="btn primary pet-action"
          disabled={feedDisabled(snapshot)}
          onClick={handleFeed}
        >
          <FoodSprite size={26} />
          <span>{t("pet.action.feed")}</span>
          <span className="pet-owned">{t("pet.owned.food", { n: snapshot.foodCount })}</span>
        </button>
        <button
          type="button"
          className="btn pet-action"
          disabled={cleanDisabled(snapshot)}
          onClick={handleClean}
        >
          <PoopSprite size={26} />
          <span>{t("pet.action.clean")}</span>
          <span className="pet-owned">{t("pet.owned.cleanPts", { n: snapshot.cleanPoints })}</span>
        </button>
      </div>

      <div className="spacer" />

      <button
        type="button"
        className="row row-link pet-hardmode"
        onClick={toggleHardMode}
        aria-pressed={hardMode}
      >
        <div>
          <div className="label">{t("pet.hardMode.label")}</div>
          <div className="sub">{t("pet.hardMode.sub")}</div>
        </div>
        <div className={"pet-toggle" + (hardMode ? " on" : "")} aria-hidden="true">
          <div className="pet-toggle-knob" />
        </div>
      </button>

      {currentEvent && (
        <EventModal event={currentEvent} lang={lang} hardMode={hardMode} onClose={dismissEvent} />
      )}

      {naming && (
        <div className="pet-modal-backdrop" onClick={() => setNaming(false)}>
          <div className="pet-modal" role="dialog" aria-label={t("pet.name.title")} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">{t("pet.name.title")}</div>
            <input
              className="pet-name-input"
              value={nameDraft}
              maxLength={16}
              autoFocus
              placeholder={speciesName(snapshot.speciesId, lang)}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveName(); }}
            />
            <div className="pet-modal-actions">
              <button type="button" className="btn ghost block" onClick={() => setNaming(false)}>
                {t("pet.name.cancel")}
              </button>
              <button type="button" className="btn primary block" onClick={saveName}>
                {t("pet.name.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventModal({
  event,
  lang,
  hardMode,
  onClose,
}: {
  event: PetEvent;
  lang: Lang;
  hardMode: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const name = speciesName(event.speciesId, lang);
  const isDeath = event.type === "depart" && hardMode;
  const key = event.type === "depart" ? (isDeath ? "death" : "depart") : event.type;
  const emoji = event.type === "hatch" ? "🥚" : event.type === "evolve" ? "✨" : isDeath ? "🕯️" : "🌠";

  return (
    <div className="pet-modal-backdrop">
      <div className="pet-modal pet-event" role="dialog" aria-label={t(`pet.event.${key}.title`)}>
        <div className="pet-event-emoji">{emoji}</div>
        {event.type !== "depart" && (
          <div className="pet-event-sprite">
            <PetSprite speciesId={event.speciesId} expr="joy" size={120} />
          </div>
        )}
        <h2>{t(`pet.event.${key}.title`)}</h2>
        <p>{t(`pet.event.${key}.body`, { name })}</p>
        <button type="button" className="btn primary block" onClick={onClose}>
          {t("pet.event.ok")}
        </button>
      </div>
    </div>
  );
}

function PetCollection({
  lang,
  discovered,
  onBack,
}: {
  lang: Lang;
  discovered: Set<string>;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="app">
      <div className="pet-topbar">
        <button type="button" className="backlink" onClick={onBack}>
          {t("pet.dex.back")}
        </button>
        <div className="pet-dex-count">
          {t("pet.dex.count", { found: discovered.size, total: SPECIES_META.length })}
        </div>
      </div>
      <div className="section-title">{t("pet.dex.title")}</div>
      <div className="pet-dex-grid">
        {SPECIES_META.map((s) => {
          const found = discovered.has(s.speciesId);
          return (
            <div key={s.speciesId} className={"pet-dex-cell" + (found ? "" : " locked")}>
              <div className="pet-dex-art">
                <PetSprite speciesId={s.speciesId} expr="normal" size={64} className={found ? undefined : "pet-silhouette"} />
              </div>
              <div className="pet-dex-name">
                {found ? speciesName(s.speciesId, lang) : t("pet.dex.unknown")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
