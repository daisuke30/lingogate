#!/usr/bin/env node
// LINGO-054: audit every course's deck words for missing/empty/placeholder
// translation fields in the glosses that course's UI actually needs.
//
// Required fields per course (mirrors availableFrontLangs in build-content.mjs
// — a learner can pick EITHER front language, so the word must carry a gloss
// in BOTH, not just one):
//   RU (front: en/ja) -> enGloss, jaGloss required
//   EN (front: ja/ru) -> jaGloss, ruGloss required
//   TH (front: ja/en) -> jaGloss, enGloss required
//   JA (front: en/ru) -> enGloss, ruGloss required
//
// This is the SOFTER, broader sibling of validateGlossCompleteness() (wired
// directly into buildDeck() as a hard build-time gate for true nulls/empty
// strings/placeholders — see build-content.mjs). This script additionally
// flags "suspicious" script-mismatch glosses (e.g. a ja_gloss with no CJK at
// all) for human review, with a small hand-reviewed allowlist for
// legitimate exceptions (digit-as-gloss number words, acronyms with no
// natural CJK/Cyrillic expansion like FBI/DNA/CIA/ATM/SF). Run manually
// (`npm run audit:glosses`), not part of the build gate — the allowlist
// needs a human judgment call the build can't make safely.
import { buildDeck, RU_DECK, EN_DECK, TH_DECK, JA_DECK } from "./build-content.mjs";

const COURSES = [
  { deck: RU_DECK, required: ["enGloss", "jaGloss"] },
  { deck: EN_DECK, required: ["jaGloss", "ruGloss"] },
  { deck: TH_DECK, required: ["jaGloss", "enGloss"] },
  { deck: JA_DECK, required: ["enGloss", "ruGloss"] },
];

const PLACEHOLDER_RE = /^(-+|\?+|n\/?a|todo|null|undefined|tbd|xxx+)$/i;
const CYRILLIC_RE = /[Ѐ-ӿ]/;
const LATIN_ONLY_WORD_RE = /^[A-Za-z]+$/;

const KNOWN_OK = new Set([
  "три|jaGloss", "пять|jaGloss", "четыре|jaGloss", "шесть|jaGloss",
  "десять|jaGloss", "двадцать|jaGloss", "двенадцать|jaGloss",
  "фбр|jaGloss", "днк|jaGloss", "цру|jaGloss", "банкомат|jaGloss",
  "фантастика|jaGloss",
]);

function classify(field, value, lemma) {
  if (value == null) return "missing (null)";
  if (typeof value !== "string") return `missing (non-string: ${typeof value})`;
  const trimmed = value.trim();
  if (trimmed === "") return "missing (empty string)";
  if (PLACEHOLDER_RE.test(trimmed)) return `placeholder (${JSON.stringify(trimmed)})`;
  if (trimmed === lemma) return "suspicious (gloss == lemma, likely copy-paste)";
  if (KNOWN_OK.has(`${lemma}|${field}`)) return null;
  if (field === "enGloss" && /^[Ѐ-ӿ\s-]+$/.test(trimmed)) return `suspicious (en_gloss is Cyrillic-only: ${JSON.stringify(trimmed)})`;
  if (field === "ruGloss" && LATIN_ONLY_WORD_RE.test(trimmed)) return `suspicious (ru_gloss is Latin-only: ${JSON.stringify(trimmed)})`;
  if (field === "jaGloss" && LATIN_ONLY_WORD_RE.test(trimmed)) return `suspicious (ja_gloss is Latin-only, no CJK: ${JSON.stringify(trimmed)})`;
  return null;
}

const allIssues = [];
for (const { deck, required } of COURSES) {
  const built = buildDeck(deck.dataDir, deck);
  for (const w of built.words) {
    for (const field of required) {
      const issue = classify(field, w[field], w.lemma);
      if (issue) {
        allIssues.push({ course: deck.courseId, id: w.id, lemma: w.lemma, band: w.band, rank: w.rank, field, issue });
      }
    }
  }
}

console.log(`total issues: ${allIssues.length}\n`);
const byCourse = {};
for (const row of allIssues) {
  byCourse[row.course] = byCourse[row.course] ?? [];
  byCourse[row.course].push(row);
}
for (const course of Object.keys(byCourse)) {
  console.log(`=== ${course}: ${byCourse[course].length} issues ===`);
}
console.log();
for (const row of allIssues) {
  console.log(`${row.course} [${row.field}] ${row.lemma} (band${row.band}, rank${row.rank ?? "-"}): ${row.issue}`);
}

if (process.argv.includes("--json")) {
  const path = process.argv[process.argv.indexOf("--json") + 1];
  const fs = await import("node:fs");
  fs.writeFileSync(path, JSON.stringify(allIssues, null, 2), "utf-8");
  console.error(`\nwrote ${allIssues.length} issues to ${path}`);
}
