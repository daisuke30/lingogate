#!/usr/bin/env python3
"""LINGO-025: render data/words_aspects.jsonl as compact, groupable text for
the mandatory full manual read-through (Katsuta: verb aspect errors are the
highest-harm error class, take the time).

Usage:
  render_review.py --kind none      # all pair_kind=none rows
  render_review.py --kind related   # all pair_kind=related rows
  render_review.py --kind pair      # all pair_kind=pair rows (spot-check)
  render_review.py --kind both      # aspect="both" rows
  render_review.py --grep свобод    # substring filter on lemma
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def load_glosses():
    g = {}
    for b in (1, 2, 3, 4):
        with open(os.path.join(DATA, f"words_band{b}.jsonl"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    w = json.loads(line)
                    g[w["lemma"]] = (w.get("en_gloss"), w.get("ja_gloss"), b)
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["pair", "related", "none", "both"])
    ap.add_argument("--grep")
    args = ap.parse_args()

    gloss = load_glosses()
    rows = []
    with open(os.path.join(DATA, "words_aspects.jsonl"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))

    if args.kind == "both":
        rows = [r for r in rows if r["aspect"] == "both"]
    elif args.kind:
        rows = [r for r in rows if r["pair_kind"] == args.kind]
    if args.grep:
        rows = [r for r in rows if args.grep in r["lemma"]]

    for r in rows:
        en, ja, b = gloss.get(r["lemma"], (None, None, "?"))
        note = f"  | {r['pair_note']}" if r.get("pair_note") else ""
        pair = f" -> {r['aspect_pair']}" if r.get("aspect_pair") else ""
        print(f"b{b} {r['lemma']:16} [{r['aspect']:4}/{r['pair_kind']:7}]{pair:22} {en}/{ja}{note}")
    print(f"\n{len(rows)} rows")


if __name__ == "__main__":
    main()
