#!/usr/bin/env python3
"""LINGO-043 — re-split all core sentences across sentences_band{1,2,3,4}_core.jsonl
by their target_lemma's CURRENT band, after normalize_bands_1000.py moved 49
words between bands. Same approach as LINGO-020's retag_sentences.py
(Sentence.band is inferred purely from which FILE a line lives in — see
import.py:band_from_filename / build-content.mjs:bandFromFilename — so
"retag" means physically moving JSONL lines between files, never touching
sentence text/ids). Generalized to read from all 4 files at once (LINGO-020's
version only had one input file to split).
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
    seen_ids = set()
    for b in (1, 2, 3, 4):
        path = os.path.join(DATA, f"sentences_band{b}_core.jsonl")
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                s = json.loads(line)
                if s["id"] in seen_ids:
                    raise SystemExit(f"duplicate sentence id across files: {s['id']!r}")
                seen_ids.add(s["id"])
                sentences.append(s)

    by_band = {1: [], 2: [], 3: [], 4: []}
    unresolved = []
    moved = 0
    for s in sentences:
        tl = s["target_lemma"]
        b = lemma_to_band.get(tl)
        if b is None:
            unresolved.append((s["id"], tl))
            b = 1
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
