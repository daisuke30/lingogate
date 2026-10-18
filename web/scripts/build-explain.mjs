// LINGO-056: compiles the raw generation working files
// (pipeline/data/explain/word_dict_{ja,en}.jsonl,
// sentence_commentary_{ja,en}.jsonl) into the lazy-loaded chunk JSON files
// LINGO-057's UI will fetch on demand — explain.word.ru.{ja,en}.json and
// explain.sentence.ru.{ja,en}.json under web/src/content/explain/.
//
// Deliberately separate from build-content.mjs: this content is NOT part of
// the initial app bundle (deck.ru.json) — see the schema note in
// ai-org/Tasks/LINGO-056-dictionary-generation.md ("デッキ本体には入れず
// コース別遅延チャンク"). Output goes to web/public/explain/ (NOT
// src/content/) — files under public/ are served as-is by Vite at their
// literal path and never get swept into the JS bundle via import, which is
// exactly "lazy chunk, fetched on demand" (LINGO-057's UI will `fetch()`
// these at runtime, e.g. on first tap of an "explain" affordance) rather
// than "inlined, always downloaded" like deck.ru.json deliberately is (see
// vite.config.ts's assetsInlineLimit comment for that contrast). Running
// this script is safe at ANY point during generation — a partial
// word_dict_ja.jsonl with 300 of 3000 entries produces a valid (if partial)
// explain.word.ru.ja.json; nothing downstream breaks on partial coverage,
// since LINGO-057's UI is expected to handle a missing dictionary entry by
// simply not showing the "explain" affordance for that word/sentence.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPLAIN_SRC = join(HERE, "..", "..", "pipeline", "data", "explain");
const OUT_DIR = join(HERE, "..", "public", "explain");

function loadJsonl(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf-8");
  const rows = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) rows.push(JSON.parse(trimmed));
  }
  return rows;
}

// Exported (not just used internally) so Vitest can assert on the compiled
// data directly — see explainBuild.test.ts — without needing node:fs/
// __dirname in a .ts test file (this project carries no @types/node; the
// established pattern, same as build-content.mjs's buildDeck(), is to keep
// all fs access in a plain .mjs script and import its pure functions).
export function buildWordChunk(lang) {
  const rows = loadJsonl(join(EXPLAIN_SRC, `word_dict_${lang}.jsonl`));
  const map = {};
  for (const r of rows) map[r.lemma] = r;
  return map;
}

export function buildSentenceChunk(lang) {
  const rows = loadJsonl(join(EXPLAIN_SRC, `sentence_commentary_${lang}.jsonl`));
  const map = {};
  for (const r of rows) map[r.id] = r;
  return map;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let totalWords = 0;
  let totalSentences = 0;
  for (const lang of ["ja", "en"]) {
    const words = buildWordChunk(lang);
    const wordCount = Object.keys(words).length;
    writeFileSync(join(OUT_DIR, `explain.word.ru.${lang}.json`), JSON.stringify(words));
    totalWords = Math.max(totalWords, wordCount);

    const sentences = buildSentenceChunk(lang);
    const sentCount = Object.keys(sentences).length;
    writeFileSync(join(OUT_DIR, `explain.sentence.ru.${lang}.json`), JSON.stringify(sentences));
    totalSentences = Math.max(totalSentences, sentCount);

    console.log(`explain.word.ru.${lang}.json: ${wordCount}/3000 words`);
    console.log(`explain.sentence.ru.${lang}.json: ${sentCount}/2135 sentences`);
  }
  console.log(`\n(partial coverage is expected and safe — LINGO-056 is still generating content)`);
}

// CLI entry (skip when imported by a test, same guard as build-content.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
