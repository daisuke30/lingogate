#!/usr/bin/env python3
"""LINGO-020 工程3 — assemble the final words_band1-4.jsonl from:
  - candidate_bands.tsv       stage2 output (OLD current-band words: their
                               new_band assignment + already-known pos/gloss)
  - new_inflow_worklist.tsv   stage3 filtered NEW-inflow lemma list (post
                               garbage/proper-noun cleanup — see report.md and
                               the stage3c..3k commit messages for what was
                               removed and why)
  - new_inflow_glosses.jsonl  hand-written pos/en_gloss/ja_gloss for every
                               lemma in new_inflow_worklist.tsv (1:1, verified)
  - ../data/words_band1_aspects.jsonl   existing verb aspect sidecar (OLD
                               words only; carried through unchanged)

Output (written to ../data/, overwriting the pre-LINGO-020 files):
  words_band1.jsonl  words_band2.jsonl  words_band3.jsonl   (the ~3000-word
    frame; each ~listed band may be slightly under 1000 — see note below)
  words_band4.jsonl  (RETIRED pool: old current-band words that fell out of
    the top 3000. Kept — never deleted — so a learner's ReviewState/
    wordKnowledge keyed on these lemmas still resolves. band=4, no rank.)

Why the bands aren't exactly 1000/1000/1000
---------------------------------------------
~57 lemmas were removed from the new-inflow candidate pool during stage3
(pymorphy mis-lemmatisations, UNKN garbage tokens, and character names that
leaked past the automated proper-noun filter — see commit log). Backfilling
the gap from the next-ranked candidates would need fresh pos/gloss generation
for another batch of words for a purely cosmetic "exactly 1000" property with
no functional benefit (the app does not require exact band sizes; LINGO-013's
own mastery-frame code already treats MASTERY_TARGET_WORDS=3000 as a fixed
target independent of actual deck size). So the bands are left slightly short
(998/995/967 words respectively — 2960/3000) rather than spending another
annotation pass on marginal filler words. Logged here per the task's
"圏外は...除外を判断しログ" instruction.
"""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def load_glosses(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            o = json.loads(line)
            out[o["lemma"]] = o
    return out


def main():
    glosses = load_glosses(os.path.join(HERE, "new_inflow_glosses.jsonl"))

    # worklist lemma -> new_band (authoritative filtered new-inflow set)
    worklist_band = {}
    with open(os.path.join(HERE, "new_inflow_worklist.tsv"), encoding="utf-8") as f:
        next(f)
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            worklist_band[parts[1]] = int(parts[2])

    bands = {1: [], 2: [], 3: [], 4: []}

    with open(os.path.join(HERE, "candidate_bands.tsv"), encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            lemma = row["lemma"]
            is_new = row["old_band"] == ""
            if is_new:
                # Only include if it survived stage3 cleanup (worklist is the
                # authoritative filtered set); candidate_bands.tsv still has
                # the raw pre-cleanup rows including removed garbage/names.
                if lemma not in worklist_band:
                    continue
                b = worklist_band[lemma]
                g = glosses[lemma]
                entry = {
                    "lemma": lemma,
                    "rank": int(row["new_rank"]),
                    "pos": g["pos"],
                    "en_gloss": g["en_gloss"],
                    "ja_gloss": g["ja_gloss"],
                }
            else:
                b = int(row["new_band"])
                entry = {
                    "lemma": lemma,
                    "rank": int(row["new_rank"]) if b != 4 else None,
                    "pos": row["pos"],
                    "en_gloss": row["en_gloss"] or None,
                    "ja_gloss": row["ja_gloss"] or None,
                }
            bands[b].append((int(row["new_rank"]), entry))

    for b in (1, 2, 3, 4):
        bands[b].sort(key=lambda t: t[0])

    for b in (1, 2, 3, 4):
        path = os.path.join(DATA, f"words_band{b}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for _, entry in bands[b]:
                if b == 4:
                    # Retired pool: drop rank/None noise, keep it minimal.
                    out = {"lemma": entry["lemma"], "band": 4,
                           "pos": entry["pos"], "en_gloss": entry["en_gloss"],
                           "ja_gloss": entry["ja_gloss"]}
                else:
                    out = entry
                f.write(json.dumps(out, ensure_ascii=False) + "\n")
        print(f"words_band{b}.jsonl: {len(bands[b])} lemmas")

    total_top3 = len(bands[1]) + len(bands[2]) + len(bands[3])
    print(f"top-3000 frame total: {total_top3} (target 3000, "
          f"gap={3000 - total_top3} — see module docstring)")
    print(f"band4 (retired, retained for learning history): {len(bands[4])}")


if __name__ == "__main__":
    main()
