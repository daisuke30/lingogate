// Build-time content compiler: pipeline JSONL -> a static deck JSON bundled into
// the app. Mirrors the relevant parts of pipeline/import.py (word/sentence
// import, lemma->word linking, band-from-filename) but emits JSON instead of a
// SQLite DB, since the web build has no runtime SQLite.
//
// LINGO-015 (Phase B): generalized from a single RU-only builder into a
// per-course builder. A "course" pack is produced by `buildDeck(dataDir,
// deckConfig)`; RU_DECK/EN_DECK below are the two shipped configs. The word
// and sentence JSONL schemas were ALREADY course-agnostic — both RU
// (pipeline/data) and EN (pipeline/courses/en) JSONL use the same three
// language-slot field names (ru/en/ja on Sentence; en_gloss/ja_gloss/ru_gloss
// on Word) regardless of which language is the course's target — so no field
// remapping is needed, just a different dataDir/output file/config per course.
// The one genuinely course-specific piece is the token-count safety net
// (LINGO-010), which must count words in the COURSE'S target-language field,
// not always `.ru` — see targetLang-aware tokenizeCount below.
//
// Sources (globbed, like import.py:sentence_paths — the imported deck is picked
// up automatically when LINGO-009 produces it):
//   <dataDir>/words_band*.jsonl
//   <dataDir>/sentences_band*.jsonl
//   <dataDir>/sentences_imported*.jsonl   (optional; RU course only today)
//
// Exported `buildDeck(dataDir, deckConfig)` is unit-tested; the CLI at the
// bottom writes both course packs (deck.ru.json, deck.en.json).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPELINE = join(HERE, "..", "..", "pipeline");
const CONTENT_DIR = join(HERE, "..", "src", "content");

// LINGO-014 course config: the 3 language axes (design §1). courseId ==
// targetLang (the 裏面 / language being learned). availableFrontLangs = which
// prompt/gloss languages this pack ships (the 表面 the learner can pick from;
// must never include targetLang). grammarMeta names the course-specific
// grammar slot carried on words/sentences (RU = verb aspect, on Word;
// EN = irregular-verb principal parts, inline in Sentence.note — see
// LINGO-015). UI language (i18n) is independent of the pack — see src/i18n.
export const RU_DECK = {
  dataDir: join(PIPELINE, "data"),
  outFile: join(CONTENT_DIR, "deck.ru.json"),
  code: "RU-from-EN",
  name: "Russian from English (frequency bands)",
  courseId: "ru",
  targetLang: "ru",
  sourceLang: "en",
  availableFrontLangs: ["en", "ja"],
  defaultFrontLang: "en",
  grammarMeta: "aspect",
};

// LINGO-015 (Phase B): NGSL-based English course. Data lives under
// pipeline/courses/en/ (kept separate from pipeline/data/ so the RU course's
// files/schema are never touched — design §2's "現行データ無干渉" invariant).
export const EN_DECK = {
  dataDir: join(PIPELINE, "courses", "en"),
  outFile: join(CONTENT_DIR, "deck.en.json"),
  code: "EN-from-JA-RU",
  name: "English (NGSL frequency bands)",
  courseId: "en",
  targetLang: "en",
  sourceLang: "ja",
  availableFrontLangs: ["ja", "ru"],
  defaultFrontLang: "ja",
  grammarMeta: "irregular",
};

const DECKS = [RU_DECK, EN_DECK];

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

// Content-word token count of a string in the given language field,
// punctuation excluded. Hyphenated words (по-русски / well-known) and numbers
// count as a single token. This is intentionally crude (no morphology) — it
// only needs to be a reasonable proxy for "how many real words are in this
// sentence" so build-time unlinked-word detection (LINGO-010 calibration bug
// fix) can tell a short core sentence from a long lesson/note sentence with a
// low lemma-link rate. Course-agnostic: works on ru/en/ja text alike since it
// only looks at Unicode letter/number runs.
function tokenizeCount(text) {
  const matches = String(text ?? "").match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

// LINGO-010 follow-up (2026-08-26, explicit direction from Katsuta): a stale
// ReviewState from before the scoring/length fixes can still pull an old
// sentence back into the review queue regardless of new-card scoring or
// length filtering — the review queue doesn't consult either. So instead of
// scoring/filtering lesson-and-note sentences, drop them from the app deck
// entirely: only kind='sentence' rows sourced from the LINGO-011/015 core
// deck (identified by having a target_lemma — every core row has one, no
// other source sets it) survive, plus every kind='word' card. "頻出1000単語を
// 元に作成したフレーズだけにフォーカス" (Katsuta, 2026-08-26). Raw JSONL / SQLite
// are left untouched for future reuse (band2/3 rollout etc.); only the web
// deck is restricted.
const MAX_SENTENCE_TOKENS = 8; // safety net only now — core rows are always ≤8 by construction.

// Categorises a source file for the build-log breakdown (notes / lessons /
// generated) — cosmetic only, doesn't affect which sentences are kept.
function originCategory(path) {
  const b = basename(path);
  if (/lessons/.test(b)) return "lessons";
  if (/imported/.test(b)) return "notes";
  return "generated";
}

// Mirror import.py:word_paths — <dataDir>/words_band<N>.jsonl only. Excludes
// sidecar files like words_band1_aspects.jsonl (see wordAspectPaths), which
// would otherwise also match a loose words_band*.jsonl glob and get parsed
// as if it were a full word list (blanking out pos/rank/band via the ??
// fallbacks below).
function wordPaths(dataDir) {
  return globSync(join(dataDir, "words_band*.jsonl"))
    .filter((p) => /^words_band\d+\.jsonl$/.test(basename(p)))
    .sort();
}

// LINGO-012/LINGO-025: <dataDir>/words_aspects.jsonl — the consolidated,
// all-band verb aspect + aspect_pair + pair_kind + pair_note sidecar
// (LINGO-025 extended LINGO-012's band1-only words_band1_aspects.jsonl to
// cover band1-4), applied on top of the base word list (mirrors import.py's
// import_word_aspects UPDATE-only semantics: a lemma with no matching Word is
// silently ignored here since buildDeck has no separate "unmatched" report
// for this file — import.py is the source of truth for that warning). Also
// still picks up any stray legacy words_band<N>_aspects.jsonl. RU only
// today; the glob naturally finds nothing under the EN course's dataDir.
function wordAspectPaths(dataDir) {
  return [
    ...globSync(join(dataDir, "words_aspects.jsonl")),
    ...globSync(join(dataDir, "words_band*_aspects.jsonl")),
  ]
    .filter((p) => /^words_aspects\.jsonl$|^words_band\d+_aspects\.jsonl$/.test(basename(p)))
    .sort();
}

// Mirror import.py:sentence_paths — frequency bands + imported handwritten
// notes. The imported-notes glob is RU-only in practice today; it simply
// matches nothing under the EN course's dataDir.
function sentencePaths(dataDir) {
  const paths = globSync(join(dataDir, "sentences_band*.jsonl"));
  paths.push(...globSync(join(dataDir, "sentences_imported*.jsonl")));
  return paths.sort();
}

export function buildDeck(dataDir = RU_DECK.dataDir, deckConfig = RU_DECK) {
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
        words.push({
          id,
          lemma,
          rank: w.rank ?? null,
          band: w.band ?? band,
          pos: w.pos ?? "",
          enGloss: w.en_gloss ?? null,
          jaGloss: w.ja_gloss ?? null,
          ruGloss: w.ru_gloss ?? null,
          // LINGO-022: noun grammatical gender ('m'|'f'|'n'|'pl'|'mf'), null
          // for non-nouns and any course that doesn't carry it.
          gender: w.gender ?? null,
          // LINGO-012/025: filled in below from the words_aspects.jsonl
          // sidecar; null for non-verbs and for courses (EN) that don't
          // carry a grammar sidecar at all.
          aspect: null,
          aspectPair: null,
          // LINGO-025: 'pair' | 'related' | 'none' | null — see wordBreakdown.ts.
          pairKind: null,
          pairNote: null,
        });
      } else {
        const existing = words.find((x) => x.id === id);
        existing.rank = w.rank ?? null;
        existing.band = w.band ?? band;
        existing.pos = w.pos ?? "";
        existing.enGloss = w.en_gloss ?? null;
        existing.jaGloss = w.ja_gloss ?? null;
        existing.ruGloss = w.ru_gloss ?? null;
        existing.gender = w.gender ?? null;
      }
    }
  }

  // LINGO-012/025: apply verb aspect + aspect_pair + pair_kind + pair_note
  // on top of the base word list.
  for (const path of wordAspectPaths(dataDir)) {
    for (const [, a] of loadJsonl(path)) {
      const lemma = String(a.lemma).trim();
      const id = lemmaToId.get(lemma);
      if (id === undefined) continue; // unmatched — import.py surfaces this warning
      const existing = words.find((x) => x.id === id);
      existing.aspect = a.aspect ?? null;
      existing.aspectPair = a.aspect_pair ?? null;
      existing.pairKind = a.pair_kind ?? null;
      existing.pairNote = a.pair_note ?? null;
    }
  }

  const wordById = new Map(words.map((w) => [w.id, w]));
  const sentences = [];
  const seenIds = new Set();
  const unmatched = new Map();
  const excluded = {
    total: 0,
    byReason: { nonCore: 0, overLength: 0 },
    byOrigin: { generated: 0, lessons: 0, notes: 0 },
  };

  for (const path of sentencePaths(dataDir)) {
    const band = bandFromFilename(path);
    const origin = originCategory(path);
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

      const kind = s.kind ?? "sentence";
      // LINGO-015: count words in THIS course's target-language field
      // (s.ru for RU, s.en for EN), not always s.ru.
      const tokenCount = tokenizeCount(s[deckConfig.targetLang]);
      const isCore = s.target_lemma != null && String(s.target_lemma).trim() !== "";

      if (kind === "sentence") {
        // Only core sentences (target_lemma set) survive — every other
        // sentence source (old RU band1 handwritten, imported notes,
        // imported lessons) is dropped regardless of length.
        if (!isCore) {
          excluded.total += 1;
          excluded.byReason.nonCore += 1;
          excluded.byOrigin[origin] = (excluded.byOrigin[origin] ?? 0) + 1;
          continue;
        }
        // Safety net: a core row should never exceed this by construction,
        // but don't ship one to the app if it somehow does.
        if (tokenCount > MAX_SENTENCE_TOKENS) {
          excluded.total += 1;
          excluded.byReason.overLength += 1;
          excluded.byOrigin[origin] = (excluded.byOrigin[origin] ?? 0) + 1;
          continue;
        }
      }

      sentences.push({
        id: sid,
        ru: s.ru,
        en: s.en,
        ja: s.ja ?? null,
        kana: s.kana ?? null,
        // Etymology/grammar note (RU) or irregular-verb principal parts in
        // "go-went-gone" form (EN, LINGO-015) — same free-text field, course
        // decides what it means.
        note: s.note ?? null,
        band: s.band ?? band,
        difficulty: s.difficulty ?? 1,
        source: s.source ?? "generated",
        kind,
        // The lemma this sentence is built to teach (quiz target).
        targetLemma: s.target_lemma ?? null,
        wordIds,
        minRank,
        // LINGO-010 fix: real target-language content-word count, vs.
        // wordIds.length (only successfully-linked lemmas) — the gap is
        // "unlinked" words the calibration scorer can no longer ignore.
        tokenCount,
      });
    }
  }

  const bands = [...new Set(sentences.map((s) => s.band))].sort((a, b) => a - b);

  return {
    code: deckConfig.code,
    name: deckConfig.name,
    courseId: deckConfig.courseId,
    targetLang: deckConfig.targetLang,
    sourceLang: deckConfig.sourceLang,
    availableFrontLangs: deckConfig.availableFrontLangs,
    defaultFrontLang: deckConfig.defaultFrontLang,
    grammarMeta: deckConfig.grammarMeta,
    bands,
    words,
    sentences,
    _meta: {
      wordCount: words.length,
      sentenceCount: sentences.length,
      unmatchedLemmas: unmatched.size,
      sources: sentencePaths(dataDir).map((p) => basename(p)),
      excluded,
    },
  };
}

function buildOne(deckConfig) {
  const outName = basename(deckConfig.outFile);
  if (!existsSync(deckConfig.dataDir)) {
    console.warn(`  skip ${outName}: data dir not found (${deckConfig.dataDir})`);
    return;
  }
  const deck = buildDeck(deckConfig.dataDir, deckConfig);
  mkdirSync(dirname(deckConfig.outFile), { recursive: true });
  writeFileSync(deckConfig.outFile, JSON.stringify(deck));
  const m = deck._meta;
  console.log(
    `${outName}: ${m.wordCount} words, ${m.sentenceCount} sentences ` +
      `from [${m.sources.join(", ")}]` +
      (m.unmatchedLemmas ? ` (${m.unmatchedLemmas} unmatched lemmas)` : ""),
  );
  if (m.excluded.total > 0) {
    const b = m.excluded.byOrigin;
    const r = m.excluded.byReason;
    console.log(
      `  excluded ${m.excluded.total} sentence(s): non-core=${r.nonCore}, over-length=${r.overLength} ` +
        `(by origin: generated=${b.generated ?? 0}, lessons=${b.lessons ?? 0}, notes=${b.notes ?? 0})`,
    );
  }
}

function main() {
  for (const deckConfig of DECKS) buildOne(deckConfig);
}

// CLI entry (skip when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

// Guard: fail loudly if the RU data dir (the always-required default course)
// is missing at CLI time. EN (and any future course) degrades gracefully via
// buildOne's existsSync check above instead, since it's additive.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && !existsSync(RU_DECK.dataDir)) {
  console.error(`data dir not found: ${RU_DECK.dataDir}`);
  process.exit(1);
}
