// LINGO-057 — the "解説" sheet: why this sentence is built the way it is, and
// what every word in it does.
//
// Two stacked sections, in the order a reader needs them: the sentence first
// (skeleton → the one thing to take away → how you'd reply), then the words.
// The words are density-filtered (engine/explain.ts wordDensity) so the sheet
// opens on what this particular learner probably does not know, with
// everything else one tap away.
//
// Typography over decoration: this is a page of prose, so it gets headings,
// line-height and breathing room rather than cards, borders and colour.

import { useEffect, useMemo, useState } from "react";
import type { Sentence } from "../engine/content";
import type { KnowledgeMap } from "../engine/calibration";
import {
  hasExplanation,
  orderExplainWords,
  wordDensity,
} from "../engine/explain";
import type { ExplainDensity, WordDictEntry } from "../engine/explain";
import type { ExplainData } from "../state/explain";
import { loadExplain, peekExplain } from "../state/explain";
import { loadKnowledgeMap } from "../state/calibration";
import { activeCourse, WORD_BY_ID } from "../state/service";
import { useI18n } from "../i18n/i18n";
import { SheetShell } from "./ListPicker";

type Phase = "idle" | "loading" | "ready" | "offline";

export function ExplainSheet({
  open,
  sentence,
  frontLang,
  onClose,
}: {
  open: boolean;
  sentence: Sentence;
  /**
   * The card-FRONT language — the one the learner reads the course in.
   *
   * LINGO-057 follow-up: this was `uiLang`, which is a different axis. Katsuta
   * runs UI=ja with front=en (he learns Russian through English), so every
   * explanation arrived in Japanese — prose about English-learned words, in a
   * language he was not studying in. The commentary and dictionary are study
   * material, so they follow the language he studies in; only this sheet's own
   * labels (headings, buttons) follow the UI language.
   */
  frontLang: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const courseId = activeCourse();
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<ExplainData | null>(() => peekExplain(courseId, frontLang));
  const [knowledge, setKnowledge] = useState<KnowledgeMap>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    setExpanded(new Set());
    loadKnowledgeMap().then(setKnowledge).catch(() => setKnowledge(new Map()));

    const cached = peekExplain(courseId, frontLang);
    if (cached) {
      setData(cached);
      setPhase("ready");
      return;
    }
    let alive = true;
    setPhase("loading");
    loadExplain(courseId, frontLang)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setPhase("ready");
      })
      .catch((err) => {
        // The only realistic cause is no connection: the files are static and
        // same-origin. Say that, and let them try again — don't dress a
        // missing network up as a broken feature.
        console.error("explain fetch failed", err);
        if (alive) setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [open, courseId, frontLang]);

  const commentary = data?.sentences[sentence.id] ?? null;

  /** The sentence's words, each with its opening density. */
  const words = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: { entry: WordDictEntry; density: ExplainDensity; gloss: string }[] = [];
    for (const id of sentence.wordIds) {
      const deckWord = WORD_BY_ID.get(id);
      if (!deckWord) continue;
      if (seen.has(deckWord.lemma)) continue; // a word repeated in one sentence is one entry
      seen.add(deckWord.lemma);
      const entry = data.words[deckWord.lemma];
      if (!entry) continue; // dictionary gap — show what we have, never a blank row
      out.push({
        entry,
        // LINGO-057 follow-up (Katsuta): the English gloss must be on screen
        // whatever language the prose is in. Both glosses come straight from
        // the deck, so this needs no regeneration and cannot go stale.
        gloss: bothGlosses(deckWord.enGloss, deckWord.jaGloss),
        density: wordDensity({
          lemma: deckWord.lemma,
          pos: deckWord.pos,
          rank: deckWord.rank ?? null,
          isTarget: deckWord.lemma === sentence.targetLemma,
          knowledge,
        }),
      });
    }
    return orderExplainWords(out);
  }, [data, sentence, knowledge]);

  const toggle = (lemma: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lemma)) next.delete(lemma);
      else next.add(lemma);
      return next;
    });

  return (
    <SheetShell
      open={open}
      title={t("explain.title")}
      onClose={onClose}
      closeLabel={t("common.close")}
    >
      <div className="explain-body">
        {phase === "loading" && <p className="explain-status">{t("explain.loading")}</p>}
        {phase === "offline" && <p className="explain-status">{t("explain.offline")}</p>}

        {phase === "ready" && commentary && (
          <>
            <section className="explain-section">
              <h3 className="explain-h">{t("explain.skeleton")}</h3>
              <ul className="explain-skeleton">
                {commentary.skeleton.map((s, i) => (
                  <li key={i}>
                    <span className="explain-surface">{s.surface}</span>
                    <span className="explain-note">{s.note}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="explain-section">
              <h3 className="explain-h">{t("explain.keyPoint")}</h3>
              <p className="explain-prose">{commentary.keyPoint}</p>
            </section>

            {commentary.replies.length > 0 && (
              <section className="explain-section">
                <h3 className="explain-h">{t("explain.replies")}</h3>
                <ul className="explain-replies">
                  {commentary.replies.map((r, i) => (
                    <li key={i}>
                      <span className="explain-reply-ru">{r.ru}</span>
                      <span className="explain-note">{r.gloss}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {words.length > 0 && (
              <section className="explain-section">
                <h3 className="explain-h">{t("explain.words")}</h3>
                {words.map(({ entry, density, gloss }) => (
                  <WordEntry
                    key={entry.lemma}
                    entry={entry}
                    gloss={gloss}
                    density={density}
                    open={density !== "collapsed" || expanded.has(entry.lemma)}
                    onToggle={() => toggle(entry.lemma)}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </SheetShell>
  );
}

/**
 * "to check / 確認する" — both deck glosses, always, in that order.
 *
 * Katsuta learns Russian through English but runs the app in Japanese, so
 * neither language alone is safely "the one he reads": the explanation prose
 * follows his front language, and this line guarantees the English meaning is
 * present regardless of which chunk that turns out to be.
 */
function bothGlosses(enGloss: string | null | undefined, jaGloss: string | null | undefined): string {
  return [enGloss, jaGloss].filter((g): g is string => !!g && g.trim() !== "").join(" / ");
}

function WordEntry({
  entry,
  gloss,
  density,
  open,
  onToggle,
}: {
  entry: WordDictEntry;
  /** Deck glosses (en / ja), shown on the heading in every density. */
  gloss: string;
  density: ExplainDensity;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const collapsible = density === "collapsed";
  return (
    <div className={"explain-word" + (density === "target" ? " target" : "")}>
      <button
        type="button"
        className="explain-word-head"
        onClick={collapsible ? onToggle : undefined}
        aria-expanded={collapsible ? open : undefined}
        // A non-collapsible head is a heading, not a control.
        tabIndex={collapsible ? 0 : -1}
      >
        <span className="explain-head-main">
          <span className="explain-lemma">{entry.lemma}</span>
          {gloss && <span className="explain-gloss">{gloss}</span>}
        </span>
        {density === "target" && <span className="explain-badge">{t("explain.target")}</span>}
        <span className="explain-pos">{entry.pos}</span>
        {collapsible && (
          <span className="explain-caret" aria-hidden="true">
            {open ? "−" : "＋"}
          </span>
        )}
      </button>

      {open && (
        <div className="explain-word-body">
          {entry.forms && <FormsTable forms={entry.forms} />}
          {entry.aspectUsage && (
            <p className="explain-prose">
              <span className="explain-k">{t("explain.aspect")}</span>
              {entry.aspectUsage}
            </p>
          )}
          <p className="explain-prose">
            <span className="explain-k">{t("explain.etymology")}</span>
            {entry.etymology}
          </p>
          {entry.collocations.length > 0 && (
            <p className="explain-prose">
              <span className="explain-k">{t("explain.collocations")}</span>
              {entry.collocations.join(" / ")}
            </p>
          )}
          {entry.related.length > 0 && (
            <p className="explain-prose">
              <span className="explain-k">{t("explain.related")}</span>
              {entry.related.join(" / ")}
            </p>
          )}
          {entry.commonMistakes && (
            <p className="explain-prose">
              <span className="explain-k">{t("explain.mistakes")}</span>
              {entry.commonMistakes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The inflection table, rendered from whichever shape the part of speech
 * brought (verbs: past/nonpast/imperative; nouns: sg cases; adjectives: a flat
 * gender row) — see the LINGO-056 schema. */
function FormsTable({ forms }: { forms: NonNullable<WordDictEntry["forms"]> }) {
  const groups: { label: string; cells: [string, string][] }[] = [];
  const flat: [string, string][] = [];

  for (const [key, value] of Object.entries(forms)) {
    if (value == null) continue;
    if (typeof value === "string") flat.push([key, value]);
    else groups.push({ label: key, cells: Object.entries(value) });
  }
  if (flat.length) groups.unshift({ label: "", cells: flat });

  return (
    <div className="explain-forms">
      {groups.map((g, i) => (
        <div className="explain-forms-group" key={i}>
          {g.label && <div className="explain-forms-label">{g.label}</div>}
          <div className="explain-forms-cells">
            {g.cells.map(([k, v]) => (
              <span className="explain-form" key={k}>
                <span className="explain-form-k">{k}</span>
                {v}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Should the card back offer a 解説 button at all? Cheap enough to call on
 * every render: it only consults the in-memory cache, never the network. */
export function explainAvailable(sentence: Sentence, courseId: string, frontLang: string): boolean {
  const cached = peekExplain(courseId, frontLang);
  // Before the first load we cannot know whether THIS sentence has an entry,
  // so we offer the button whenever the course/language ships data at all and
  // the sentence is a core one (only core sentences got commentary). A gap is
  // then handled inside the sheet rather than by a button that does nothing.
  if (!cached) {
    return (
      sentence.targetLemma != null &&
      explainCourseHasData(courseId, frontLang)
    );
  }
  return hasExplanation(sentence.id, cached.sentences);
}

function explainCourseHasData(courseId: string, frontLang: string): boolean {
  return courseId === "ru" && (frontLang === "ja" || frontLang === "en");
}
