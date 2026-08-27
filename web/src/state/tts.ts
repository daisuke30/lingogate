// Read-aloud via the Web Speech API (no external dependency). LINGO-014: voice
// resolution is generalised over the course's target language (ru → ru-RU, en →
// en-US, …) instead of being hard-wired to Russian. Voice availability is
// device-dependent: iOS ships "Milena" (ru-RU); many desktops have a generic
// per-language voice; some devices have none — in that case the UI hides the
// speaker affordance entirely (voiceAvailable(lang) === false).
//
// iOS gotcha: speechSynthesis.speak() only actually produces sound when the call
// originates from a user gesture. Callers therefore invoke speak() from the
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

/** Preferred default region + voice name hint per target language. */
const LANG_DEFAULTS: Record<string, { locale: string; prefer?: RegExp }> = {
  ru: { locale: "ru-RU", prefer: /milena/i },
  en: { locale: "en-US" },
  ja: { locale: "ja-JP", prefer: /kyoko|o-ren/i },
};

/** Best voice for `lang`: a preferred named voice (e.g. Milena for ru) first,
 * then an exact locale (ru-RU) match, then any voice whose lang starts with the
 * 2-letter code. */
export function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const v = voices();
  const code = lang.toLowerCase();
  const def = LANG_DEFAULTS[code];
  return (
    (def?.prefer ? v.find((x) => def.prefer!.test(x.name)) : undefined) ??
    (def ? v.find((x) => x.lang?.toLowerCase() === def.locale.toLowerCase()) : undefined) ??
    v.find((x) => x.lang?.toLowerCase().startsWith(code)) ??
    null
  );
}

export function voiceAvailable(lang: string): boolean {
  return pickVoice(lang) != null;
}

/** Speak `text` in `lang` at `rate` (1.0 normal). No-op if unsupported / no voice. */
export function speak(text: string, lang: string, rate = 1.0): void {
  if (!ttsSupported()) return;
  const voice = pickVoice(lang);
  if (!voice) return;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang || LANG_DEFAULTS[lang.toLowerCase()]?.locale || lang;
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
