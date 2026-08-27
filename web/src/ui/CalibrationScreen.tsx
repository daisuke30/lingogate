import { useCallback, useEffect, useRef, useState } from "react";
import {
  nextCalibrationBatch,
  submitCalibration,
  targetSentenceByLemma,
} from "../state/calibration";
import type { CalibrationBatch } from "../state/calibration";
import type { DeckWord, Sentence } from "../engine/content";
import { activeCourse } from "../state/service";
import { resolveCourse } from "../content/courses";
import { getTtsSettings } from "../state/settings";
import { voiceAvailable, speak, subscribeVoices } from "../state/tts";
import { NATIVE_LANG_NAME, useT } from "../i18n/i18n";

type Phase = "loading" | "run" | "done";

/**
 * Calibration: fast known/unknown triage of band1's 1000 words (50 per batch,
 * frequency order). Front = the RU word; an optional tap reveals a meaning hint
 * (an example sentence). Flick right = 知っている, left = 知らない — no reveal
 * required (recognising it at a glance IS the "known" signal). Judgements seed
 * FSRS state for known words and are persisted per swipe.
 */
export function CalibrationScreen({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("loading");
  const [batch, setBatch] = useState<CalibrationBatch | null>(null);
  const [idx, setIdx] = useState(0);
  const [known, setKnown] = useState(0);
  const [unknown, setUnknown] = useState(0);
  const ttsRef = useRef({ enabled: true, rate: 1.0 });
  const [hasVoice, setHasVoice] = useState(false);
  const [targetLang, setTargetLang] = useState("ru");
  const glossRef = useRef<Map<string, Sentence>>(new Map());
  // Serialise persistence so overlapping read-modify-write seeds don't race.
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    (async () => {
      // nextCalibrationBatch() ensures the active course first, so activeCourse()
      // and the gloss map below reflect the right course.
      const [b, tts] = await Promise.all([nextCalibrationBatch(), getTtsSettings()]);
      if (!alive) return;
      glossRef.current = targetSentenceByLemma();
      const lang = resolveCourse(activeCourse()).targetLang;
      setTargetLang(lang);
      setHasVoice(voiceAvailable(lang));
      ttsRef.current = tts;
      setBatch(b);
      setPhase(b.words.length === 0 ? "done" : "run");
    })();
    const unsub = subscribeVoices(() => alive && setHasVoice(voiceAvailable(targetLang)));
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakWord = useCallback(
    (word: DeckWord) => {
      if (!ttsRef.current.enabled) return;
      speak(word.lemma, targetLang, ttsRef.current.rate);
    },
    [targetLang],
  );

  const loadNextBatch = useCallback(() => {
    setPhase("loading");
    nextCalibrationBatch().then((b) => {
      setKnown(0);
      setUnknown(0);
      setIdx(0);
      setBatch(b);
      setPhase(b.words.length === 0 ? "done" : "run");
    });
  }, []);

  const judge = useCallback(
    (word: DeckWord, isKnown: boolean) => {
      chain.current = chain.current.then(() => submitCalibration(word.lemma, isKnown));
      if (isKnown) setKnown((n) => n + 1);
      else setUnknown((n) => n + 1);
      setIdx((i) => {
        const next = i + 1;
        if (batch && next >= batch.words.length) setPhase("done");
        return next;
      });
    },
    [batch],
  );

  if (phase === "loading") {
    return (
      <div className="app">
        <div className="center-screen">
          <p className="muted">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const judgedNow = known + unknown;
    const baseJudged = batch ? batch.judged : 0;
    const total = batch ? batch.total : 1000;
    const totalJudged = baseJudged + judgedNow;
    const finished = totalJudged >= total;
    return (
      <div className="app">
        <div className="center-screen">
          <div className="big-emoji">{finished ? "🏁" : "✅"}</div>
          <h1>{finished ? t("calib.done.finished") : t("calib.done.judged", { n: judgedNow })}</h1>
          <p>{t("calib.done.knownUnknown", { k: known, u: unknown })}</p>
          <p className="muted">{t("calib.done.progress", { j: totalJudged, t: total })}</p>
          <div className="stack" style={{ width: "100%" }}>
            {!finished && (
              <button className="btn primary block" onClick={loadNextBatch}>
                {t("calib.done.next50")}
              </button>
            )}
            <button className={"btn block" + (finished ? " primary" : " ghost")} onClick={onExit}>
              {t("calib.done.home")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const words = batch!.words;
  const word = words[idx];
  const position = batch!.judged + idx + 1;
  const total = batch!.total;
  const gloss = glossRef.current.get(word.lemma) ?? null;

  return (
    <div className="app">
      <div className="quiz">
        <div className="quiz-head">
          <button className="iconbtn" onClick={onExit} aria-label={t("calib.exit")}>
            ✕
          </button>
          <div className="qbar">
            <div className="fill" style={{ width: `${(position / total) * 100}%` }} />
          </div>
          <span className="pill">
            {position}/{total}
          </span>
        </div>

        <CalibrationCard
          key={word.id}
          word={word}
          gloss={gloss}
          hasVoice={hasVoice}
          targetLang={targetLang}
          onSpeak={() => speakWord(word)}
          onJudge={(k) => judge(word, k)}
        />

        <div className="legend two">
          <div className="chip again">
            {t("calib.legend.unknown")}<span className="dir">{t("card.dir.left")}</span>
          </div>
          <div className="chip good">
            {t("calib.legend.known")}<span className="dir">{t("card.dir.right")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const THRESHOLD = 90;

function CalibrationCard({
  word,
  gloss,
  hasVoice,
  targetLang,
  onSpeak,
  onJudge,
}: {
  word: DeckWord;
  gloss: Sentence | null;
  hasVoice: boolean;
  targetLang: string;
  onSpeak: () => void;
  onJudge: (known: boolean) => void;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [drag, setDrag] = useState({ x: 0, active: false });
  const start = useRef<{ x: number; y: number } | null>(null);

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
    } else if (Math.hypot(dx, dy) < 12 && gloss) {
      setRevealed(true); // a tap reveals the meaning hint
    }
  }

  const hint = drag.active && Math.abs(drag.x) >= THRESHOLD ? (drag.x > 0 ? "good" : "again") : null;
  const tx = drag.active ? drag.x : 0;
  const tilt = drag.active ? drag.x / 22 : 0;

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
          <span className="kicker">{NATIVE_LANG_NAME[(targetLang as "ru" | "en" | "ja") ?? "ru"]}</span>
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
          <div className="ru">{word.lemma}</div>
          {revealed && gloss ? (
            <div className="calib-gloss">
              <div className="g-ru">{gloss.ru}</div>
              {gloss.ja && <div className="ja">{gloss.ja}</div>}
              {!gloss.ja && <div className="ja">{gloss.en}</div>}
            </div>
          ) : (
            gloss && <div className="hint">{t("calib.tapMeaning")}</div>
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
