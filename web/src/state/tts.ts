// Russian read-aloud via the Web Speech API (no external dependency). Voice
// availability is device-dependent: iOS ships "Milena" (ru-RU); many desktops
// have a generic ru-RU voice; some devices have none — in that case the UI hides
// the speaker affordance entirely (ruVoiceAvailable() === false).
//
// iOS gotcha: speechSynthesis.speak() only actually produces sound when the call
// originates from a user gesture. Callers therefore invoke speakRu() from the
// card-flip tap (a real pointer event), never from an effect on mount.

let cached: SpeechSynthesisVoice[] = [];

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function voices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) cached = v;
  return cached;
}

/** Best Russian voice: Milena (iOS) first, then an exact ru-RU, then any ru*. */
export function pickRuVoice(): SpeechSynthesisVoice | null {
  const v = voices();
  return (
    v.find((x) => /milena/i.test(x.name)) ??
    v.find((x) => x.lang?.toLowerCase() === "ru-ru") ??
    v.find((x) => x.lang?.toLowerCase().startsWith("ru")) ??
    null
  );
}

export function ruVoiceAvailable(): boolean {
  return pickRuVoice() != null;
}

/** Speak `text` in Russian at `rate` (1.0 normal). No-op if unsupported / no voice. */
export function speakRu(text: string, rate = 1.0): void {
  if (!ttsSupported()) return;
  const voice = pickRuVoice();
  if (!voice) return;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang || "ru-RU";
  u.rate = rate;
  window.speechSynthesis.cancel(); // drop any in-flight utterance first
  window.speechSynthesis.speak(u);
}

/** Subscribe to the async voice list becoming ready (voices often load lazily on
 * the first getVoices() call). Fires once voices are available. Returns an
 * unsubscribe. */
export function subscribeVoices(cb: () => void): () => void {
  if (!ttsSupported()) return () => {};
  if (voices().length) cb();
  const handler = () => {
    voices();
    cb();
  };
  window.speechSynthesis.addEventListener("voiceschanged", handler);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
}
