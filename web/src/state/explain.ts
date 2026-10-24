// LINGO-057 — lazy loading for the explanation chunks.
//
// The chunks are big: per UI language the word dictionary is ~2MB raw (~0.4MB
// gzipped) and the sentence commentary ~1.1MB (~0.2MB). That is far too much
// to put in the initial bundle for a feature behind a button most sessions
// never press, so they live in public/explain/ as plain static files, are
// fetched on the FIRST tap only, and are then held in memory for the rest of
// the session.
//
// They are deliberately NOT in the service worker's precache list
// (public/sw.js PRECACHE): precaching would move ~0.6MB of download onto every
// install, including for the learners who never open an explanation and for
// the three courses that have no explanations at all. The SW's ordinary
// runtime cache still keeps a copy after the first successful fetch, so a
// learner who has used the feature once keeps it offline — the cost just
// follows the use instead of preceding it.

import type { SentenceCommentary, WordDict } from "../engine/explain";

/** Courses that ship explanation data. RU only today (LINGO-056 scope). */
const EXPLAIN_COURSES = new Set(["ru"]);

/** UI languages the chunks are generated in. */
const EXPLAIN_LANGS = new Set(["ja", "en"]);

export interface ExplainData {
  words: WordDict;
  sentences: SentenceCommentary;
}

export type ExplainLoadState =
  | { status: "unavailable" } // this course/language ships no explanations
  | { status: "loading" }
  | { status: "ready"; data: ExplainData }
  | { status: "offline" }; // fetch failed and we are offline — retryable

/** Resolved chunk URLs for a (course, language) pair, or null when that pair
 * has no data. Exported for the test suite and for the audit script. */
export function explainChunkUrls(
  courseId: string,
  lang: string,
): { words: string; sentences: string } | null {
  if (!EXPLAIN_COURSES.has(courseId)) return null;
  // The chunks exist in ja and en. A ru-UI learner of Russian is not a case
  // the data covers (they would be reading explanations of their own
  // language), so there is nothing sensible to fall back to.
  if (!EXPLAIN_LANGS.has(lang)) return null;
  return {
    words: `/explain/explain.word.${courseId}.${lang}.json`,
    sentences: `/explain/explain.sentence.${courseId}.${lang}.json`,
  };
}

/** LINGO-062: the two halves are cached and fetched SEPARATELY.
 *
 * v2 tripled the data — each chunk is now ~0.9MB gzipped, so mixed mode would
 * pull ~3.6MB before showing anything, and a cold open measured 4-11s on a
 * real connection. The sentence commentary is what the top of the sheet needs
 * and it is half the bytes; the word dictionary fills in the section below.
 * Splitting them lets the sheet open on the sentence while the dictionary is
 * still arriving, instead of making the learner wait for all four files.
 */
export type ExplainPart = "words" | "sentences";

const partCache = new Map<string, unknown>();
const partInFlight = new Map<string, Promise<unknown>>();

function partKey(courseId: string, lang: string, part: ExplainPart) {
  return `${courseId}.${lang}.${part}`;
}

/** Fetch one half for one language. Cached for the session. */
export async function loadExplainPart<T>(
  courseId: string,
  lang: string,
  part: ExplainPart,
): Promise<T | null> {
  const urls = explainChunkUrls(courseId, lang);
  if (!urls) return null;
  const key = partKey(courseId, lang, part);

  const cached = partCache.get(key);
  if (cached) return cached as T;
  const existing = partInFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetch(part === "words" ? urls.words : urls.sentences)
    .then((r) => {
      if (!r.ok) throw new Error(`explain ${part} ${r.status}`);
      return r.json();
    })
    .then((json) => {
      partCache.set(key, json);
      return json;
    })
    .finally(() => {
      partInFlight.delete(key);
    });

  partInFlight.set(key, promise);
  return promise as Promise<T>;
}

/** Already in memory? */
export function peekExplainPart<T>(
  courseId: string,
  lang: string,
  part: ExplainPart,
): T | null {
  return (partCache.get(partKey(courseId, lang, part)) as T) ?? null;
}

const cache = new Map<string, ExplainData>();
const inFlight = new Map<string, Promise<ExplainData | null>>();

/** Already in memory? Lets the UI skip the loading state entirely on the
 * second and later taps of a session. */
export function peekExplain(courseId: string, lang: string): ExplainData | null {
  return cache.get(`${courseId}.${lang}`) ?? null;
}

/** Does this course/language pair ship explanation chunks? */
export function explainLangAvailable(courseId: string, lang: string): boolean {
  return explainChunkUrls(courseId, lang) !== null;
}

/**
 * LINGO-062: load every chunk the sheet needs, in parallel.
 *
 * In mixed mode that is two languages (~0.6MB gzipped each). They are fetched
 * together rather than in sequence so the extra language costs latency only
 * to the extent the connection is actually saturated — on any normal link the
 * second request overlaps the first almost entirely.
 */
export async function loadExplainLangs(
  courseId: string,
  langs: string[],
): Promise<Record<string, ExplainData | null>> {
  const unique = [...new Set(langs)];
  const loaded = await Promise.all(unique.map((l) => loadExplain(courseId, l)));
  return Object.fromEntries(unique.map((l, i) => [l, loaded[i]]));
}

/**
 * Fetch (or return the cached) explanation data. Resolves null when this
 * course/language has no chunks; rejects only on a genuine network failure,
 * which the caller renders as the retryable "offline" state rather than an
 * error — the rest of the app works offline and this one feature quietly
 * saying "needs a connection" is the honest version of that.
 */
export async function loadExplain(courseId: string, lang: string): Promise<ExplainData | null> {
  const key = `${courseId}.${lang}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const urls = explainChunkUrls(courseId, lang);
  if (!urls) return null;

  // Coalesce concurrent taps onto one pair of requests.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const [words, sentences] = await Promise.all([
      fetch(urls.words).then((r) => {
        if (!r.ok) throw new Error(`explain words ${r.status}`);
        return r.json() as Promise<WordDict>;
      }),
      fetch(urls.sentences).then((r) => {
        if (!r.ok) throw new Error(`explain sentences ${r.status}`);
        return r.json() as Promise<SentenceCommentary>;
      }),
    ]);
    const data: ExplainData = { words, sentences };
    cache.set(key, data);
    return data;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/** Test seam: drop the memory cache. */
export function resetExplainCache(): void {
  cache.clear();
  inFlight.clear();
  partCache.clear();
  partInFlight.clear();
}
