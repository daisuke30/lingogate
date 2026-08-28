import { useEffect, useMemo, useRef, useState } from "react";
import type { Rating } from "../engine/fsrs";
import type { Sentence } from "../engine/content";
import { buildWordBreakdown, formatAspectLine } from "../engine/wordBreakdown";
import type { WordBreakdownEntry } from "../engine/wordBreakdown";
import { INITIAL_FLIP_STATE, applyFlipToggle, canGradeNow, ratingForDirection } from "../engine/grading";
import type { FlipLockState } from "../engine/grading";
import { WORD_BY_ID } from "../state/service";
import { voiceAvailable, speak, subscribeVoices } from "../state/tts";
import { NATIVE_LANG_NAME, useT } from "../i18n/i18n";
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

const FLICK_LOCK_MS = 1500; // post-flip freeze (anti-gate-skip, LINGO-007)
const THRESHOLD = 90; // px before a drag counts as a flick

/**
 * One flashcard: front = EN prompt (EN gloss for kind='word'), tap flips to the
 * RU back (+ kana / JA). Flick right = Good, left = Again, down = Hard. Rating is
 * blocked until the card is flipped AND ~1.5s has passed since the flip (the two
 * gate-skip guards). `key`ed by card id upstream so state resets per card.
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
  const t = useT();
  // LINGO-019: flipped + "has the reveal-lock timer ever armed" live together
  // as one FlipLockState, advanced only via the pure applyFlipToggle() (see
  // engine/grading.ts) — tap flips either direction, any number of times, but
  // the timer arms at most once per card (toggling back to the front must
  // NOT re-lock canEval once it's unlocked).
  const [flipState, setFlipState] = useState<FlipLockState>(INITIAL_FLIP_STATE);
  const flipped = flipState.flipped;
  const [canEval, setCanEval] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [hasVoice, setHasVoice] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Timer id only — its lifecycle is unmount-only (see the cleanup effect
  // below), deliberately NOT tied to `flipped` churn from re-flipping.
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // LINGO-012: word-by-word breakdown (原形・品詞・体と対・訳) for the back face.
  const breakdown = useMemo(() => buildWordBreakdown(sentence, WORD_BY_ID), [sentence]);

  // Unmount-only cleanup for the one-shot unlock timer — see lockTimerRef.
  useEffect(() => {
    return () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
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
    const { next, shouldArmLock, shouldSpeak } = applyFlipToggle(flipState);
    setFlipState(next);
    if (shouldArmLock) lockTimerRef.current = setTimeout(() => setCanEval(true), FLICK_LOCK_MS);
    if (shouldSpeak) speakBack();
  }

  const dir = directionOf(drag.x, drag.y, 28); // visual hint threshold
  const canFlick = canGradeNow(flipped, canEval);

  // LINGO-019: the single rating entry point — both the flick release below
  // and each tap-to-grade legend button call this, so there is exactly one
  // code path from "learner decided" to onRate() (undo, Again requeueing,
  // FSRS all live downstream of onRate and never know which input method fired).
  // Gate + direction->Rating mapping both delegate to engine/grading.ts so
  // they're covered by grading.test.ts (no DOM/component test setup here).
  function rate(d: Exclude<Dir, null>) {
    if (!canFlick) return;
    onRate(ratingForDirection(d));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    if (flipped) setDrag({ x: 0, y: 0, active: true });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current || !flipped) return;
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
    // times (a drag on the front face still does nothing — front never rates).
    if (moved < 12) {
      toggleFlip();
      return;
    }
    if (!flipped) return;
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
            {!flipped && <div className="hint">{t("card.tapToFlip")}</div>}
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
            {sentence.kana && <div className="kana">{sentence.kana}</div>}
            {/* The back also shows the ja-field translation as a bonus reference
                line (Katsuta reads Japanese natively) — skipped when it would
                duplicate either the front prompt or the back target text
                itself (frontLang/targetLang already ja). */}
            {frontLang !== "ja" && targetLangTyped !== "ja" && sentence.ja && (
              <div className="ja">{sentence.ja}</div>
            )}
            {sentence.note && <div className="note">{sentence.note}</div>}
            {breakdown.length > 0 && <WordBreakdownList entries={breakdown} frontLang={frontLang} />}
            {showOverlay && (
              <div className="overlay-label" style={{ color: overlayColor, opacity: 1 }}>
                {overlayText}
              </div>
            )}
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
 * the back's gloss follows the front/prompt language), then fall back to the
 * others (English last-resort). */
function orderedGloss(w: WordBreakdownEntry, frontLang: Lang): string {
  const order: (string | null | undefined)[] =
    frontLang === "ja"
      ? [w.jaGloss, w.enGloss, w.ruGloss]
      : frontLang === "ru"
        ? [w.ruGloss, w.enGloss, w.jaGloss]
        : [w.enGloss, w.jaGloss, w.ruGloss];
  return order.filter(Boolean).join(" / ");
}

function WordBreakdownList({
  entries,
  frontLang,
}: {
  entries: WordBreakdownEntry[];
  frontLang: Lang;
}) {
  const t = useT();
  // Structural labels (part of speech, verb aspect) follow the UI language, not
  // the front language: for the existing RU user (UI=ja, front=en) they stay
  // Japanese, so nothing regresses; other UI languages get their own.
  const aspectLabels = { pf: t("aspect.pf"), impf: t("aspect.impf"), pair: t("aspect.pairOf") };
  return (
    <div className="word-breakdown" onPointerDown={(e) => e.stopPropagation()}>
      {entries.map((w) => {
        const aspectLine = formatAspectLine(w, aspectLabels);
        const gloss = orderedGloss(w, frontLang);
        const posKey = "pos." + w.pos;
        const posText = t(posKey);
        return (
          <div key={w.lemma} className={"wb-row" + (w.isTarget ? " target" : "")}>
            <div className="wb-head">
              <span className="wb-lemma">{w.lemma}</span>
              <span className="wb-pos">{posText === posKey ? w.posLabel : posText}</span>
            </div>
            {aspectLine && <div className="wb-aspect">{aspectLine}</div>}
            {gloss && <div className="wb-gloss">{gloss}</div>}
          </div>
        );
      })}
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
