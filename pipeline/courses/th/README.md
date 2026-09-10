# LingoGate — TH Course Data (LINGO-039)

Thai course: **Thai (TNC frequency bands + travel core)**, prompted in Japanese
or English (裏面=Thai, 表面=ja/en — design
`ai-org/Ideas/20260827-lingogate-multilang-design.md` §1/§7). Same JSONL→pack
pipeline as the RU and EN courses, with a different data directory;
`pipeline/data/` and `pipeline/courses/en/` are untouched (design §2's
"現行データ無干渉" invariant).

Built for a specific deadline: Katsuta flies to Thailand 2026-09-25, so band1
is ordered for **a traveller**, not for a corpus statistician. See "Band1 is a
teaching order" below.

## Files

| File | What it is |
|---|---|
| `words_band1.jsonl` | Ranks 1–1000. `{lemma, rank, band, pos, kana, ja_gloss, en_gloss, tnc_rank, travel_core}`. |
| `words_band2.jsonl` | Ranks 1001–2000. Same schema. Vocabulary only — no sentences. |
| `words_band3.jsonl` | Ranks 2001–3000. Same schema. Vocabulary only — no sentences. |
| `sentences_band1_core.jsonl` | 1000 target-word-driven sentences, one per band1 word. `{id: "TH####", th, kana, ja, en, ru, lemmas[], target_lemma, difficulty, kind, note?, note_en?, note_ru?}`. |

`tnc_rank` and `travel_core` are provenance only — `build-content.mjs` ignores
unknown keys. No `ru_gloss`: the course offers ja/en prompts only. No
`th_gloss`: the headword already *is* Thai.

## Word list source & license

**Thai National Corpus (TNC)** frequency list — Chulalongkorn University's
balanced ~33M-word corpus of Thai, distributed in machine-readable form by
**PyThaiNLP** (`pythainlp/corpus/tnc_freq.txt`, 106,122 entries, Apache-2.0
tooling over the TNC's own terms). Home: <https://www.arts.chula.ac.th/ling/tnc/>.

### Why not the usual OpenSubtitles list

The obvious choice — `hermitdave/FrequencyWords` `content/2018/th/th_50k.txt`,
which the RU/EN-style recipe would reach for — is **unusable for Thai** and was
rejected after inspection:

- Its top entries are **mojibake**: rank 1 `เธ` (81,142), rank 4 `เน` (51,595),
  plus `เธฒเธ`, `เธญเธ`. These are Thai UTF-8 text decoded as TIS-620/CP874 and
  re-encoded — a classic Thai encoding fault, not real words.
- English leaks straight into the list (`you` #11, `the` #13, `i` #18, `to`,
  `a`, `s`).
- Root cause: that project tokenises on **whitespace**, and Thai does not put
  spaces between words. Any whitespace-tokenised Thai frequency list is
  measuring phrases and subtitle line breaks, not words.

TNC is **already word-segmented**, which is the property that actually matters
here. (Thai Textbook Corpus `ttc_freq.txt` was also evaluated — clean, but only
19,493 entries and slightly worse travel coverage, so TNC won.)

## Pronunciation (`kana`) — source, system, and the one transformation

Every word and every sentence carries a romanized transcription in the app's
`kana` slot. This is **not optional decoration**: Thai spelling encodes tone
through rules (consonant class × tone mark × syllable type) that a beginner has
not learned, so a Thai headword without a transcription cannot be pronounced at
all. It is the single most load-bearing field in this course.

**Source: English Wiktionary**, via the machine-readable **kaikki.org** extract
(`kaikki.org-dictionary-Thai.jsonl`, 21,020 entries). Wiktionary's Thai module
emits a **Paiboon** romanization and an IPA transcription per entry, both with
full tone and vowel-length marking. License: **CC BY-SA 3.0/4.0** (Wiktionary).

Coverage of TNC ranks, measured: **96%** of the top 1000, 92% of the top 2000,
**88%** of the top 3000 have both Paiboon and IPA. **A word with no Wiktionary
pronunciation is not shipped** — the builder skips it and the next TNC word
takes its place, so all 3000 entries have a real, sourced transcription rather
than a guessed one.

### The kh/ph/th rewrite

Wiktionary emits Paiboon in Benjawan Becker's original convention, where the
*unaspirated* stops get the digraphs `g` / `bp` / `dt` and the *aspirated* ones
get the bare letters `k` / `p` / `t`. So ครับ comes out `kráp` and แพง as
`pɛɛng`. An English- or Japanese-speaking learner reads those bare letters as
the unaspirated stop — which in Thai is a **different phoneme** (ค vs ก).

This course therefore writes aspirated stops as **kh / ph / th**, keeping
**g / bp / dt** for the unaspirated series — the convention Katsuta's own
example (`khràp`) uses, and unambiguous in both directions:

| Thai | Wiktionary Paiboon | shipped `kana` |
|---|---|---|
| ครับ | `kráp` | `khráp` |
| ขอบคุณ | `kɔ̀ɔp-kun` | `khɔ̀ɔp-khun` |
| แพง | `pɛɛng` | `phɛɛng` |
| เผ็ด | `pèt` | `phèt` |
| ไป | `bpai` | `bpai` (unaspirated ป — unchanged) |
| สวัสดี | `sà-wàt-dii` | `sà-wàt-dii` (unchanged) |

The rewrite is a pure syllable-initial substitution and is safe because of the
complementary distribution above: a syllable-initial bare `k`/`p`/`t` can only
be the aspirated series. **Verified mechanically against Wiktionary's own IPA
across the entire extract — "syllable-initial bare k/p/t in Paiboon" ⇔
"syllable begins with kʰ/pʰ/tʰ in IPA" agreed on 48,201 / 48,201 syllables
(100.00%).** `build.th.test.ts` pins the four examples above plus a
whole-deck scan for unexpanded stops.

Open vowels keep their IPA-style symbols (`ɔ ɛ ʉ ə`, e.g. `khɔ̀ɔp-khun`,
`phɛɛng`) rather than being folded into `aw`/`ae`/`ue`/`er`, because the
symbols are unambiguous and match what Wiktionary and thai-language.com show.

### One word, one space-free transcription

Wiktionary writes four compound headwords as two prosodic words separated by a
space (อย่างน้อย `yàang nɔ́ɔi`, มองเห็น `mɔɔng hěn`, ขณะนี้ `khà-nà níi`,
ทุกที `thúk tii` — all band2/3). Every other multi-syllable word is
hyphen-joined, so these are normalised to hyphens too.

That is not just tidiness: a SENTENCE's transcription is built by joining its
words' transcriptions **with spaces**, so a space inside a single word's
transcription would make the result impossible to split back into words. No
band1 word was affected, so no shipped sentence was ever wrong — but a future
band2/3 sentence pass would have hit it. `build.th.test.ts` now asserts the
invariant deck-wide.

## Band1 is a teaching order, not a corpus rank

TNC is a balanced **written** corpus. Ordering band1 by raw corpus rank would
have handed a traveller `การ`, `ความ`, `ซึ่ง` and left out the words needed to
buy lunch — measured, from TNC:

| word | meaning | TNC rank | band1 rank shipped |
|---|---|---|---|
| สวัสดี | hello | 2831 | **6** |
| ขอบคุณ | thank you | 1294 | **18** |
| เท่าไหร่ | how much? | 1416 | **131** |
| แพง | expensive | 1368 | **229** |
| เผ็ด | spicy | 4884 | **291** |
| อร่อย | delicious | 1509 | **296** |
| ห้องน้ำ | toilet | 1925 | **518** |

So band1's `rank` is an explicit **teaching order**: a curated travel core
(`travel_core: true`, 139 words in band1) is blended forward against TNC rank,
a travel word landing at roughly 5× its curated priority index. **50 of them
come from outside the TNC top 1000** and would otherwise not be in band1 at
all. Each row keeps its `tnc_rank` so the corpus ordering is never lost.

band2/band3 (ranks 1001–3000) are pure TNC order — no curation.

## Glosses (`pos` / `ja_gloss` / `en_gloss`)

Annotation of the fixed lemma list, produced in six 500-word batches by sonnet
subagents (same recipe as LINGO-013/015). Two things make this a **selection**
task rather than a generation one:

- Each batch is handed **every sense Wiktionary lists** for the word, and must
  pick among them — it never invents a meaning. Wiktionary orders a page's
  entries *etymologically*, so "first entry, first gloss" is wrong for exactly
  the high-frequency function words band1 needs most: กับ's first candidate is
  the noun "trap; gin" (it is the preposition "with"), จาก's is "nipa palm"
  (it is "from"), ต้อง's is "to touch" (it is "must"), แต่'s is "each and
  every" (it is "but"). All four are correct in the shipped data.
- `lemma`/`rank` are **join keys only**: the merge takes vocabulary and `kana`
  from the candidate file and a mismatched lemma is a hard build failure, so a
  batch cannot corrupt the word list or a transcription even if it mis-copies
  a Thai string.

Machine-verified on merge, 3000/3000 with **0 issues**: pos in the 12-tag
whitelist *and* among that word's own Wiktionary candidates; both glosses
non-empty; `ja_gloss` contains Japanese; no Thai or Cyrillic in either gloss;
no Japanese in `en_gloss`.

Six entries carry a **documented manual override** (`OVERRIDES` in the
assembler), exempt from the "pos must be among Wiktionary's candidates" check.
These exist because selection-only has one failure mode: where Wiktionary's own
data is wrong, a batch faithfully reproduces the error instead of correcting
it. The first four were each flagged as suspicious by the batch that hit them;
the last two came from the independent review below.

| lemma | why |
|---|---|
| ล่ะ | Wiktionary's entry carries เล่า's glosses ("to narrate"). It is the topic/question particle. |
| โอ | Only lacquerware bowl / pomelo / tuna offered; none explains TNC #587, which is the interjection "oh". |
| ป้อน | Tagged `noun` although its own gloss is a verb definition ("to feed"). |
| กายภาพ | Only "inorganic; inanimate" offered; modern use is "physical" (กายภาพบำบัด = physical therapy). |
| ร้อง | ja and en glosses disagreed — 泣く ("weep") vs "to cry out". |
| อี | Register badly understated ("informal"); it is vulgar/derogatory, and a learner mis-using it would give real offence. |

### Independent review (Codex)

60 band1 rows sampled at random and reviewed by a separate model against the
three axes that matter — romanization (tone and vowel length), part of speech,
and ja/en gloss agreement:

- **0 romanization errors.** No tone or vowel-length mistake in 60 words. This
  is the strongest evidence that deriving `kana` from Wiktionary rather than
  generating it was the right call — pronunciation is the one field a model
  cannot be trusted to invent, and it is also the one field here that was
  never generated.
- **2 gloss errors (3.3%)** — ร้อง and อี, both now overridden above.
- 5 further rows called *debatable* rather than wrong: ที่, ใช่, ต่อ, ตน,
  พรุ่งนี้ — all cases where a word straddles two parts of speech (Thai
  dictionaries and learner grammars genuinely disagree, e.g. พรุ่งนี้ is a noun
  by dictionary and an adverb by use). Left as-is: the deck must pick one tag,
  and the chosen one is defensible in each case.

Same caveat as the RU/EN courses: **most-common sense only**, polysemy not
represented. Reconcile against a citable TH–JA dictionary before any paid use.

### `pos.classifier` is new

Thai has no conjugation, declension, gender or aspect, so every structured
grammar slot this schema carries for RU/EN (`aspect`, `aspectPair`,
`pairKind`, `gender`, `forms`) is null throughout — `build.th.test.ts` asserts
it. What Thai needs instead is the **noun classifier**: you cannot count
anything without the right one ("sɔ̌ɔng khon" = two people). Classifiers are
therefore a real part of speech here (`pos.classifier`, new i18n key in all
three UI languages; 11 in band1, 19 across the deck) rather than being
flattened into `noun`, and they are deliberately NOT in `wordBreakdown.ts`'s
`FUNCTION_POS` suppression list.

## Sentences (`sentences_band1_core.jsonl`)

One sentence per band1 word, `id` number == that word's rank (`TH0001`…
`TH1000`), 3–7 words, target wrapped in higher-frequency vocabulary — the same
target-word-driven method as the RU (LINGO-011) and EN (LINGO-015) courses.
Weighted toward **travel and daily life** (ordering food, taxis, markets,
prices, hotels, greetings, directions, illness) and written for a **male
speaker** (ผม, and ครับ where a polite utterance is natural).

**Coverage is partial and grows by rank block.** Sentences were generated in
blocks of 200 target words; the shipped count is pinned in
`build.th.test.ts`'s `SHIPPED_SENTENCES` so a lost block fails the build rather
than silently shrinking the deck. Band1 words without a sentence simply have no
sentence card yet — their word card, gloss and transcription all work, and the
mastery metric counts them normally. The blocks were run lowest-rank-first
because band1 rank is teaching order, so the covered words are the ones a
traveller reaches first; `build.th.test.ts` additionally asserts by name that
the travel-critical set (สวัสดี, ครับ, ขอบคุณ, ขอโทษ, ผม, ขอ, ไม่, ได้,
เท่าไหร่, แพง, อร่อย, เผ็ด, ข้าว, น้ำ, กิน) is covered.

### The Thai text and its transcription are computed, not generated

The generation batches supply only `{id, target_lemma, lemmas[], ja, en,
note?}`. The pipeline then computes:

```
th   = "".join(lemmas)               # Thai is written without word spaces
kana = " ".join(word_kana[lemma])    # per-word Paiboon, space-separated
```

This is possible because **Thai is an isolating language**: a word has exactly
one written form regardless of tense, number, person or case, so a sentence's
surface text really *is* its dictionary forms run together. Exploiting that:

- removes the largest error source in the course — a model hand-writing Thai
  script and tone diacritics;
- makes each sentence's transcription **consistent by construction** with the
  per-word transcriptions shown in its own card-back breakdown;
- makes an off-vocabulary word **impossible**: an unknown lemma is a hard
  failure in the assembler, not a silently unlinked word in the app.

The displayed `th` stays unspaced (natural Thai). The word boundaries live in
`lemmas`, which is also what `build-content.mjs` counts for `tokenCount` (see
below). Note the same trick would work for Chinese and for no other planned
language — see design doc §7.

### `tokenCount` branches for Thai

`build-content.mjs`'s `tokenizeCount()` counts Unicode letter runs, which on
unspaced Thai returns **1 for an entire clause**. Left alone that would make
`tokenCount < wordIds.length`, and calibration reads the gap between those two
as "words the learner hasn't judged" — every Thai sentence would have scored as
maximally easy. `sentenceTokenCount()` therefore uses `lemmas.length` for
`targetLang === "th"`, which preserves the field's actual definition (every
content word in the sentence, so the gap against the deduped linked `wordIds`
still means exactly "lemmas that did not resolve to a deck word").

### `ru` mirrors `en`

The pack ships no Russian sentence translations (`availableFrontLangs` is
ja/en), but `Sentence.ru` is non-optional in the builder, so it mirrors `en`.
A ru-UI learner takes this course with English prompts. Notes, by contrast,
**are** fully three-language — a note that exists in only some languages either
leaks or silently vanishes (LINGO-037 finding #4), so the assembler rejects a
partially-translated one.

## Adding band2/band3 sentences (future task)

Not done in this pass, matching the RU/EN phasing. To extend: same recipe
against `words_band2.jsonl` / `words_band3.jsonl`, ids continuing past
`TH1000`, output to `sentences_band2_core.jsonl` / `sentences_band3_core.jsonl`
— `build-content.mjs` picks up any `sentences_band*.jsonl` via its existing
glob, no code change needed.
