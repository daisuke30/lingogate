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
import { hasExplanation, wordDensity } from "../engine/explain";
import { resolveAspectPair } from "../engine/explainPair";
import type { AspectPairRef } from "../engine/explainPair";
import type {
  ExplainDensity,
  SentenceCommentary,
  WordDict,
  WordDictEntry,
} from "../engine/explain";
import { aspectFormsNoteKey, formCellLabelKey, formGroupLabelKey } from "../engine/explainLabels";
import type { Aspect } from "../engine/explainLabels";
import { explainLangAvailable, loadExplainPart, peekExplainPart } from "../state/explain";
import { mergeGlossLanguage, resolveExplainLangs } from "../engine/explainMerge";
import type { ExplainLangs } from "../engine/explainMerge";
import { getExplainLangMode } from "../state/settings";
import { loadKnowledgeMap } from "../state/calibration";
import { activeCourse, WORD_BY_ID } from "../state/service";
import { useI18n } from "../i18n/i18n";
import { SheetShell } from "./ListPicker";

type Phase = "idle" | "loading" | "ready" | "offline";

/** Merge a cached prose half with its cached gloss counterpart, if both are
 * already in memory (every tap after the first in a session). */
function mergeFrom<T>(
  prose: T,
  courseId: string,
  langs: ExplainLangs,
  part: "words" | "sentences",
): T {
  if (langs.gloss === langs.prose) return prose;
  const gloss = peekExplainPart<T>(courseId, langs.gloss, part);
  return mergeGlossLanguage(prose, gloss);
}

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
  const { lang: uiLang, t } = useI18n();
  const courseId = activeCourse();
  const [phase, setPhase] = useState<Phase>("idle");
  // LINGO-062: four files feed this sheet (prose + gloss, sentence + word) and
  // v2 made them ~0.9MB gzipped each. Rather than wait for all of them, the
  // sentence commentary — the top of the sheet, and half the bytes — renders
  // as soon as it lands; the word dictionary fills the section below when it
  // arrives. Nothing already on screen ever changes language afterwards.
  const [commentaryMap, setCommentaryMap] = useState<SentenceCommentary | null>(null);
  const [wordMap, setWordMap] = useState<WordDict | null>(null);
  const [wordsPending, setWordsPending] = useState(false);
  const [knowledge, setKnowledge] = useState<KnowledgeMap>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    setExpanded(new Set());
    loadKnowledgeMap().then(setKnowledge).catch(() => setKnowledge(new Map()));

    let alive = true;
    (async () => {
      const mode = await getExplainLangMode();
      const langs: ExplainLangs = resolveExplainLangs(mode, frontLang, uiLang, (l) =>
        explainLangAvailable(courseId, l),
      );

      const cachedSentence = peekExplainPart<SentenceCommentary>(courseId, langs.prose, "sentences");
      const cachedWords = peekExplainPart<WordDict>(courseId, langs.prose, "words");
      if (cachedSentence) {
        setCommentaryMap(mergeFrom(cachedSentence, courseId, langs, "sentences"));
        setPhase("ready");
      } else {
        setPhase("loading");
      }
      if (cachedWords) setWordMap(mergeFrom(cachedWords, courseId, langs, "words"));
      setWordsPending(!cachedWords);

      // Sentence half first — it is what the sheet opens on.
      try {
        const [prose, gloss] = await Promise.all([
          loadExplainPart<SentenceCommentary>(courseId, langs.prose, "sentences"),
          langs.gloss === langs.prose
            ? Promise.resolve(null)
            : loadExplainPart<SentenceCommentary>(courseId, langs.gloss, "sentences"),
        ]);
        if (!alive) return;
        setCommentaryMap(prose ? (mergeGlossLanguage(prose, gloss) as SentenceCommentary) : null);
        setPhase("ready");
      } catch (err) {
        if (!alive) return; // closed mid-request
        console.error("explain sentence fetch failed", err);
        setPhase("offline");
        return;
      }

      // Word half second — it renders below the fold.
      try {
        const [prose, gloss] = await Promise.all([
          loadExplainPart<WordDict>(courseId, langs.prose, "words"),
          langs.gloss === langs.prose
            ? Promise.resolve(null)
            : loadExplainPart<WordDict>(courseId, langs.gloss, "words"),
        ]);
        if (!alive) return;
        setWordMap(prose ? (mergeGlossLanguage(prose, gloss) as WordDict) : null);
      } catch (err) {
        // The sentence half is already on screen; a missing dictionary just
        // means no word list, not a broken sheet. Only report it if the sheet
        // is still open: closing it mid-download aborts the request, and that
        // is the learner's doing, not a fault worth logging.
        if (alive) console.error("explain word fetch failed", err);
      } finally {
        if (alive) setWordsPending(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, courseId, frontLang, uiLang]);

  const commentary = commentaryMap?.[sentence.id] ?? null;

  /** The sentence's words, each with its opening density. */
  const words = useMemo(() => {
    if (!wordMap) return [];
    const seen = new Set<string>();
    const out: {
      entry: WordDictEntry;
      density: ExplainDensity;
      gloss: string;
      aspect: Aspect;
      pair: AspectPairRef | null;
    }[] = [];
    const glossOf = (lemma: string): string | null => {
      for (const w of WORD_BY_ID.values()) {
        if (w.lemma === lemma) return bothGlosses(w.enGloss, w.jaGloss) || null;
      }
      return null;
    };
    for (const id of sentence.wordIds) {
      const deckWord = WORD_BY_ID.get(id);
      if (!deckWord) continue;
      if (seen.has(deckWord.lemma)) continue; // a word repeated in one sentence is one entry
      seen.add(deckWord.lemma);
      const entry = wordMap[deckWord.lemma];
      if (!entry) continue; // dictionary gap — show what we have, never a blank row
      out.push({
        entry,
        // LINGO-057 follow-up (Katsuta): the English gloss must be on screen
        // whatever language the prose is in. Both glosses come straight from
        // the deck, so this needs no regeneration and cannot go stale.
        gloss: bothGlosses(deckWord.enGloss, deckWord.jaGloss),
        // Drives whether the conjugation table is headed "present" or
        // "future" — see formGroupLabelKey.
        aspect: (deckWord.aspect ?? null) as Aspect,
        // LINGO-060: the aspect partner, resolved from the same chunk.
        pair: resolveAspectPair(deckWord, wordMap, glossOf),
        density: wordDensity({
          lemma: deckWord.lemma,
          pos: deckWord.pos,
          rank: deckWord.rank ?? null,
          knowledge,
        }),
      });
    }
    // LINGO-061: sentence order, no target-first hoist.
    return out;
  }, [wordMap, sentence, knowledge]);

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

            {(words.length > 0 || wordsPending) && (
              <section className="explain-section">
                <h3 className="explain-h">{t("explain.words")}</h3>
                {wordsPending && words.length === 0 && (
                  <p className="explain-status">{t("explain.loadingWords")}</p>
                )}
                {words.map(({ entry, density, gloss, aspect, pair }) => (
                  <WordEntry
                    key={entry.lemma}
                    entry={entry}
                    gloss={gloss}
                    aspect={aspect}
                    pair={pair}
                    density={density}
                    open={density !== "collapsed" || expanded.has(entry.lemma)}
                    onToggle={() => toggle(entry.lemma)}
                  />
                ))}
              </section>
            )}

            {/* LINGO-057 follow-up (勝田): the replies close the sheet rather
                than sitting inside the sentence block. The reading order is
                now structure → words in depth → and finally what you would
                actually say back, which is the thing you leave with. */}
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
  aspect,
  pair,
  density,
  open,
  onToggle,
}: {
  entry: WordDictEntry;
  /** Deck glosses (en / ja), shown on the heading in every density. */
  gloss: string;
  /** Verb aspect, for naming the conjugation table correctly. */
  aspect: Aspect;
  /** LINGO-060: the aspect partner to offer under this entry, if any. */
  pair: AspectPairRef | null;
  density: ExplainDensity;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const collapsible = density === "collapsed";
  return (
    <div className="explain-word">
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
        <span className="explain-pos">{entry.pos}</span>
        {collapsible && (
          <span className="explain-caret" aria-hidden="true">
            {open ? "−" : "＋"}
          </span>
        )}
      </button>

      {open && (
        <div className="explain-word-body">
          {entry.forms && <FormsTable forms={entry.forms} aspect={aspect} />}
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
          {pair && <AspectPairSection pair={pair} />}
        </div>
      )}
    </div>
  );
}

/**
 * LINGO-060 — the verb's aspect partner, offered under its entry.
 *
 * Russian aspect is learned as a pair: сказать only means what it means
 * against говорить, so an entry that shows one half teaches half a word.
 *
 * Collapsed by default, always. The partner's full entry is as long as the
 * one above it, and a sentence can hold two or three paired verbs — expanding
 * them all by default would turn the sheet into something nobody scrolls to
 * the end of. One line says what the partner is; a tap gets the rest.
 */
function AspectPairSection({ pair }: { pair: AspectPairRef }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const aspectLabel = pair.aspect ? t(`explain.aspectName.${pair.aspect}`) : null;

  return (
    <div className="explain-pair">
      <button
        type="button"
        className="explain-pair-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="explain-pair-k">{t("explain.pair")}</span>
        <span className="explain-pair-lemma">{pair.lemma}</span>
        {aspectLabel && <span className="explain-pair-aspect">{aspectLabel}</span>}
        {pair.gloss && <span className="explain-pair-gloss">{pair.gloss}</span>}
        <span className="explain-caret" aria-hidden="true">
          {open ? "−" : "＋"}
        </span>
      </button>

      {open && (
        <div className="explain-pair-body">
          {pair.entry ? (
            <>
              {pair.entry.forms && (
                <FormsTable
                  forms={pair.entry.forms}
                  aspect={(pair.aspect ?? null) as Aspect}
                />
              )}
              {pair.entry.aspectUsage && (
                <p className="explain-prose">
                  <span className="explain-k">{t("explain.aspect")}</span>
                  {pair.entry.aspectUsage}
                </p>
              )}
              {pair.entry.collocations.length > 0 && (
                <p className="explain-prose">
                  <span className="explain-k">{t("explain.collocations")}</span>
                  {pair.entry.collocations.join(" / ")}
                </p>
              )}
              {pair.entry.commonMistakes && (
                <p className="explain-prose">
                  <span className="explain-k">{t("explain.mistakes")}</span>
                  {pair.entry.commonMistakes}
                </p>
              )}
            </>
          ) : (
            // The partner is outside the 3000-word dictionary. Say so plainly
            // rather than showing an empty section — the learner should know
            // the word exists and that we simply have nothing more on it yet.
            <p className="explain-prose explain-pair-brief">{t("explain.pairBrief")}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** The inflection table, rendered from whichever shape the part of speech
 * brought (verbs: past/nonpast/imperative; nouns: sg cases; adjectives: a flat
 * gender row) — see the LINGO-056 schema.
 *
 * LINGO-057 follow-up: slot keys are translated rather than printed raw, so a
 * noun's declension reads "1格・主格" like the card back does (LINGO-033) and
 * not "nom". An unmapped key falls back to the raw string — visible, odd, and
 * caught by explainLabels.test.ts rather than silently blank. */
function FormsTable({
  forms,
  aspect,
}: {
  forms: NonNullable<WordDictEntry["forms"]>;
  aspect: Aspect;
}) {
  const { t } = useI18n();
  const groups: { group: string; cells: [string, string][] }[] = [];
  const flat: [string, string][] = [];

  for (const [key, value] of Object.entries(forms)) {
    if (value == null) continue;
    if (typeof value === "string") flat.push([key, value]);
    else groups.push({ group: key, cells: Object.entries(value) });
  }
  if (flat.length) groups.unshift({ group: "", cells: flat });

  const label = (key: string | null, fallback: string) => (key ? t(key) : fallback);
  // Perfectives have no present tense; say so under the table rather than
  // leaving the learner to infer it from a heading.
  const noteKey = forms.nonpast ? aspectFormsNoteKey(aspect) : null;

  return (
    <div className="explain-forms">
      {groups.map((g, i) => (
        <div className="explain-forms-group" key={i}>
          {g.group && (
            <div className="explain-forms-label">
              {label(formGroupLabelKey(g.group, aspect), g.group)}
            </div>
          )}
          <div className="explain-forms-cells">
            {g.cells.map(([k, v]) => (
              <span className="explain-form" key={k}>
                <span className="explain-form-k">{label(formCellLabelKey(g.group, k), k)}</span>
                {v}
              </span>
            ))}
          </div>
        </div>
      ))}
      {noteKey && <p className="explain-forms-note">{t(noteKey)}</p>}
    </div>
  );
}

/** Should the card back offer a 解説 button at all? Cheap enough to call on
 * every render: it only consults the in-memory cache, never the network. */
export function explainAvailable(
  sentence: Sentence,
  courseId: string,
  frontLang: string,
  uiLang?: string,
): boolean {
  // LINGO-062: in mixed mode the sheet may read prose from the UI language, so
  // the button should appear whenever EITHER language has chunks.
  // Only the sentence half decides whether a sheet has anything to show.
  const cached =
    peekExplainPart<SentenceCommentary>(courseId, frontLang, "sentences") ??
    (uiLang ? peekExplainPart<SentenceCommentary>(courseId, uiLang, "sentences") : null);
  // Before the first load we cannot know whether THIS sentence has an entry,
  // so we offer the button whenever the course/language ships data at all and
  // the sentence is a core one (only core sentences got commentary). A gap is
  // then handled inside the sheet rather than by a button that does nothing.
  if (!cached) {
    return (
      sentence.targetLemma != null &&
      (explainCourseHasData(courseId, frontLang) ||
        (uiLang != null && explainCourseHasData(courseId, uiLang)))
    );
  }
  return hasExplanation(sentence.id, cached);
}

function explainCourseHasData(courseId: string, frontLang: string): boolean {
  return courseId === "ru" && (frontLang === "ja" || frontLang === "en");
}
