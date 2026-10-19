import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { explainChunkUrls, loadExplain, peekExplain, resetExplainCache } from "./explain";

const WORDS = { продать: { lemma: "продать" } };
const SENTENCES = { T0164: { id: "T0164" } };

function mockFetch(impl: (url: string) => Promise<Response> | Response) {
  const fn = vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input))));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => resetExplainCache());
afterEach(() => vi.unstubAllGlobals());

describe("explainChunkUrls", () => {
  it("resolves the two chunks for a course/language that ships data", () => {
    expect(explainChunkUrls("ru", "ja")).toEqual({
      words: "/explain/explain.word.ru.ja.json",
      sentences: "/explain/explain.sentence.ru.ja.json",
    });
    expect(explainChunkUrls("ru", "en")?.words).toBe("/explain/explain.word.ru.en.json");
  });

  it("returns null for courses with no explanations — the button must not appear", () => {
    expect(explainChunkUrls("en", "ja")).toBeNull();
    expect(explainChunkUrls("th", "ja")).toBeNull();
    expect(explainChunkUrls("ja", "en")).toBeNull();
  });

  it("returns null for a UI language the chunks were not generated in", () => {
    // A Russian-speaking learner of Russian is not a case the data covers.
    expect(explainChunkUrls("ru", "ru")).toBeNull();
  });
});

describe("loadExplain", () => {
  it("fetches both chunks and caches them in memory", async () => {
    const fetchMock = mockFetch((url) => ok(url.includes("word") ? WORDS : SENTENCES));

    const first = await loadExplain("ru", "ja");
    expect(first?.words).toEqual(WORDS);
    expect(first?.sentences).toEqual(SENTENCES);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second open of the session: no network at all.
    const second = await loadExplain("ru", "ja");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent taps into one pair of requests", async () => {
    const fetchMock = mockFetch((url) => ok(url.includes("word") ? WORDS : SENTENCES));
    const [a, b] = await Promise.all([loadExplain("ru", "ja"), loadExplain("ru", "ja")]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves null without touching the network for a course with no data", async () => {
    const fetchMock = mockFetch(() => ok({}));
    expect(await loadExplain("en", "ja")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when offline, and caches nothing — so a retry really retries", async () => {
    const fetchMock = mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(loadExplain("ru", "ja")).rejects.toThrow();
    expect(peekExplain("ru", "ja")).toBeNull();

    // Back online: the same call now succeeds rather than returning a cached failure.
    vi.unstubAllGlobals();
    mockFetch((url) => ok(url.includes("word") ? WORDS : SENTENCES));
    expect((await loadExplain("ru", "ja"))?.words).toEqual(WORDS);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("treats a non-200 (e.g. a chunk missing from the deploy) as a failure, not as empty data", async () => {
    mockFetch((url) =>
      url.includes("word") ? ok(WORDS) : new Response("not found", { status: 404 }),
    );
    await expect(loadExplain("ru", "ja")).rejects.toThrow();
    expect(peekExplain("ru", "ja")).toBeNull();
  });
});

describe("peekExplain", () => {
  it("is null until a load has completed, then returns the cached data", async () => {
    mockFetch((url) => ok(url.includes("word") ? WORDS : SENTENCES));
    expect(peekExplain("ru", "ja")).toBeNull();
    await loadExplain("ru", "ja");
    expect(peekExplain("ru", "ja")?.sentences).toEqual(SENTENCES);
  });
});

// LINGO-057 follow-up (Katsuta, 2026-10-19): the chunk is chosen by the
// card-FRONT language, not the UI language. He runs UI=ja with front=en — he
// learns Russian through English — and got Japanese explanations for words he
// had learned in English. These pin his exact configuration.
describe("chunk selection follows the FRONT language, not the UI language", () => {
  it("Katsuta's setup (UI=ja, front=en) loads the EN chunks", () => {
    // The selector takes the front language; passing "en" must yield en files
    // even though his interface is Japanese.
    expect(explainChunkUrls("ru", "en")).toEqual({
      words: "/explain/explain.word.ru.en.json",
      sentences: "/explain/explain.sentence.ru.en.json",
    });
  });

  it("a ja-front learner still gets the JA chunks", () => {
    expect(explainChunkUrls("ru", "ja")?.sentences).toBe("/explain/explain.sentence.ru.ja.json");
  });

  it("the two front languages never resolve to the same file", () => {
    expect(explainChunkUrls("ru", "en")?.words).not.toBe(explainChunkUrls("ru", "ja")?.words);
  });
});
