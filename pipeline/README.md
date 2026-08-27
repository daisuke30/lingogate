# LingoGate — Content Pipeline (LINGO-001)

Offline pipeline that turns human-reviewable JSONL word/sentence lists into
`lingogate.db`, the SQLite content database bundled into the app.

Design reference: `ai-org/Ideas/20260703-quiz-gate-app-design.md` §5 (Content Engine).
Deck built here: **RU-from-EN** (learn Russian, prompted in English — the
dogfood deck for 勝田).

> **No external API is used.** Unlike the original task sketch (which assumed a
> Claude API batch job), there is no `ANTHROPIC_API_KEY` in this environment and
> the pipeline never calls out. The example data was authored directly (native
> Russian quality) and committed as JSONL so a human can review every line in a
> diff. The importer is pure Python 3 standard library.

## Files

| File | What it is |
|---|---|
| `schema.sql` | SQLite schema: `Deck`, `Word`, `Sentence`, `sentence_words`, `ReviewState` (FSRS), `GateSession`. `CREATE TABLE IF NOT EXISTS` throughout (safe to re-run). |
| `data/words_band1.jsonl` | Top ~1000 Russian lemmas (band 1). One JSON object per line: `{lemma, rank, pos, en_gloss, ja_gloss}`. |
| `data/sentences_band1.jsonl` | 291 everyday example sentences: `{id, ru, en, ja, lemmas[], difficulty}`. |
| `import.py` | Builds/updates `lingogate.db` from every `data/*_band*.jsonl`. Prints a coverage report. Idempotent. |
| `lingogate.db` | Generated output (checked in for app bundling; rebuildable any time). |

## Usage

```bash
cd pipeline
python3 import.py            # builds ./lingogate.db, prints coverage
python3 import.py --db /path/out.db --data ./data   # custom paths
```

Re-running is safe: content tables (`Deck`/`Word`/`Sentence`/`sentence_words`)
are rebuilt to match the JSONL, and rows no longer present in the JSONL are
pruned. User tables (`ReviewState`/`GateSession`) are **never touched**, and
`Sentence.id` is a stable string key (`s001`…) so a learner's FSRS state
survives content updates.

### Coverage report

`import.py` prints, per band, how many band lemmas are covered by at least one
example sentence, plus the full list of still-uncovered lemmas (ordered by
frequency rank). Current band 1: **393 / 1000 lemmas covered (39.3%)** across
291 sentences (1559 sentence↔word links).

Why not 100%? A 291-sentence starter deck (Phase-1 MVP target was "~300")
cannot naturally use all 1000 words without becoming a word-list dump. Sentences
were written to *greedily* introduce fresh vocabulary while staying natural
everyday speech. The uncovered lemmas are the backlog: adding more band-1
sentences that use them raises coverage with no code change.

## Adding band 2 / band 3 (or more sentences)

The importer globs `data/words_band*.jsonl` and `data/sentences_band*.jsonl`, so
**extending is drop-in**:

1. Produce `data/words_band2.jsonl` (ranks 1001–2000) in the same schema as
   band 1. `band` is inferred from the filename (`band2`) but may also be set
   per row.
2. Produce `data/sentences_band2.jsonl`. Each sentence:
   - `id`: globally unique, stable string (e.g. `s2001`). Do not reuse band-1 ids.
   - `lemmas`: list the **dictionary forms** the sentence covers, spelled exactly
     as in the words file (mind `ё`, and use the aspect/number form that exists
     in the list — e.g. tag `читать` even if the surface is `прочитала`).
   - `difficulty`: 1–3 (see distribution below).
3. Run `python3 import.py`. New rows import; the coverage report now includes
   band 2. If a sentence references a lemma not in any words file, the importer
   prints a `WARNING: … not found in Word table` line naming the lemma and
   sentence ids — fix the tag or add the word, then re-run.

### How the JSONL was produced (repeatable procedure)

The band-1 content was generated in three passes; reuse the same recipe for
band 2/3, whether the generator is an LLM agent or (later) a Claude API batch:

1. **Vocabulary** — take the frequency list for the band, emit one line per
   lemma with `pos` and glosses. (Here: authored by an agent, then validated.)
2. **Sentences** — greedily write natural everyday sentences (shopping,
   transport, small talk, university, work, home, feelings…) that maximize
   coverage of *not-yet-covered* band lemmas, 5–10 words each, with EN + JA.
   EN is the quiz prompt (EN→RU), so keep it natural but unambiguous enough to
   recover the RU.
3. **Self-review pass** — re-read every `ru` line for case, aspect, agreement,
   `ё`, and unnatural collocations; fix before committing. A second independent
   native-level pass is recommended (band 1 used one and it caught a real
   `положить`→`уложить` collocation error).

Difficulty mix used for band 1 (target): **d1 ≈ 40% (4–6 words), d2 ≈ 40%
(6–8 words), d3 ≈ 20% (8–10 words)**. Actual: 120 / 111 / 60.

## band 2 / band 3 (LINGO-013, added 2026-08-27)

`data/words_band2.jsonl` (ranks 1001–2000) and `data/words_band3.jsonl`
(ranks 2001–3000) extend the deck to the "会話頻出3000語" frame (design:
`ai-org/Ideas/20260827-lingogate-multilang-design.md` §3). **Words only — no
sentences yet** (sentence generation for band 2/3 is a later task). They import
drop-in via the existing `words_band*.jsonl` glob.

### Source & provenance (this is the part to trust / distrust deliberately)

- **Lemma list + frequency order**: the **University of Leeds "Internet-RU"
  Russian frequency list** (Serge Sharoff), as cleaned/mirrored by the
  `hingston/russian` repo — a lemmatised, frequency-ranked Cyrillic word list.
  **License: Creative Commons Attribution (CC BY 2.5)**. Source:
  <http://corpus.leeds.ac.uk/frqc/internet-ru.num> · mirror:
  <https://github.com/hingston/russian>. This is a **citable public source**,
  unlike band 1 (whose ranks were authored from model knowledge — see below).
- **Selection**: from the Leeds list in frequency order we took the top lemmas,
  **skipping any already in band 1** (dedup by lemma, ё→е normalised) and
  single-letter/noise tokens, until we had 1000 for band 2 and the next 1000 for
  band 3. `rank` is the **sequential position after that dedup** (1001…3000), to
  stay consistent with band 1's 1–1000 ordering — it is *not* the raw Leeds rank.
- **POS + glosses (`pos`, `en_gloss`, `ja_gloss`)**: generated (annotation of the
  fixed Leeds lemma list; the word list itself was not invented). **Approximate,
  same caveat as band 1**: most-common-sense single gloss, POS is best-effort.
  **To reconcile at productisation**: proofread POS (drives distractor quality)
  and glosses against a citable dictionary, and — importantly — against a
  **spoken-conversation** frequency list, since the Leeds source is an
  *internet/web* corpus, not a conversational one (register caveat below).

### band 1 rank verification (report only — no overwrite; needs 勝田 approval)

Cross-checked band 1's 1000 lemmas against the Leeds list (LINGO-013 task asked
for verification, not a rewrite):

- **399 / 1000** band-1 lemmas differ from their Leeds rank by **> 500** places;
  median |Δrank| ≈ 334, mean ≈ 764. **585 / 1000** sit inside Leeds' top-1000;
  **905 / 1000** inside Leeds' top-3000.
- **Direction of the skew**: band 1 **over-ranks concrete everyday/domestic
  vocabulary** — food (`рис`, `перец`, `картофель`, `салат`), clothing
  (`пальто`, `обувь`, `шляпа`), family (`племянник`) — and **omits grammatical /
  abstract high-frequency words** the corpus puts in the top-1000 (`то`, `ни`,
  `со`, `более`, `чем`, `иметь`, `сделать`) — which is why they surfaced at the
  *start* of band 2.
- **Caveat (don't over-read this as "band 1 is wrong")**: the two lists measure
  **different registers** — band 1 was authored as *conversational / practical
  everyday* vocab (the app's actual target: "会話頻出"), while Leeds is a *web
  corpus*. Some "divergence" is also lemmatisation/tokenisation artefact: the 12
  band-1 lemmas absent from Leeds' top-10000 are mostly hyphenated indefinite
  pronouns (`какой-то`, `кто-то`, `что-то`, `где-то`, `когда-то`, `всё-таки`) and
  multiword entries (`если бы`, `пока что`) that the Leeds cleanup split apart.
- **Recommendation**: before any band-1 rewrite, reconcile against a *spoken*
  Russian frequency list (OpenSubtitles / conversational corpus), not the
  internet corpus — the practical-everyday bias may actually be *correct* for a
  conversation app. Decision deferred to 勝田 (separate task).

## POS tagset

`pos` is one of: `noun verb adj adv pron prep conj part num intj det predic`.

- `part` = particle (не, же, бы, ли, ведь…)
- `det` = determiner / possessive / demonstrative (этот, весь, мой, каждый…)
- `predic` = predicative / modal (можно, нужно, надо, нельзя…)

POS accuracy matters: the quiz builds 4-choice distractors from the **same band
and same POS** as the answer (design §5.3). A mislabeled POS yields a bad
distractor. Band-1 pools: 424 nouns, 255 verbs, 121 adjectives, 91 adverbs, etc.

## Data source & limits (read before trusting the numbers)

- **Frequency list**: the band-1 order approximates the common spoken-Russian /
  OpenSubtitles frequency ranking from the generating model's knowledge. It was
  **not** copied from a specific published list, so:
  - `rank` is **approximate**, especially past the first few hundred. It is used
    only for band assignment and display ordering, never for anything exact.
  - There may be minor omissions of very common words. Two such gaps found and
    fixed during review: `она` (she) and `оно` (it) were missing and were added
    (replacing two low-value entries), so the file is still 1000 lines with
    unique ranks 1–1000.
  - A handful of common words are genuinely absent from the top-1000 list
    (e.g. `простой`, `прошлый`, `вернуть`); sentences using them simply don't
    tag them. Aspect/comparative variants are tagged to the lexeme present in
    the list (e.g. `прочитать`→`читать`, `меньше`→`мало`).
- **Glosses** are the most common sense only (single-word/short). Polysemy is
  not represented.
- **Sentences** are original, authored for this deck — not sourced from a
  corpus — to guarantee they stay within band-1 vocabulary and cover it densely.

For production (paid learner-facing content) these should be reconciled against
a citable frequency list (e.g. a published RU frequency dictionary) and given a
professional proofreading pass. For Phase-1 dogfood this quality is sufficient.
