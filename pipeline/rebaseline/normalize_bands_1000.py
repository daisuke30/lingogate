#!/usr/bin/env python3
"""LINGO-043: normalize RU words_band1-3.jsonl to exactly 1000/1000/1000
words each (currently 998/995/967 — see rebaseline/assemble_words.py's
docstring for why LINGO-020 left them short).

Telescoping plan (Katsuta's explicit instruction, 2026-09-11): band1's
2-word gap is filled from the TOP of band2 (by band2's own existing rank
order — that order already encodes LINGO-020's editorial judgement, e.g.
ТРКИ boosts / raw-surface-fallback promotions, and is NOT re-derived from
scratch); band2's resulting gap is filled from the top of band3; band3's
resulting gap is filled from the top of band4 (the retirement pool), using
band4 words' ORIGINAL candidate_bands.tsv new_rank as the recovery-priority
order (band4 itself carries no rank field). Total word count is conserved
(3819 across band1-4 throughout) — nothing is invented or deleted, only
reshuffled and renumbered.

After reshuffling, every band1-3 word's `rank` is renumbered to a clean,
contiguous 1..1000 / 1001..2000 / 2001..3000 sequence (sorted by each word's
PRE-reshuffle rank — band4 words use their candidate_bands.tsv new_rank for
this sort — so relative frequency order is preserved, just gap-free).

Run with --write to actually rewrite the four words_band*.jsonl files
(default is a dry-run report only).
"""
import argparse
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def load_band(b):
    path = os.path.join(DATA, f"words_band{b}.jsonl")
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def load_candidate_ranks():
    ranks = {}
    with open(os.path.join(HERE, "candidate_bands.tsv"), encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            ranks[row["lemma"]] = int(row["new_rank"])
    return ranks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    band1 = load_band(1)
    band2 = load_band(2)
    band3 = load_band(3)
    band4 = load_band(4)
    cb_rank = load_candidate_ranks()

    orig_counts = (len(band1), len(band2), len(band3), len(band4))
    total_before = sum(orig_counts)

    band2_sorted = sorted(band2, key=lambda w: w["rank"])
    band3_sorted = sorted(band3, key=lambda w: w["rank"])
    band4_sorted = sorted(band4, key=lambda w: cb_rank.get(w["lemma"], 10**9))

    need1 = 1000 - len(band1)
    promote_to_1 = band2_sorted[:need1]
    band2_remain = band2_sorted[need1:]

    need2 = 1000 - len(band2_remain)
    promote_to_2 = band3_sorted[:need2]
    band3_remain = band3_sorted[need2:]

    need3 = 1000 - len(band3_remain)
    promote_to_3 = band4_sorted[:need3]
    band4_remain = band4_sorted[need3:]

    new_band1 = band1 + promote_to_1
    new_band2 = band2_remain + promote_to_2
    new_band3 = band3_remain + promote_to_3
    new_band4 = band4_remain

    assert len(new_band1) == 1000, len(new_band1)
    assert len(new_band2) == 1000, len(new_band2)
    assert len(new_band3) == 1000, len(new_band3)

    def sort_key(w):
        return w.get("rank") if w.get("rank") is not None else cb_rank.get(w["lemma"], 10**9)

    new_band1.sort(key=sort_key)
    new_band2.sort(key=sort_key)
    new_band3.sort(key=sort_key)

    moves = {
        "band2->band1": [w["lemma"] for w in promote_to_1],
        "band3->band2": [w["lemma"] for w in promote_to_2],
        "band4->band3": [w["lemma"] for w in promote_to_3],
    }

    # Renumber rank 1..1000 / 1001..2000 / 2001..3000, drop stale fields on
    # promoted-from-band4 entries (band/rank absent there) and add fresh ones.
    out_bands = {1: new_band1, 2: new_band2, 3: new_band3}
    offset = {1: 0, 2: 1000, 3: 2000}
    for b, words in out_bands.items():
        for i, w in enumerate(words, start=1):
            w["rank"] = offset[b] + i
            w.pop("band", None)  # band1-3 files don't carry a band field (implicit via filename)

    for w in new_band4:
        w.pop("rank", None)
        w["band"] = 4

    total_after = len(new_band1) + len(new_band2) + len(new_band3) + len(new_band4)

    print(f"before: band1={orig_counts[0]} band2={orig_counts[1]} band3={orig_counts[2]} band4={orig_counts[3]} (total {total_before})")
    print(f"after:  band1={len(new_band1)} band2={len(new_band2)} band3={len(new_band3)} band4={len(new_band4)} (total {total_after})")
    assert total_before == total_after, "word count not conserved!"
    for k, v in moves.items():
        print(f"{k} ({len(v)}): {v}")

    if args.write:
        for b, words in ((1, new_band1), (2, new_band2), (3, new_band3), (4, new_band4)):
            path = os.path.join(DATA, f"words_band{b}.jsonl")
            with open(path, "w", encoding="utf-8") as f:
                for w in words:
                    f.write(json.dumps(w, ensure_ascii=False) + "\n")
        print("\nwrote words_band1-4.jsonl")
    else:
        print("\n(dry run — pass --write to apply)")

    # Emit the moved-lemma list as JSON for downstream scripts (sentence retag
    # + core-sentence-gap check) to consume without re-deriving it.
    moved_path = os.path.join(HERE, "band_moves.json")
    with open(moved_path, "w", encoding="utf-8") as f:
        json.dump(moves, f, ensure_ascii=False, indent=2)
    print(f"wrote {moved_path}")


if __name__ == "__main__":
    main()
