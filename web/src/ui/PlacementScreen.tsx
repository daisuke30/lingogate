import { useCallback, useEffect, useRef, useState } from "react";
import {
  adaptiveTargetRanks,
  block1TargetRanks,
  estimatedMasteredCount,
  fitPlacement,
  isBeginnerAfterBlock1,
  selectWordsForRanks,
  MAX_QUESTIONS,
} from "../engine/placement";
import type { PlacementFit, PlacementResponse, RankedWord } from "../engine/placement";
import { finalizeAndPersistPlacement, loadPlacementContext, targetSentenceByLemma } from "../state/placement";
import type { PlacementContext } from "../state/placement";
import { masteryLevelThreshold } from "../engine/mastery";
import type { DeckWord, Sentence } from "../engine/content";
import { voiceAvailable, speak, subscribeVoices } from "../state/tts";
import { NATIVE_LANG_NAME, useT } from "../i18n/i18n";
import type { Lang } from "../i18n/i18n";

type Phase = "loading" | "block" | "interstitial" | "finalizing" | "done" | "beginner";

/** A sentence's text in a given language field — same mapping FlashcardCard /
 * the (now-retired) CalibrationScreen use; duplicated here in miniature
 * rather than imported to keep this screen's dependency footprint small (it's
 * a 3-line pure function, not worth a shared module for). */
function sentenceLangText(s: Sentence, lang: Lang): string {
  if (lang === "ja") return s.ja ?? s.en;
  if (lang === "ru") return s.ru;
  return s.en;
}

/** LINGO-018: the word's own dictionary gloss ("意味"), ordered by front
 * language with an English fallback — same front-language-first convention
 * FlashcardCard's word-breakdown gloss uses. This is the reveal's PRIMARY
 * line; the target-language example sentence is a separate, clearly-labelled
 * secondary line (see PlacementCard) — previously the example sentence was
 * shown alone with no meaning at all, reading as if the sentence itself were
 * the word's definition. */
function wordMeaning(word: DeckWord | undefined, frontLang: Lang): string | null {
  if (!word) return null;
  const order =
    frontLang === "ja"
      ? [word.jaGloss, word.enGloss, word.ruGloss]
      : frontLang === "ru"
        ? [word.ruGloss, word.enGloss, word.jaGloss]
        : [word.enGloss, word.jaGloss, word.ruGloss];
  return order.find((g): g is string => !!g) ?? null;
}

function levelLabel(t: (k: string, p?: Record<string, string | number>) => string, masteredCount: number): string {
  const threshold = masteryLevelThreshold(masteredCount);
  return threshold == null
    ? t("mastery.level.beginner")
    : t("mastery.level.words", { n: threshold.toLocaleString() });
}

/**
 * Adaptive placement test (LINGO-016): 10-question blocks, up to 4
 * (MAX_QUESTIONS=40 soft cap). After block 1, 0–1 known ends the test
 * immediately (complete-beginner short circuit); otherwise every block ends
 * with an interstitial showing the current estimate and a free choice to
 * continue (more precision) or stop here. Reuses the same right=know/
 * left=don't-know swipe card as the retired linear CalibrationScreen.
 */
export function PlacementScreen({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("loading");
  const [ctx, setCtx] = useState<PlacementContext | null>(null);
  const [blockWords, setBlockWords] = useState<RankedWord[]>([]);
  const [blockIndex, setBlockIndex] = useState(0);
  const [idxInBlock, setIdxInBlock] = useState(0);
  const [fit, setFit] = useState<PlacementFit | null>(null);
  const [hasVoice, setHasVoice] = useState(false);

  const responsesRef = useRef<PlacementResponse[]>([]);
  const usedLemmasRef = useRef<Set<string>>(new Set());
  const glossRef = useRef<Map<string, Sentence>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => () => void (mountedRef.current = false), []);

  useEffect(() => {
    (async () => {
      const context = await loadPlacementContext();
      if (!mountedRef.current) return;
      glossRef.current = targetSentenceByLemma();
      setCtx(context);
      setHasVoice(voiceAvailable(context.targetLang));
      const ranks = block1TargetRanks(context.maxRank);
      const words = selectWordsForRanks(context.words, ranks, usedLemmasRef.current);
      for (const w of words) usedLemmasRef.current.add(w.lemma);
      setBlockWords(words);
      setBlockIndex(0);
      setIdxInBlock(0);
      setPhase(words.length === 0 ? "done" : "block"); // empty deck guard
    })();
    const unsub = subscribeVoices(() => {
      if (mountedRef.current && ctx) setHasVoice(voiceAvailable(ctx.targetLang));
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalize = useCallback(
    async (finalFit: PlacementFit) => {
      setPhase("finalizing");
      await finalizeAndPersistPlacement(finalFit, responsesRef.current);
      if (!mountedRef.current) return;
      setPhase("done");
    },
    [],
  );

  const startNextBlock = useCallback(
    (newFit: PlacementFit) => {
      if (!ctx) return;
      const ranks = adaptiveTargetRanks(newFit, { maxRank: ctx.maxRank });
      const words = selectWordsForRanks(ctx.words, ranks, usedLemmasRef.current);
      if (words.length === 0) {
        void finalize(newFit); // word pool exhausted — nothing left to ask
        return;
      }
      for (const w of words) usedLemmasRef.current.add(w.lemma);
      setBlockWords(words);
      setBlockIndex((i) => i + 1);
      setIdxInBlock(0);
      setPhase("block");
    },
    [ctx, finalize],
  );

  const judge = useCallback(
    (word: RankedWord, known: boolean) => {
      responsesRef.current.push({ lemma: word.lemma, rank: word.rank, known });
      const nextIdx = idxInBlock + 1;
      if (nextIdx < blockWords.length) {
        setIdxInBlock(nextIdx);
        return;
      }

      // Block complete: refit on the accumulated responses so far.
      const all = responsesRef.current;
      const newFit = fitPlacement(all, ctx?.maxRank ?? 3000);
      setFit(newFit);

      if (blockIndex === 0 && isBeginnerAfterBlock1(all)) {
        setPhase("beginner");
        return;
      }
      if (all.length >= MAX_QUESTIONS) {
        void finalize(newFit);
        return;
      }
      setPhase("interstitial");
    },
    [blockIndex, blockWords.length, ctx, finalize, idxInBlock],
  );

  const speakWord = useCallback(
    (word: RankedWord) => {
      if (!ctx || !ctx.tts.enabled) return;
      speak(word.lemma, ctx.targetLang, ctx.tts.rate);
    },
    [ctx],
  );

  if (phase === "loading" || phase === "finalizing" || !ctx) {
    return (
      <div className="app">
        <div className="center-screen">
          <p className="muted">{phase === "finalizing" ? t("placement.finalizing") : t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (phase === "beginner") {
    return (
      <div className="app">
        <div className="center-screen">
          <div className="big-emoji">🌱</div>
          <h1>{t("placement.beginner.title")}</h1>
          <p>{t("placement.beginner.desc")}</p>
          <button
            className="btn primary block"
            style={{ width: "100%", marginTop: 22 }}
            onClick={() => void finalize(fit!)}
          >
            {t("placement.result.startLearning")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "interstitial" && fit) {
    const n = estimatedMasteredCount(fit);
    const err = Math.round(fit.ciHalfWidthWords);
    return (
      <div className="app">
        <div className="center-screen">
          <div className="big-emoji">📊</div>
          <h1>{t("placement.block.estimateTitle")}</h1>
          <p>{t("placement.block.estimateLine", { n: n.toLocaleString(), err: err.toLocaleString() })}</p>
          <p className="muted">{levelLabel(t, n)}</p>
          <div className="stack" style={{ width: "100%" }}>
            <button className="btn primary block" onClick={() => startNextBlock(fit)}>
              {t("placement.block.continue")}
            </button>
            <button className="btn ghost block" onClick={() => void finalize(fit)}>
              {t("placement.block.finish")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const n = fit ? estimatedMasteredCount(fit) : 0;
    return (
      <div className="app">
        <div className="center-screen">
          <div className="big-emoji">🏁</div>
          <h1>{t("placement.result.title")}</h1>
          <p>{t("placement.result.summary", { n: n.toLocaleString(), level: levelLabel(t, n) })}</p>
          <button className="btn primary block" style={{ width: "100%", marginTop: 22 }} onClick={onExit}>
            {t("placement.result.startLearning")}
          </button>
        </div>
      </div>
    );
  }

  // phase === "block"
  const word = blockWords[idxInBlock];
  const gloss = glossRef.current.get(word.lemma) ?? null;
  const deckWord = ctx.wordByLemma.get(word.lemma);

  return (
    <div className="app">
      <div className="quiz">
        <div className="quiz-head">
          <button className="iconbtn" onClick={onExit} aria-label={t("calib.exit")}>
            ✕
          </button>
          <div className="qbar">
            <div className="fill" style={{ width: `${((idxInBlock + 1) / blockWords.length) * 100}%` }} />
          </div>
          <span className="pill">{t("placement.blockLabel", { n: blockIndex + 1 })}</span>
        </div>

        <PlacementCard
          key={word.lemma}
          word={word}
          meaning={wordMeaning(deckWord, ctx.frontLang)}
          gloss={gloss}
          hasVoice={hasVoice}
          targetLang={ctx.targetLang}
          onSpeak={() => speakWord(word)}
          onJudge={(known) => judge(word, known)}
        />

        {/* LINGO-019: same tap-to-grade treatment as FlashcardCard's legend —
            these chips double as the legend and the buttons, calling the
            exact same judge() the swipe gesture uses. No canEvaluate-style
            gate here: unlike the quiz's anti-gate-skip lock (LINGO-007),
            placement isn't guarding a gate, so there's nothing to debounce. */}
        <div className="legend two">
          <button type="button" className="chip again" onClick={() => judge(word, false)}>
            {t("calib.legend.unknown")}
            <span className="dir">{t("card.dir.left")}</span>
          </button>
          <button type="button" className="chip good" onClick={() => judge(word, true)}>
            {t("calib.legend.known")}
            <span className="dir">{t("card.dir.right")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const THRESHOLD = 90;

function PlacementCard({
  word,
  meaning,
  gloss,
  hasVoice,
  targetLang,
  onSpeak,
  onJudge,
}: {
  word: RankedWord;
  /** The word's own dictionary gloss ("意味"), front-language-ordered — see
   * wordMeaning() above. Independent of `gloss` (the example sentence) so a
   * band2/3 word with no example sentence can still reveal its meaning. */
  meaning: string | null;
  gloss: Sentence | null;
  hasVoice: boolean;
  targetLang: Lang;
  onSpeak: () => void;
  onJudge: (known: boolean) => void;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [drag, setDrag] = useState({ x: 0, active: false });
  const start = useRef<{ x: number; y: number } | null>(null);
  const hasReveal = !!meaning || !!gloss;

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, active: true });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, active: true });
  }
  function onPointerUp(e: React.PointerEvent) {
    const s = start.current;
    start.current = null;
    setDrag({ x: 0, active: false });
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      onJudge(dx > 0); // right = known
    } else if (Math.hypot(dx, dy) < 12 && hasReveal) {
      setRevealed(true); // a tap reveals meaning + example
    }
  }

  const hint = drag.active && Math.abs(drag.x) >= THRESHOLD ? (drag.x > 0 ? "good" : "again") : null;
  const tx = drag.active ? drag.x : 0;
  const tilt = drag.active ? drag.x / 22 : 0;
  // LINGO-018: the example sentence is ONLY ever the target-language text,
  // clearly labelled "例:" — no bare parenthetical, no unlabelled second
  // sentence guessing at translation (the old reveal showed the target
  // sentence as if it were the word's meaning, with no meaning line at all).
  const exampleText = gloss ? sentenceLangText(gloss, targetLang) : null;

  return (
    <div className="card-stage">
      <div
        className="flashcard calib"
        style={{
          transform: `translateX(${tx}px) rotateZ(${tilt}deg)`,
          transition: drag.active ? "none" : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDrag({ x: 0, active: false });
        }}
      >
        <div className="face front" style={{ position: "relative" }}>
          <span className="kicker">{NATIVE_LANG_NAME[targetLang]}</span>
          {hasVoice && (
            <button
              className="iconbtn speaker"
              aria-label={t("card.speak")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSpeak();
              }}
            >
              🔊
            </button>
          )}
          {/* LINGO-018: front face is the word alone — nothing else ever
              renders here, so an example sentence can never visually mix in. */}
          <div className="ru">{word.lemma}</div>
          {revealed && hasReveal ? (
            <div className="calib-gloss">
              {meaning && <div className="g-ru">{meaning}</div>}
              {exampleText && (
                <div className="ja">
                  {t("placement.card.example")} {exampleText}
                </div>
              )}
            </div>
          ) : (
            hasReveal && <div className="hint">{t("calib.tapMeaning")}</div>
          )}
          {hint && (
            <div
              className="overlay-label"
              style={{ color: hint === "good" ? "var(--good)" : "var(--again)", opacity: 1 }}
            >
              {hint === "good" ? t("calib.overlay.known") : t("calib.overlay.unknown")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
