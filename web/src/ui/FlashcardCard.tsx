import { useEffect, useRef, useState } from "react";
import { Rating } from "../engine/fsrs";
import type { Sentence } from "../engine/content";

type Dir = "again" | "hard" | "good" | null;

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
}: {
  sentence: Sentence;
  onRate: (r: Rating) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [canEval, setCanEval] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const start = useRef<{ x: number; y: number } | null>(null);

  // Arm evaluation 1.5s after the flip (per card — component remounts by key).
  useEffect(() => {
    if (!flipped) return;
    setCanEval(false);
    const t = setTimeout(() => setCanEval(true), FLICK_LOCK_MS);
    return () => clearTimeout(t);
  }, [flipped]);

  const dir = directionOf(drag.x, drag.y, 28); // visual hint threshold
  const canFlick = flipped && canEval;

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

    if (!flipped) {
      if (moved < 12) setFlipped(true); // a tap flips
      return;
    }
    const d = directionOf(dx, dy, THRESHOLD); // commit threshold
    setDrag({ x: 0, y: 0, active: false });
    if (canFlick && d) {
      onRate(d === "again" ? Rating.Again : d === "hard" ? Rating.Hard : Rating.Good);
    }
  }

  // Compose flip rotation + live drag translate/rotate.
  const rot = flipped ? 180 : 0;
  const tx = drag.active ? drag.x : 0;
  const ty = drag.active ? Math.max(0, drag.y) : 0;
  const tilt = drag.active ? drag.x / 22 : 0;
  const transform = `translate(${tx}px, ${ty}px) rotateZ(${tilt}deg) rotateY(${rot}deg)`;

  const overlayColor =
    dir === "good" ? "var(--good)" : dir === "again" ? "var(--again)" : "var(--hard)";
  const overlayText = dir === "good" ? "覚えた" : dir === "again" ? "忘れた" : "曖昧";
  const showOverlay = drag.active && !!dir;

  const front = sentence.en;

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
            <span className="kicker">{sentence.kind === "word" ? "English" : "English"}</span>
            <div className="prompt">{front}</div>
            {!flipped && <div className="hint">タップして答えを見る</div>}
          </div>
          <div className="face back">
            <span className="kicker">Русский</span>
            <div className="ru">{sentence.ru}</div>
            {sentence.kana && <div className="kana">{sentence.kana}</div>}
            {sentence.ja && <div className="ja">{sentence.ja}</div>}
            {sentence.note && <div className="note">{sentence.note}</div>}
            {showOverlay && (
              <div className="overlay-label" style={{ color: overlayColor, opacity: 1 }}>
                {overlayText}
              </div>
            )}
            {!canEval && <div className="hint">…</div>}
          </div>
        </div>
      </div>

      <div className={"legend" + (canFlick ? "" : " locked")}>
        <div className={"chip again" + (dir === "again" ? " hot" : "")}>
          忘れた<span className="dir">← 左</span>
        </div>
        <div className={"chip hard" + (dir === "hard" ? " hot" : "")}>
          曖昧<span className="dir">↓ 下</span>
        </div>
        <div className={"chip good" + (dir === "good" ? " hot" : "")}>
          覚えた<span className="dir">→ 右</span>
        </div>
      </div>
    </>
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
