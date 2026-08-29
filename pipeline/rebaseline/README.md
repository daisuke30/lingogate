# LINGO-020 — RU vocab band1-3 re-baseline (spoken-frequency)

Rebuilds the 3000-word RU deck against **spoken** Russian frequency (film/TV
subtitles), the register the app actually targets ("会話頻出3000語"), replacing the
LINGO-013 baseline that leaned on the Leeds **web** corpus. Everything here is a
reproducible, crash-tolerant pipeline: each stage writes an intermediate file
that is committed, so a re-run (or a fresh agent) resumes from the last commit.

## Provenance & license (the part to trust / distrust deliberately)

- **Spoken frequency source**: `ru_50k.txt` — the 50 000 most frequent Russian
  word forms from **hermitdave/FrequencyWords**, built from the **OpenSubtitles
  2018** corpus (opensubtitles.org film/TV subtitles).
  - Repo: <https://github.com/hermitdave/FrequencyWords> · file:
    `content/2018/ru/ru_50k.txt`. **License: MIT** (see the repo LICENSE;
    underlying subtitle text © their respective authors, aggregated counts only).
  - This is a **spoken/conversational** register — the correct axis for this app,
    and the one LINGO-013 explicitly deferred to a later task (that task = this).
  - Format: `<surface_form> <count>`, one per line, already frequency-descending.
    It is **surface forms** (inflected), not lemmas — hence the aggregation step.

- **ТРКИ B1 boost list**: `trki_b1_core.txt` — a curated set of lexemes on the
  ТРКИ / TORFL B1 (Первый сертификационный уровень) lexical minimum that are
  *core spoken vocabulary* and must not fall out of the deck on a frequency
  wobble. Public machine-readable full B1 minimums were not reliably fetchable in
  this environment, so this list is **authored from knowledge** of the ТРКИ B1
  minimum and clearly marked as such (register: everyday/practical, not web).
  It is used only as a **tie-breaker/boost**, never to override the subtitle rank.

## Stages (each stage commits)

1. **fetch + aggregate** (`fetch.sh`, `lemmatize.py`)
   - `fetch.sh` downloads `ru_50k.txt`.
   - `lemmatize.py` collapses surface forms → lemmas with **pymorphy3**
     (`.venv`, gitignored) summing counts, and writes `subtitle_lemma_freq.tsv`
     (`rank<TAB>lemma<TAB>count`). Verifies the top-30 contains the function
     words в/и/с/у/а/о (the previous agent's single-letter-noise bug regression
     test).
2. **3-way reconcile** (`reconcile.py`) — subtitle lemma rank (primary axis) +
   ТРКИ-B1 boost + current band1 placement → `candidate_bands.tsv` + a change
   report (`report.md`): top-30, band1 retention rate, dropped/added lists.
3. **assemble vocab** (`assemble_words.py`) — new `words_band1-3.jsonl`
   (pos/gloss/aspect carried from the existing 3000 by lemma; only genuinely new
   inflowing lemmas need fresh annotation) + `words_band4.jsonl` (see below).
4. **core sentences** — retag existing `T####` target_lemma band membership;
   generate core sentences for new band1 words lacking one.

## Limits (read before trusting the numbers)

- **Lemmatisation is single-best-parse.** pymorphy3 returns the most probable
  analysis per surface form; genuine context homographs (e.g. `стали` = сталь /
  стать) are attributed to one lemma only. Fine for a top-3000 ranking, not for
  exact counts.
- **ё normalisation.** Lemmas are kept as pymorphy returns them; matching against
  the band lists ё→е-normalises so `всё`/`все`, `её`/`ее` reconcile.
- **Aspect pairs are distinct lemmas.** pymorphy lemmatises `прочитала`→`прочитать`
  (not `читать`), so perfective/imperfective partners rank separately — matches
  how the band lists and the aspect sidecar already treat them.
- The subtitle corpus over-weights dialogue interjections/profanity vs. a
  textbook; the ТРКИ-B1 boost is what keeps neutral everyday vocab from being
  displaced by them.

## words_band4.jsonl — retired-but-retained (learning-history safety)

Lemmas that were in the old band1-3 (3000) but fall outside the new top-3000 are
**not deleted**. They are written to `../data/words_band4.jsonl` so the existing
`words_band<N>.jsonl` glob in both `import.py` and `build-content.mjs` keeps them
in the Word table and the shipped deck — a learner's `ReviewState`/wordKnowledge
keyed on those lemmas therefore never dangles. They carry `band:4` and no rank so
they are excluded from the "会話頻出3000語" mastery frame (mastery is scoped to
band ≤ 3). Rationale logged in `report.md`.
