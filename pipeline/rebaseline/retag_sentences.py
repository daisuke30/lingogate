#!/usr/bin/env python3
"""LINGO-020 工程4a — update each core sentence's band to match its
target_lemma's NEW band (per the LINGO-020 vocab rebaseline).

`Sentence.band` is inferred purely from the source FILENAME (see
import.py:band_from_filename / build-content.mjs:bandFromFilename — both use
the same `band(\\d+)` regex on the basename), not a per-line field. So "update
the band membership" = re-split the single sentences_band1_core.jsonl file
into per-band files by where its target_lemma now lives:
  sentences_band1_core.jsonl  (target_lemma in new words_band1.jsonl)
  sentences_band2_core.jsonl  (target_lemma in new words_band2.jsonl)
  sentences_band3_core.jsonl  (target_lemma in new words_band3.jsonl)
  sentences_band4_core.jsonl  (target_lemma retired to words_band4.jsonl)

Sentence text/ids are never touched or deleted (task requirement: "文は削除
しない") — only which file (=> which band) each line lives in changes. IDs
stay globally unique across the split (enforced by import.py's duplicate-id
check), so ReviewState (keyed by sentence id) survives untouched.

band4 sentences keep shipping in the SQLite/JSONL pipeline (so a learner who
already studied one keeps their FSRS history) but — like all `kind=sentence`
rows — the web build's LINGO-010 filter only keeps rows with a target_lemma,
which every core row has regardless of band; band4 core sentences will
therefore still appear to learners who have reviewed them before. They are
simply no longer offered as NEW cards once band 1-3 sourcing logic (session.ts)
scopes by band, since 4 is outside the normal 1-3 practice range.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def load_band_map():
    lemma_to_band = {}
    for b in (1, 2, 3, 4):
        with open(os.path.join(DATA, f"words_band{b}.jsonl"), encoding="utf-8") as f:
            for line in f:
                lemma_to_band[json.loads(line)["lemma"]] = b
    return lemma_to_band


def main():
    lemma_to_band = load_band_map()
    sentences = []
    with open(os.path.join(DATA, "sentences_band1_core.jsonl"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                sentences.append(json.loads(line))

    by_band = {1: [], 2: [], 3: [], 4: []}
    unresolved = []
    for s in sentences:
        tl = s["target_lemma"]
        b = lemma_to_band.get(tl)
        if b is None:
            unresolved.append((s["id"], tl))
            b = 1  # shouldn't happen; fail safe to band1 and flag loudly below
        by_band[b].append(s)

    if unresolved:
        print(f"WARNING: {len(unresolved)} sentences have a target_lemma not "
              f"found in ANY band file (data bug, needs investigation):")
        for sid, tl in unresolved[:20]:
            print(f"  {sid}: target_lemma={tl!r}")

    for b in (1, 2, 3, 4):
        path = os.path.join(DATA, f"sentences_band{b}_core.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for s in by_band[b]:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
        print(f"sentences_band{b}_core.jsonl: {len(by_band[b])} sentences")

    total = sum(len(v) for v in by_band.values())
    print(f"total: {total} (should equal input {len(sentences)})")
    assert total == len(sentences), "sentence count mismatch after retag!"


if __name__ == "__main__":
    main()
