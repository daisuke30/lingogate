// Build-time content compiler: pipeline JSONL -> a static deck JSON bundled into
// the app. Mirrors the relevant parts of pipeline/import.py (word/sentence
// import, lemma->word linking, band-from-filename) but emits JSON instead of a
// SQLite DB, since the web build has no runtime SQLite.
//
// Sources (globbed, like import.py:sentence_paths — the imported deck is picked
// up automatically when LINGO-009 produces it):
//   data/words_band*.jsonl
//   data/sentences_band*.jsonl
//   data/sentences_imported*.jsonl   (optional; band 1 by default)
//
// Exported `buildDeck(dataDir)` is unit-tested; the CLI at the bottom writes
// src/content/deck.generated.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA = join(HERE, "..", "..", "pipeline", "data");
const OUT = join(HERE, "..", "src", "content", "deck.generated.json");

const DECK = {
  code: "RU-from-EN",
  name: "Russian from English (frequency bands)",
  targetLang: "ru",
  sourceLang: "en",
};

function loadJsonl(path) {
  const rows = [];
  const text = readFileSync(path, "utf-8");
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    try {
      rows.push([i + 1, JSON.parse(line)]);
    } catch (e) {
      throw new Error(`${path}:${i + 1}: invalid JSON: ${e.message}`);
    }
  });
  return rows;
}

function bandFromFilename(path) {
  const m = /band(\d+)/.exec(basename(path));
  return m ? parseInt(m[1], 10) : 1;
}

// Content-word token count of a RU string, punctuation excluded. Hyphenated
// words (по-русски) and numbers count as a single token. This is intentionally
// crude (no morphology) — it only needs to be a reasonable proxy for "how many
// real words are in this sentence" so build-time unlinked-word detection
// (LINGO-010 calibration bug fix) can tell a short core sentence from a long
// lesson/note sentence with a low lemma-link rate.
function tokenizeRuCount(text) {
  const matches = String(text ?? "").match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

function wordPaths(dataDir) {
  return globSync(join(dataDir, "words_band*.jsonl")).sort();
}

// Mirror import.py:sentence_paths — frequency bands + imported handwritten notes.
function sentencePaths(dataDir) {
  const paths = globSync(join(dataDir, "sentences_band*.jsonl"));
  paths.push(...globSync(join(dataDir, "sentences_imported*.jsonl")));
  return paths.sort();
}

export function buildDeck(dataDir = DEFAULT_DATA) {
  const words = [];
  const lemmaToId = new Map();
  let nextWordId = 1;

  for (const path of wordPaths(dataDir)) {
    const band = bandFromFilename(path);
    for (const [, w] of loadJsonl(path)) {
      const lemma = String(w.lemma).trim();
      // Natural key = lemma (single deck). Last write wins, like the UPSERT.
      let id = lemmaToId.get(lemma);
      if (id === undefined) {
        id = nextWordId++;
        lemmaToId.set(lemma, id);
        words.push({ id, lemma, rank: w.rank ?? null, band: w.band ?? band, pos: w.pos ?? "" });
      } else {
        const existing = words.find((x) => x.id === id);
        existing.rank = w.rank ?? null;
        existing.band = w.band ?? band;
        existing.pos = w.pos ?? "";
      }
    }
  }

  const wordById = new Map(words.map((w) => [w.id, w]));
  const sentences = [];
  const seenIds = new Set();
  const unmatched = new Map();

  for (const path of sentencePaths(dataDir)) {
    const band = bandFromFilename(path);
    for (const [lineno, s] of loadJsonl(path)) {
      const sid = String(s.id).trim();
      if (seenIds.has(sid)) throw new Error(`${path}:${lineno}: duplicate sentence id ${sid}`);
      seenIds.add(sid);

      const wordIds = [];
      for (const lemmaRaw of s.lemmas ?? []) {
        const lemma = String(lemmaRaw).trim();
        const wid = lemmaToId.get(lemma);
        if (wid === undefined) {
          if (!unmatched.has(lemma)) unmatched.set(lemma, []);
          unmatched.get(lemma).push(sid);
          continue;
        }
        if (!wordIds.includes(wid)) wordIds.push(wid);
      }
      let minRank = null;
      for (const wid of wordIds) {
        const r = wordById.get(wid)?.rank;
        if (r != null && (minRank == null || r < minRank)) minRank = r;
      }

      sentences.push({
        id: sid,
        ru: s.ru,
        en: s.en,
        ja: s.ja ?? null,
        kana: s.kana ?? null,
        note: s.note ?? null,
        band: s.band ?? band,
        difficulty: s.difficulty ?? 1,
        source: s.source ?? "generated",
        kind: s.kind ?? "sentence",
        // LINGO-011: the lemma this sentence is built to teach (quiz target).
        targetLemma: s.target_lemma ?? null,
        wordIds,
        minRank,
        // LINGO-010 fix: real RU content-word count, vs. wordIds.length (only
        // successfully-linked lemmas) — the gap is "unlinked" words the
        // calibration scorer can no longer ignore.
        tokenCount: tokenizeRuCount(s.ru),
      });
    }
  }

  const bands = [...new Set(sentences.map((s) => s.band))].sort((a, b) => a - b);

  return {
    ...DECK,
    bands,
    words,
    sentences,
    _meta: {
      wordCount: words.length,
      sentenceCount: sentences.length,
      unmatchedLemmas: unmatched.size,
      sources: sentencePaths(dataDir).map((p) => basename(p)),
    },
  };
}

function main() {
  const deck = buildDeck();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(deck));
  const m = deck._meta;
  console.log(
    `deck.generated.json: ${m.wordCount} words, ${m.sentenceCount} sentences ` +
      `from [${m.sources.join(", ")}]` +
      (m.unmatchedLemmas ? ` (${m.unmatchedLemmas} unmatched lemmas)` : ""),
  );
}

// CLI entry (skip when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

// Guard: fail loudly if the data dir is missing at CLI time.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && !existsSync(DEFAULT_DATA)) {
  console.error(`data dir not found: ${DEFAULT_DATA}`);
  process.exit(1);
}
