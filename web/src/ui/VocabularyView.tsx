// LINGO-067 — the vocabulary list.
//
// Every word of the course in frequency order, with what the app believes
// about each one. It began as "can I see which words the level check just
// added?" — a question a one-off log answers once and then rots. This screen
// answers it permanently, and the "最近変化した語" filter is that question as
// a first-class control.
//
// Two structural decisions worth knowing before editing:
//
// 1. #root is the ONLY scroller in this app (LINGO-047). This screen does NOT
//    introduce a nested one — a scrolling box inside the fixed shell is the
//    exact shape that produced four rounds of iOS bottom-of-screen bugs. The
//    window is computed from the row container's position in the viewport, so
//    it works with whatever is doing the scrolling.
// 2. Rows are a FIXED 60px (ROW_H, mirrored in styles.css). That turns the
//    windowing into arithmetic instead of a measurement pass, which is what
//    keeps 3,000 rows smooth on a phone. A row therefore has to keep its
//    gloss to one ellipsised line — see .vocab-gloss.

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { filterVocab, countByStatus } from "../engine/vocabulary";
import type { VocabRow, VocabStatus } from "../engine/vocabulary";
import { loadVocabList, VOCAB_BANDS } from "../state/vocabulary";
import { activeFrontLanguage } from "../state/service";
import { ExplainSheet } from "./ExplainSheet";

/** Row height in px — must match .vocab-row in styles.css. */
const ROW_H = 60;
/** Rows kept above and below the viewport so a fast flick never shows blank. */
const OVERSCAN = 10;

/**
 * Chip order: from "nothing known about it" through to the two kinds of
 * knowing, with the explicit "not known" last. Deliberately NOT the
 * declaration order of VocabStatus, which is ordered to match mastery.ts.
 */
const STATUS_CHIPS: VocabStatus[] = ["unjudged", "learning", "mastered", "declared", "unknown"];

export function VocabularyView({ onBack }: { onBack: () => void }) {
  const { lang: uiLang, t } = useI18n();
  const [rows, setRows] = useState<VocabRow[] | null>(null);
  const [status, setStatus] = useState<VocabStatus | "all">("all");
  const [band, setBand] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  // LINGO-068: Katsuta asked what separates 申告済み from 定着. The badges are
  // two words each; the difference needs a sentence, and a sentence does not
  // fit in a badge. A legend it is — folded away, because it is read once.
  const [legendOpen, setLegendOpen] = useState(false);
  const [openLemma, setOpenLemma] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadVocabList(uiLang)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((err) => {
        console.error("vocabulary load failed", err);
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [uiLang]);

  const counts = useMemo(() => (rows ? countByStatus(rows) : null), [rows]);
  const visible = useMemo(
    () => (rows ? filterVocab(rows, { status, band, query, recentOnly }) : []),
    [rows, status, band, query, recentOnly],
  );
  const recentCount = useMemo(
    () => (rows ? filterVocab(rows, { recentOnly: true }).length : 0),
    [rows],
  );

  const { listRef, first, last } = useRowWindow(visible.length);
  const slice = visible.slice(first, last);

  // A filter change makes the old scroll offset meaningless (row 800 of a
  // 12-row result), so go back to the top of the list.
  const filterKey = `${status}|${band}|${query}|${recentOnly}`;
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return;
    prevFilterKey.current = filterKey;
    document.querySelector("#root")?.scrollTo({ top: 0 });
  }, [filterKey]);

  // LINGO-068: the sheet opens on the WORD now, not on a sentence that happens
  // to contain it — so every row has something to show, including the ~930
  // words no core sentence is built around.
  function openWord(row: VocabRow) {
    setOpenLemma(row.lemma);
  }

  return (
    <div className="app">
      {/* The title scrolls away with the content; only the controls are
          pinned. A first draft stuck the whole header down and it ate 37% of
          an iPhone screen for the entire length of a 3,000-row list. */}
      <button className="backlink" onClick={onBack}>
        {t("common.backHome")}
      </button>
      <h1 className="vocab-title">{t("vocab.title")}</h1>

      {/* Sticky, because the alternative is scrolling back past 2,000 rows to
          change a filter. Opaque by necessity — see .vocab-head. */}
      <div className="vocab-head">
        <input
          className="vocab-search"
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder={t("vocab.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("vocab.search")}
        />

        {/* One horizontal rail rather than three wrapped rows: chips off the
            right edge cost nothing, vertical space costs the list. */}
        <div className="vocab-filters">
          {/* The question that prompted this screen, as one tap. */}
          <button
            type="button"
            className={"vocab-chip wide" + (recentOnly ? " on" : "")}
            onClick={() => setRecentOnly((v) => !v)}
            aria-pressed={recentOnly}
          >
            {t("vocab.recent")}
            <span className="vocab-chip-n">{recentCount}</span>
          </button>
          <button
            type="button"
            className={"vocab-chip" + (status === "all" ? " on" : "")}
            onClick={() => setStatus("all")}
            aria-pressed={status === "all"}
          >
            {t("vocab.status.all")}
            {counts && <span className="vocab-chip-n">{rows?.length ?? 0}</span>}
          </button>
          {STATUS_CHIPS.map((s) => (
            <button
              key={s}
              type="button"
              className={"vocab-chip" + (status === s ? " on" : "")}
              onClick={() => setStatus(status === s ? "all" : s)}
              aria-pressed={status === s}
            >
              <span className={"vocab-dot " + s} aria-hidden="true" />
              {t(`vocab.status.${s}`)}
              {counts && <span className="vocab-chip-n">{counts[s]}</span>}
            </button>
          ))}
        </div>

        <div className="vocab-filters">
          <button
            type="button"
            className={"vocab-chip" + (band === "all" ? " on" : "")}
            onClick={() => setBand("all")}
            aria-pressed={band === "all"}
          >
            {t("vocab.band.all")}
          </button>
          {VOCAB_BANDS.map((b) => (
            <button
              key={b}
              type="button"
              className={"vocab-chip" + (band === b ? " on" : "")}
              onClick={() => setBand(band === b ? "all" : b)}
              aria-pressed={band === b}
            >
              {t("vocab.band.n", { n: b })}
            </button>
          ))}
        </div>

        <p className="vocab-count">
          {rows == null ? t("vocab.loading") : t("vocab.showing", { n: visible.length })}
          <button
            type="button"
            className="vocab-legend-toggle"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
          >
            {t("vocab.legend")}
          </button>
        </p>
        {/* Says exactly what "changed" means, because it is not quite what the
            words promise: judgements are stamped precisely, but on the study
            side the app stores no transition log, so this includes a word that
            was reviewed without changing state. Better stated than implied. */}
        {recentOnly && <p className="vocab-count">{t("vocab.recent.note")}</p>}
        {legendOpen && (
          <dl className="vocab-legend">
            {STATUS_CHIPS.map((s) => (
              <div key={s}>
                <dt>
                  <span className={"vocab-dot " + s} aria-hidden="true" />
                  {t(`vocab.status.${s}`)}
                </dt>
                <dd>{t(`vocab.legend.${s}`)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* The spacer carries the full height so the scrollbar and the rubber
          band behave as if all rows existed; only `slice` is in the DOM. */}
      <div
        className="vocab-list"
        ref={listRef}
        style={{ height: visible.length * ROW_H }}
        role="list"
      >
        {slice.map((row, i) => (
          <button
            type="button"
            role="listitem"
            key={row.lemma}
            className="vocab-row"
            style={{ top: (first + i) * ROW_H }}
            onClick={() => openWord(row)}
          >
            <span className="vocab-rank">{row.rank}</span>
            <span className="vocab-main">
              <span className="vocab-lemma">{row.lemma}</span>
              <span className="vocab-gloss">{row.gloss}</span>
            </span>
            <span className={"vocab-badge " + row.status}>
              <span className={"vocab-dot " + row.status} aria-hidden="true" />
              {t(`vocab.status.${row.status}`)}
            </span>
          </button>
        ))}
      </div>

      {rows != null && visible.length === 0 && <p className="vocab-empty">{t("vocab.empty")}</p>}

      {openLemma && (
        <ExplainSheet
          open
          target={{ mode: "word", lemma: openLemma }}
          frontLang={activeFrontLanguage()}
          onClose={() => setOpenLemma(null)}
        />
      )}
    </div>
  );
}

/**
 * Which slice of a fixed-row list is near the viewport.
 *
 * Reads the container's position rather than a scroller's scrollTop, so it
 * does not care which ancestor scrolls (#root here) or how tall the header
 * above it happens to be. One rect read per animation frame, and state only
 * changes when the slice actually changes — a scroll that stays inside the
 * current window causes no React work at all.
 */
function useRowWindow(total: number) {
  const listRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ first: 0, last: 40 });
  const rangeRef = useRef(range);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const scroller = document.querySelector("#root");
    let frame = 0;

    const recompute = () => {
      frame = 0;
      // The container's own coordinate space: the viewport covers
      // [-top, -top + innerHeight] of it.
      const top = el.getBoundingClientRect().top;
      const localTop = Math.max(0, -top);
      const localBottom = -top + window.innerHeight;
      const first = Math.max(0, Math.floor(localTop / ROW_H) - OVERSCAN);
      const last = Math.min(total, Math.ceil(localBottom / ROW_H) + OVERSCAN);
      if (first !== rangeRef.current.first || last !== rangeRef.current.last) {
        rangeRef.current = { first, last };
        setRange({ first, last });
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(recompute);
    };

    recompute();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [total]);

  return { listRef, first: range.first, last: Math.min(range.last, total) };
}
