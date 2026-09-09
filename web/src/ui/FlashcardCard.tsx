import { useEffect, useMemo, useRef, useState } from "react";
import type { Rating } from "../engine/fsrs";
import type { Sentence } from "../engine/content";
import {
  buildWordBreakdown,
  formatAspectLine,
  formatGenderLine,
  formatCaseLine,
  punctFor,
} from "../engine/wordBreakdown";
import type { WordBreakdownEntry } from "../engine/wordBreakdown";
import { applyFlipToggle, canGradeNow, ratingForDirection } from "../engine/grading";
import { resolveLocalizedText, readsJapanese } from "../engine/localizedText";
import { WORD_BY_ID } from "../state/service";
import { voiceAvailable, speak, subscribeVoices } from "../state/tts";
import { NATIVE_LANG_NAME, useI18n } from "../i18n/i18n";
import type { Lang } from "../i18n/i18n";

type Dir = "again" | "hard" | "good" | null;

export interface TtsProps {
  enabled: boolean;
  rate: number;
}

/** A sentence's text in a given language field (design §1: 表面/裏面の言語are
 * both just "which of ru/en/ja to show" — this is course-agnostic and used for
 * BOTH the front (prompt) and the back (target/course language) text, e.g.
 * RU course: front=sentenceLangText(s,"en"|"ja"), back=sentenceLangText(s,"ru").
 * EN course: front=sentenceLangText(s,"ja"|"ru"), back=sentenceLangText(s,"en").
 * LINGO-015: previously the back face and TTS hardcoded `sentence.ru` — fine
 * while RU was the only course, but wrong for any other course's target text.
 */
function sentenceLangText(sentence: Sentence, lang: Lang): string {
  if (lang === "ja") return sentence.ja ?? sentence.en;
  if (lang === "ru") return sentence.ru;
  return sentence.en;
}

const FLICK_LOCK_MS = 1500; // anti-gate-skip freeze, counted from card display (LINGO-007, loosened LINGO-019)
const THRESHOLD = 90; // px before a drag counts as a flick

/**
 * One flashcard: front = EN prompt (EN gloss for kind='word'), tap flips to the
 * RU back (+ kana / JA). Flick right = Good, left = Again, down = Hard — on
 * EITHER face (LINGO-019 follow-up, 2026-08-30: grading no longer requires
 * flipping first). Rating is blocked only until ~1.5s has passed since the
 * card was shown (the anti-gate-skip guard). `key`ed by card id upstream so
 * state resets per card.
 */
export function FlashcardCard({
  sentence,
  onRate,
  tts,
  targetLang = "ru",
  frontLang = "en",
}: {
  sentence: Sentence;
  onRate: (r: Rating) => void;
  tts?: TtsProps;
  /** Card-back (course) language — drives TTS voice + back kicker. */
  targetLang?: string;
  /** Card-front (prompt) language — drives which sentence field is shown + gloss order. */
  frontLang?: Lang;
}) {
  const { lang: uiLang, t } = useI18n();
  // LINGO-019: tap flips the card either direction, any number of times, via
  // the pure applyFlipToggle() (see engine/grading.ts) — purely a face toggle
  // now, with no side effect on grading availability (see canEval below).
  const [flipped, setFlipped] = useState(false);
  // LINGO-019 follow-up (2026-08-30): the anti-gate-skip freeze now starts
  // when the CARD is shown (component mount), not when it's flipped — grading
  // is available on either face once this elapses. A plain mount-only effect
  // is sufficient (no arm-once-per-flip bookkeeping needed anymore): the
  // component remounts fresh per card (keyed by card id upstream), so this
  // timer naturally resets for every new card and only ever runs once.
  const [canEval, setCanEval] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [hasVoice, setHasVoice] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  // LINGO-012: word-by-word breakdown (原形・品詞・体と対・訳) for the back face.
  const breakdown = useMemo(() => buildWordBreakdown(sentence, WORD_BY_ID), [sentence]);

  useEffect(() => {
    const timer = setTimeout(() => setCanEval(true), FLICK_LOCK_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => subscribeVoices(() => setHasVoice(voiceAvailable(targetLang))), [targetLang]);

  const targetLangTyped: Lang = (targetLang as Lang) ?? "ru";
  const back = sentenceLangText(sentence, targetLangTyped);

  // Speak the target-language back on flip — the flip tap is the user gesture
  // iOS requires. Fires on every flip-to-back (including a re-flip after
  // toggling to the front), not just the first — each tap is its own valid
  // gesture, and repeating the read-aloud on request is a welcome side effect
  // of the toggle, not a regression.
  function speakBack() {
    if (tts?.enabled) speak(back, targetLang, tts.rate);
  }

  // LINGO-019: tap flips the card either direction, any number of times.
  function toggleFlip() {
    const { flipped: next, shouldSpeak } = applyFlipToggle(flipped);
    setFlipped(next);
    if (shouldSpeak) speakBack();
  }

  const dir = directionOf(drag.x, drag.y, 28); // visual hint threshold
  // LINGO-019 follow-up: grading no longer requires being flipped — only the
  // elapsed anti-gate-skip timer gates it, on either face, in both practice
  // and gate mode alike (Katsuta's explicit call — the gate's friction is
  // slightly lower now, deliberately).
  const canFlick = canGradeNow(canEval);

  // LINGO-019: the single rating entry point — both the flick release below
  // and each tap-to-grade legend button call this, so there is exactly one
  // code path from "learner decided" to onRate() (undo, Again requeueing,
  // FSRS all live downstream of onRate and never know which input method fired,
  // or which face was showing).
  // Gate + direction->Rating mapping both delegate to engine/grading.ts so
  // they're covered by grading.test.ts (no DOM/component test setup here).
  function rate(d: Exclude<Dir, null>) {
    if (!canFlick) return;
    onRate(ratingForDirection(d));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    // LINGO-019 follow-up: drag tracking now arms on either face — a flick
    // gesture needs live visual feedback (translate/tilt/overlay) whichever
    // face is currently showing.
    setDrag({ x: 0, y: 0, active: true });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  }

  function onPointerUp(e: React.PointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const moved = Math.hypot(dx, dy);
    setDrag({ x: 0, y: 0, active: false });

    // LINGO-019: a plain tap toggles the flip either direction, any number of
    // times. A flick (moved past THRESHOLD) grades on EITHER face now — the
    // old `if (!flipped) return` front-face exemption is gone.
    if (moved < 12) {
      toggleFlip();
      return;
    }
    const d = directionOf(dx, dy, THRESHOLD); // commit threshold
    if (d) rate(d);
  }

  // Compose flip rotation + live drag translate/rotate.
  const rot = flipped ? 180 : 0;
  const tx = drag.active ? drag.x : 0;
  const ty = drag.active ? Math.max(0, drag.y) : 0;
  const tilt = drag.active ? drag.x / 22 : 0;
  const transform = `translate(${tx}px, ${ty}px) rotateZ(${tilt}deg) rotateY(${rot}deg)`;

  const overlayColor =
    dir === "good" ? "var(--good)" : dir === "again" ? "var(--again)" : "var(--hard)";
  const overlayText =
    dir === "good" ? t("card.flick.good") : dir === "again" ? t("card.flick.again") : t("card.flick.hard");
  const showOverlay = drag.active && !!dir;

  const front = sentenceLangText(sentence, frontLang);
  // LINGO-037: the two Japanese-only reading aids on the back (kana transcription
  // and the ja translation line) are shown only to a learner who reads Japanese
  // — i.e. picked it as their UI or prompt language.
  const showJaAid = readsJapanese(frontLang, uiLang);
  // LINGO-026: front→UI→en→ja fallback for the free-text grammar note.
  // LINGO-037: the trailing ja step only for a learner who reads it.
  const resolvedNote = resolveLocalizedText(
    { ja: sentence.note, en: sentence.noteEn ?? null, ru: sentence.noteRu ?? null },
    frontLang,
    uiLang,
    showJaAid,
  );

  return (
    <>
      <div className="card-stage">
        <div
          className={"flashcard" + (flipped ? " flipped" : "")}
          style={{ transform, transition: drag.active ? "none" : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            start.current = null;
            setDrag({ x: 0, y: 0, active: false });
          }}
        >
          <div className="face front">
            <span className="kicker">{NATIVE_LANG_NAME[frontLang]}</span>
            <div className="prompt">{front}</div>
            {/* LINGO-019 follow-up: grading (flick + tap buttons) now works on
                the front face too, so it needs the same rate-in-progress
                overlay (centered, independent of the hint below it) and
                pre-unlock "…" hint the back face already had. The bottom hint
                slot shows at most one thing: "…" before canEval, else the
                original "tap to flip" hint. */}
            {canEval ? !flipped && <div className="hint">{t("card.tapToFlip")}</div> : <div className="hint">…</div>}
            {showOverlay && <RateOverlay color={overlayColor} text={overlayText} />}
          </div>
          <div className="face back">
            <span className="kicker">{NATIVE_LANG_NAME[(targetLang as Lang) ?? "ru"]}</span>
            {hasVoice && tts?.enabled && (
              <button
                className="iconbtn speaker"
                aria-label={t("card.speak")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  speakBack();
                }}
              >
                🔊
              </button>
            )}
            {/* LINGO-015: was hardcoded to sentence.ru — the RU course's target
                field. Generalized to whichever field the active course's
                target language actually is (`back`), so a non-RU course (EN)
                shows/speaks its own target text instead of the RU field. */}
            <div className="ru">{back}</div>
            {/* LINGO-037: `kana` is a katakana pronunciation aid for the 85
                word-cards — written FOR a Japanese reader, and previously
                rendered with no language condition at all, so a UI=en learner
                got "ウディヴィーチェリナ" under Удивительно. Gated on the same
                "reads Japanese" test as the ja line below. */}
            {showJaAid && sentence.kana && <div className="kana">{sentence.kana}</div>}
            {/* The back also shows the ja-field translation as a bonus reference
                line (Katsuta reads Japanese natively) — skipped when it would
                duplicate either the front prompt or the back target text
                itself (frontLang/targetLang already ja).
                LINGO-037: the condition tested only frontLang/targetLang, never
                uiLang — so the "Katsuta reads Japanese natively" rationale in
                this very comment was not actually encoded, and EVERY card in
                both packs (2378 RU + 1000 EN) rendered a Japanese sentence for
                UI=en/front=en/back=ru and UI=ru/front=ru/back=en. Now it needs
                a learner who actually reads Japanese. */}
            {showJaAid && frontLang !== "ja" && targetLangTyped !== "ja" && sentence.ja && (
              <div className="ja">{sentence.ja}</div>
            )}
            {/* LINGO-026: was `sentence.note` rendered raw (ja-only prose,
                unconditional) — the reported "UI=en shows JA" bug. Now
                resolved via the front→UI→en→ja fallback chain, same as the
                word-breakdown's pairNote below. */}
            {resolvedNote && <div className="note">{resolvedNote}</div>}
            {breakdown.length > 0 && (
              <WordBreakdownList entries={breakdown} frontLang={frontLang} uiLang={uiLang} />
            )}
            {showOverlay && <RateOverlay color={overlayColor} text={overlayText} />}
            {!canEval && <div className="hint">…</div>}
          </div>
        </div>
      </div>

      {/* LINGO-019: these chips ARE the legend (label + flick-direction hint)
          AND the tap-to-grade buttons — Katsuta asked for tap grading, and
          since the legend already showed the exact same 3 labels/colours,
          duplicating a second button row underneath would just repeat it.
          Disabled (native `disabled` + the existing `.locked` dimming) until
          canFlick, exactly like the flick gesture's own gate. */}
      <div className={"legend" + (canFlick ? "" : " locked")}>
        <button
          type="button"
          className={"chip again" + (dir === "again" ? " hot" : "")}
          disabled={!canFlick}
          onClick={() => rate("again")}
        >
          {t("card.flick.again")}<span className="dir">{t("card.dir.left")}</span>
        </button>
        <button
          type="button"
          className={"chip hard" + (dir === "hard" ? " hot" : "")}
          disabled={!canFlick}
          onClick={() => rate("hard")}
        >
          {t("card.flick.hard")}<span className="dir">{t("card.dir.down")}</span>
        </button>
        <button
          type="button"
          className={"chip good" + (dir === "good" ? " hot" : "")}
          disabled={!canFlick}
          onClick={() => rate("good")}
        >
          {t("card.flick.good")}<span className="dir">{t("card.dir.right")}</span>
        </button>
      </div>
    </>
  );
}

/** Card-back "単語分解" list (LINGO-012). Its own bounded, internally
 * scrollable region — see .word-breakdown in styles.css — so a sentence with
 * several content words never grows the card itself; the list scrolls in
 * place instead. Stops pointerdown propagation (same trick as the speaker
 * button above) so a touch-scroll here can never be misread as a rate-flick
 * by the card's own drag handling. */
/** Order the available glosses so the front-language one comes first (design:
 * the back's gloss follows the front/prompt language).
 *
 * LINGO-037 fix: this used to say "fall back to the others" but actually
 * CONCATENATED every gloss the word had, in all three languages, with " / ".
 * The effect was invisible for Katsuta (UI=ja, front=en) because the RU pack
 * has no ruGloss at all, so "I / 私" is exactly the two languages he reads —
 * but it meant every other pattern got a gloss in a language it never asked
 * for: all 3819 RU words showed 私 to a UI=en/front=en learner, and all 3000
 * EN words showed 私 to a UI=ru/front=ru learner. The single largest source of
 * Japanese leakage in the app (every word of every card).
 *
 * The gloss now spans only the two languages the learner actually chose —
 * front and UI — deduped, front first. That keeps Katsuta's "I / 私" byte for
 * byte (front=en + UI=ja), collapses to one gloss when the two axes agree, and
 * falls back to en (then ja, only if they read it) when the pack happens to
 * have no gloss in either chosen language. */
function orderedGloss(w: WordBreakdownEntry, frontLang: Lang, uiLang: Lang): string {
  const glossOf = (l: Lang) => (l === "ja" ? w.jaGloss : l === "ru" ? w.ruGloss : w.enGloss);
  const chosen: Lang[] = frontLang === uiLang ? [frontLang] : [frontLang, uiLang];
  const picked = chosen.map(glossOf).filter((g): g is string => !!g);
  if (picked.length > 0) return dedupe(picked).join(" / ");
  // Neither chosen language has a gloss for this word: English as the neutral
  // last resort, then ja — but only for a learner who reads it (same rule as
  // resolveLocalizedText's allowJaFallback).
  const fallback = w.enGloss ?? (readsJapanese(frontLang, uiLang) ? w.jaGloss : null);
  return fallback ?? "";
}

function dedupe(xs: string[]): string[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

function WordBreakdownList({
  entries,
  frontLang,
  uiLang,
}: {
  entries: WordBreakdownEntry[];
  frontLang: Lang;
  /** LINGO-026: needed to resolve each entry's pairNote (free-text nuance
   * note) via the front→UI→en→ja chain — see resolveLocalizedText(). */
  uiLang: Lang;
}) {
  const { t } = useI18n();
  // Structural labels (part of speech, verb aspect) follow the UI language, not
  // the front language: for the existing RU user (UI=ja, front=en) they stay
  // Japanese, so nothing regresses; other UI languages get their own. This is
  // a deliberate, documented split from the free-text pairNote below, which
  // DOES follow front→UI→en (LINGO-026): the aspect/pos/gender vocabulary is
  // a closed, fully-3-language set acting as UI chrome (like a button label),
  // while pairNote is prose that may only exist in some languages.
  const aspectLabels = {
    pf: t("aspect.pf"),
    impf: t("aspect.impf"),
    both: t("aspect.both"),
    pair: t("aspect.pairOf"),
    related: t("aspect.related"),
    noPair: t("aspect.noPair"),
    always: t("aspect.always"),
  };
  const genderLabels = {
    m: t("gender.m"),
    f: t("gender.f"),
    n: t("gender.n"),
    pl: t("gender.pl"),
    mf: t("gender.mf"),
  };
  const caseLabels = {
    form: t("case.form"),
    case1: t("case.1"),
    case2: t("case.2"),
    case3: t("case.3"),
    case4: t("case.4"),
    case5: t("case.5"),
    case6: t("case.6"),
  };
  // LINGO-037: the punctuation composing these lines follows the UI language
  // too (（）。・ for ja, ASCII for en/ru) — see punctFor()'s note.
  const punct = punctFor(uiLang);
  const allowJa = readsJapanese(frontLang, uiLang);
  return (
    <div className="word-breakdown" onPointerDown={(e) => e.stopPropagation()}>
      {entries.map((w) => {
        const pairNote = resolveLocalizedText(
          { ja: w.pairNoteJa, en: w.pairNoteEn, ru: w.pairNoteRu },
          frontLang,
          uiLang,
          allowJa,
        );
        const aspectLine = formatAspectLine({ ...w, pairNote }, aspectLabels, punct);
        const genderLine = formatGenderLine(w, genderLabels, punct);
        const caseLine = formatCaseLine(w, caseLabels, punct);
        const gloss = orderedGloss(w, frontLang, uiLang);
        const posKey = "pos." + w.pos;
        const posText = t(posKey);
        return (
          <div key={w.lemma} className={"wb-row" + (w.isTarget ? " target" : "")}>
            <div className="wb-head">
              <span className="wb-lemma">{w.lemma}</span>
              <span className="wb-pos">{posText === posKey ? w.posLabel : posText}</span>
            </div>
            {aspectLine && <div className="wb-aspect">{aspectLine}</div>}
            {genderLine && <div className="wb-gender">{genderLine}</div>}
            {caseLine && <div className="wb-case">{caseLine}</div>}
            {gloss && <div className="wb-gloss">{gloss}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** The centered "忘れた/曖昧/覚えた" label shown mid-flick. Rendered inside
 * BOTH faces (LINGO-019 follow-up: grading now works on either face) — only
 * the currently-visible face's copy is actually seen, since the other one is
 * rotated away with `backface-visibility: hidden`; rendering it twice is
 * cheap and avoids threading which-face-is-up into this presentational bit. */
function RateOverlay({ color, text }: { color: string; text: string }) {
  return (
    <div className="overlay-label" style={{ color, opacity: 1 }}>
      {text}
    </div>
  );
}

function directionOf(dx: number, dy: number, min: number): Dir {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < min && ay < min) return null;
  if (ay > ax && dy > 0) return "hard"; // down
  if (dx > 0) return "good"; // right
  if (dx < 0) return "again"; // left
  return null;
}
