# LingoGate — EN Course Data (LINGO-015, Phase B)

English course: **English (NGSL frequency bands)**, prompted in Japanese or
Russian (裏面=English, 表面=ja/ru — design `ai-org/Ideas/20260827-lingogate-multilang-design.md`
§2/§3). Same JSONL→pack pipeline as the RU course (`pipeline/data/`,
documented in `pipeline/README.md`), reused with a different data directory —
`pipeline/data/` itself is untouched by this course (design §2's "現行データ
無干渉" invariant).

## Files

| File | What it is |
|---|---|
| `words_band1.jsonl` | Ranks 1–1000. `{lemma, rank, pos, ja_gloss, ru_gloss}`. |
| `words_band2.jsonl` | Ranks 1001–2000. Same schema. Vocabulary only — no sentences yet. |
| `words_band3.jsonl` | Ranks 2001–3000. Same schema. Vocabulary only — no sentences yet. |
| `sentences_band1_core.jsonl` | 1000 target-word-driven example sentences for band1 (one per word). `{id: "E####", en, ja, ru, lemmas[], target_lemma, difficulty, kind:"sentence", note?}`. |

No `en_gloss` column: the word itself already **is** English, so an English
gloss of an English word would be redundant. `ja_gloss`/`ru_gloss` are the two
translations shown in the card-back word breakdown (Phase A's front-language
gloss ordering already reads whichever of `enGloss/jaGloss/ruGloss` exist —
see `web/src/ui/FlashcardCard.tsx:orderedGloss`).

## Word list source & license

**New General Service List (NGSL)** — Browne, C., Culligan, B., & Phillips, J.
(2013, updated 2016/2023). ~2801 words, built from a 273M-word section of the
Cambridge English Corpus, designed for second-language learners (spoken-register
weighted, not a raw web corpus). **License: CC BY-SA 4.0** (free including
commercial use; attribution + share-alike). Home: <https://www.newgeneralservicelist.org>.

Data was fetched as a machine-readable JSON conversion from the mirror
**`lpmi-13/machine_readable_wordlists`** (`General/NGSL/NGSL.json`, CC0 for the
conversion format itself; the underlying NGSL wordlist retains its own CC BY-SA
4.0 license) — the official site's own download links did not resolve directly
in this environment, this mirror did. That file's three bands (`"1000"`,
`"2000"`,`"3000"`) map to `words_band1/2/3.jsonl`; the JSON key order is the
frequency order (verified against known top-English-word ordering: be, and,
of, to, a, in, have, it, you, he, …).

**Known data-quality fix applied**: in that mirror, `"the"` — the single most
frequent English word — was misplaced at the *tail* of the 1000-band list
(a conversion artifact) instead of rank 1. Verified this is the only
out-of-place core function word at that scale of spot-check; corrected by
moving `the` to rank 1 and shifting the rest down one position.

### Closing the 2801→3000 gap

NGSL itself is ~2801 words (design doc's own expectation: "NGSL ~2800語＋補完で
3000語化"). `words_band3.jsonl`'s first 801 entries (ranks 2001–2801) are pure
NGSL; the remaining **199 entries (ranks 2802–3000)** are supplemented from
the same mirror's **BNC/COCA word-family list** (`General/BNC_COCA/BNC_COCA.json`,
Nation's BNC/COCA frequency bands — a different, larger frequency resource),
taking its `"4000"` band (the tier immediately after NGSL's coverage) in that
list's own frequency order, skipping any lemma already present anywhere in
band1–3 (case-insensitive dedup). This mixes two sources only in the tail 199
of 3000 words; it is called out here so a future reconciliation pass knows
exactly which entries are NGSL-proper vs. supplement.

### gloss (`pos`/`ja_gloss`/`ru_gloss`) provenance

Generated — annotation of the fixed NGSL(+supplement) lemma list, not
invented vocabulary. Produced in six 500-word batches by sonnet subagents
(same recipe as RU band2/3, LINGO-013), each required to: (a) echo
`lemma`/`rank` byte-exact against the input (no hand-retyping — built via a
lemma/index-keyed merge, not manual transcription) so vocabulary itself can
never drift; (b) use a strict POS whitelist (`noun verb adj adv pron det prep
conj num part` — same 9 non-`predic` tags as the RU course's `pos.*` i18n
catalog, so no new UI localization work was needed); (c) self-check by
spot-checking ≥20 scattered entries per batch for gloss correctness before
finishing, given `ja_gloss` accuracy was explicitly flagged as historically
error-prone. Same caveat as RU: single most-common/basic sense only, polysemy
not represented — reconcile against a citable EN-JA/EN-RU dictionary before
any production/paid use.

## Sentence generation (`sentences_band1_core.jsonl`)

Same target-word-driven method as `pipeline/data/sentences_band1_core.jsonl`
(RU course, LINGO-011), applied to English:

- One sentence per band1 word (`id` number == word rank, `T####`→`E####`).
- **3–7 words.** The target word is wrapped in vocabulary of **strictly higher
  frequency** (lower rank) than the target wherever possible; where band1's
  top ~50 ranks make that impossible (mostly function words: *the, be, and,
  of, to, a, in, have, it, you, …*), a near-rank word is used instead and
  listed exactly in `lemmas` — same documented exception as the RU course.
- Subject bias: I/you-centric (per learner profile — a Japanese speaker
  learning English), with occasional he/she/they/we where natural.
- `lemmas` uses **dictionary headwords**, matching how NGSL's own
  word-family expansion works: e.g. `my`/`me`/`mine` all tag as `i`;
  `your`/`yours` tag as `you`; `his`/`him` tag as `he`; `an` tags as `a`. This
  mirrors band1's own JSONL headword list (family members like `my` are not
  separate Word rows) — a sentence using `my` still resolves to the `i` word
  for coverage purposes.
- **Irregular verbs**: when the target word is an irregular verb, `note`
  records its principal parts in `"base-past-participle"` form (e.g.
  `"go-went-gone"`, `"see-saw-seen"`), the same free-text `Sentence.note`
  field the RU course uses for etymology notes.
- Generated by Opus directly (not delegated), then **self-reviewed in a
  second pass** via an automated validator checking: word count bounds,
  target lemma present in its own `lemmas` array, every `lemmas` entry
  resolves to a real band1–3 word, no internal or cross-existing-content
  duplicate sentence text, and en/ja/ru script-consistency (no stray
  Cyrillic/Japanese characters leaking into the wrong field). All 1000
  entries pass with 0 outstanding issues; wrap-rule compliance ≈97.5%
  (violations concentrated in the same unavoidable top-50-function-word band
  as the RU course).

## Adding band2/band3 sentences (future task)

Not done in this pass (`sentences_band1_core.jsonl` is band1 only, matching
the design doc's explicit phasing: "band2/3は後日同形式で追加"). To extend:
follow the exact recipe above against `words_band2.jsonl`/`words_band3.jsonl`,
new `id` prefix continuing past `E1000` (e.g. `E1001…E2000`), output to
`sentences_band2_core.jsonl` / `sentences_band3_core.jsonl` — `build-content.mjs`
picks up any `sentences_band*.jsonl` file automatically via the existing glob,
no code change required.
