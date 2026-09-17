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

// LINGO-039: Thai course. Data under pipeline/courses/th/ (same "current data
// untouched" isolation as EN). grammarMeta is "classifier": Thai is an
// isolating language with no conjugation, declension, grammatical gender or
// verb aspect, so every one of the grammar slots this schema carries for RU
// (aspect/aspectPair/pairKind) and the LINGO-022 gender slot stay null by
// construction. What a Thai learner needs instead — the noun classifier to
// use, the tone the spelling implies, and word-order/politeness particles —
// is prose, so it lives in the sentence note (ja/en/ru) rather than in a new
// structured column nothing else would ever populate.
export const TH_DECK = {
  dataDir: join(PIPELINE, "courses", "th"),
  outFile: join(CONTENT_DIR, "deck.th.json"),
  code: "TH-from-JA-EN",
  name: "Thai (TNC frequency bands + travel core)",
  courseId: "th",
  targetLang: "th",
  sourceLang: "ja",
  availableFrontLangs: ["ja", "en"],
  defaultFrontLang: "ja",
  grammarMeta: "classifier",
};

// LINGO-044: Japanese course, for en/ru speakers. grammarMeta is "conjugation":
// unlike Thai (which has none at all) Japanese inflects, and the thing a
// learner needs told is a verb's group and its polite ます-form — prose, so it
// lives in the sentence note rather than in a structured column.
export const JA_DECK = {
  dataDir: join(PIPELINE, "courses", "ja"),
  outFile: join(CONTENT_DIR, "deck.ja.json"),
  code: "JA-from-EN-RU",
  name: "Japanese (spoken-frequency bands)",
  courseId: "ja",
  targetLang: "ja",
  sourceLang: "en",
  availableFrontLangs: ["en", "ru"],
  defaultFrontLang: "en",
  grammarMeta: "conjugation",
};

const DECKS = [RU_DECK, EN_DECK, TH_DECK, JA_DECK];

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

// LINGO-039: Thai is written with no spaces between words (spaces appear only
// at phrase/clause boundaries), so tokenizeCount's letter-run regex counts a
// whole Thai clause as ONE token — "ผมขอข้าวครับ" is 4 words but 1 run. That
// would silently break the two things tokenCount exists for: the
// MAX_SENTENCE_TOKENS safety net (everything looks short enough) and, worse,
// calibration's unlinked-word gap (tokenCount - wordIds.length would go
// negative, i.e. "this sentence has no words the learner hasn't judged",
// making every Thai sentence look maximally easy).
//
// For Thai the authoritative segmentation is the row's own `lemmas` array —
// the generator records the word boundaries explicitly precisely because the
// script does not (the displayed `th` text stays naturally unspaced). Using
// its length keeps the invariant the field is defined by: it counts every
// content word actually in the sentence, so the gap against wordIds.length
// (deduped, resolved lemmas only) still means exactly "words that did not
// link to a deck entry".
function sentenceTokenCount(s, targetLang) {
  // LINGO-044: Japanese has the same problem as Thai — no spaces between
  // words, so tokenizeCount() sees 私は毎朝コーヒーを飲みます as one letter run.
  // Its `lemmas` are produced by a morphological analyser (UniDic) rather than
  // written by hand, so they are the authoritative segmentation here too.
  if (targetLang === "th" || targetLang === "ja") return (s.lemmas ?? []).length;
  return tokenizeCount(s[targetLang]);
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

// LINGO-012/LINGO-025: <dataDir>/words_aspects.jsonl — the single,
// consolidated, all-band verb aspect + aspect_pair + pair_kind + pair_note
// sidecar (LINGO-025 extended LINGO-012's band1-only
// words_band1_aspects.jsonl to cover band1-4; that file is now archived at
// pipeline/rebaseline/legacy_words_band1_aspects.jsonl as a frozen one-time
// input to the LINGO-025 assembly script, NOT live here — globbing both
// used to double-apply the old file AFTER the new one and silently wipe
// pair_kind/pair_note for 255 lemmas back to null), applied on top of the
// base word list (mirrors import.py's import_word_aspects UPDATE-only
// semantics: a lemma with no matching Word is silently ignored here since
// buildDeck has no separate "unmatched" report for this file — import.py is
// the source of truth for that warning). RU only today; the glob naturally
// finds nothing under the EN course's dataDir.
function wordAspectPaths(dataDir) {
  return globSync(join(dataDir, "words_aspects.jsonl"))
    .filter((p) => basename(p) === "words_aspects.jsonl")
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

/** The raw sentence rows a course's JSONL contains, before any linking or
 * filtering. Exported for tests that need to assert something about the SOURCE
 * data rather than the compiled deck — LINGO-039's Thai invariants ("the Thai
 * text is exactly its lemmas concatenated", "the transcription is exactly its
 * words' transcriptions joined") are properties of the source rows, and the
 * compiled deck deliberately doesn't carry the `lemmas` array to assert them
 * against. Reading the files here rather than in the test keeps `node:fs` out
 * of the browser tsconfig, which has no node types. */
export function sourceSentenceRows(dataDir) {
  const out = [];
  for (const path of sentencePaths(dataDir)) {
    for (const [, s] of loadJsonl(path)) out.push(s);
  }
  return out;
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
          // LINGO-039: per-headword pronunciation transcription. TH ships
          // Paiboon romanization here (Thai spelling encodes tone only via
          // rules a beginner hasn't learned, so the headword is unusable
          // without it); null for RU/EN.
          kana: w.kana ?? null,
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
          // LINGO-026: pairNote is ja-only by convention; pairNoteEn/Ru are
          // the translated counterparts. All three resolved by the UI layer
          // (engine/localizedText.ts) via front→UI→en→ja, never rendered raw.
          pairNote: null,
          pairNoteEn: null,
          pairNoteRu: null,
        });
      } else {
        const existing = words.find((x) => x.id === id);
        existing.rank = w.rank ?? null;
        existing.band = w.band ?? band;
        existing.pos = w.pos ?? "";
        existing.enGloss = w.en_gloss ?? null;
        existing.jaGloss = w.ja_gloss ?? null;
        existing.ruGloss = w.ru_gloss ?? null;
        existing.kana = w.kana ?? null;
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
      // LINGO-026: parallel translated fields, added alongside the existing
      // ja-only pair_note (see the module-level Sentence.note comment below
      // for the same "parallel fields, not a nested object" schema decision).
      existing.pairNoteEn = a.pair_note_en ?? null;
      existing.pairNoteRu = a.pair_note_ru ?? null;
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
      // (s.ru for RU, s.en for EN), not always s.ru. LINGO-039: Thai counts
      // its `lemmas` instead — see sentenceTokenCount.
      const tokenCount = sentenceTokenCount(s, deckConfig.targetLang);
      const isCore = s.target_lemma != null && String(s.target_lemma).trim() !== "";

      if (kind === "sentence") {
        // LINGO-050/051 (Katsuta-approved purification plan, 純化プラン):
        // non-core sentences from the imported notes/lessons sources
        // (sentences_imported.jsonl / sentences_imported_lessons.jsonl —
        // origin "notes"/"lessons") now ship as the マイノート lane's pool
        // (engine/content.ts's sentencePool() already treats any kind=
        // "sentence" row with no targetLemma as "notes" — it just never had
        // rows to draw from because everything non-core was dropped here).
        // The OLD handwritten band1 corpus (origin "generated", pre-LINGO-011
        // free-form sentences this project moved away from) is NOT part of
        // that plan and stays excluded — Katsuta's instruction named only
        // "sentences_imported*.jsonl（ノート/レッスン文）".
        const isNotesLaneOrigin = origin === "notes" || origin === "lessons";
        if (!isCore && !isNotesLaneOrigin) {
          excluded.total += 1;
          excluded.byReason.nonCore += 1;
          excluded.byOrigin[origin] = (excluded.byOrigin[origin] ?? 0) + 1;
          continue;
        }
        // Length cap applies to BOTH core and マイノート rows (LINGO-010's
        // rule was never "core sentences only", it was "no long sentence
        // ships" — the safety net just used to be redundant for non-core
        // rows since they were dropped entirely before this check ran).
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
        // LINGO-039: fourth flat language slot, same convention as the three
        // above. Emitted unconditionally (null for the RU/EN packs) to match
        // how every other optional column in this schema is written —
        // gender/aspect/pairKind/forms all ship as explicit nulls rather than
        // absent keys. That does add ~28KB of `"th":null` to deck.ru.json;
        // it gzips to nothing and no consumer's behaviour changes, so the
        // design's "現行データ無干渉" invariant is verified semantically
        // (RU/EN decks identical modulo the new always-null keys) rather than
        // by a raw byte hash.
        th: s.th ?? null,
        kana: s.kana ?? null,
        // Etymology/grammar note (RU) or irregular-verb principal parts in
        // "go-went-gone" form (EN, LINGO-015) — same free-text field, course
        // decides what it means. LINGO-026: `note` itself stays ja-only (RU
        // course) / whatever the source language already was (EN course's
        // "go-went-gone" is already language-neutral ASCII); note_en/note_ru
        // are parallel translated fields (not a nested {ja,en,ru} object —
        // keeps every existing consumer of the bare `note` string working
        // unchanged, and matches the flat-column convention the rest of this
        // schema already uses for aspect/aspectPair/pairKind). Resolved by
        // the UI layer via engine/localizedText.ts's front→UI→en→ja chain.
        note: s.note ?? null,
        noteEn: s.note_en ?? null,
        noteRu: s.note_ru ?? null,
        band: s.band ?? band,
        difficulty: s.difficulty ?? 1,
        source: s.source ?? "generated",
        kind,
        // The lemma this sentence is built to teach (quiz target).
        targetLemma: s.target_lemma ?? null,
        // LINGO-033: per-token case/number for the card-back "文中の形"
        // display — [{lemma, surface, case, number}], only for tokens
        // pymorphy3 could confidently resolve (see pipeline/rebaseline/
        // annotate_cases.py). RU course only; EN/undeclared rows get [].
        forms: s.forms ?? [],
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
