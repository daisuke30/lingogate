#!/usr/bin/env python3
"""LINGO-049 Phase A: mechanically fix every audit_lemma_links.py issue whose
lemma is ALREADY registered in the Word table (words_band1-4.jsonl) — just
missing from that sentence's own `lemmas` array. Purely additive (appends
the missing lemma to `lemmas`, preserving every existing entry/order/other
field), so it can only improve linking, never regress an existing correct
link. New-lemma issues (word not yet in the Word table at all) are left
untouched here — those need pipeline/rebaseline/add_missing_words.py first,
then a second pass of this script (or just re-run after words_band*.jsonl is
updated: the same sentence's `lemmas` array gets the new lemma appended in
that second pass, since it's now "in_word_table").

Dry-run by default; --write to actually rewrite the sentence files.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lemma_links import (  # noqa: E402
    SOURCE_FILES, DATA, audit_sentence, load_all_known_lemmas,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    known_lemmas = load_all_known_lemmas()

    total_fixed = 0
    total_files = 0
    for fname in SOURCE_FILES:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        rows = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))

        changed = False
        for s in rows:
            issues = audit_sentence(s, known_lemmas)
            to_add = [i["lemma"] for i in issues if i["in_word_table"]]
            if not to_add:
                continue
            lemmas = s.setdefault("lemmas", [])
            existing = set(lemmas)
            for lemma in to_add:
                if lemma not in existing:
                    lemmas.append(lemma)
                    existing.add(lemma)
                    total_fixed += 1
                    changed = True

        if changed:
            total_files += 1
            if args.write:
                with open(path, "w", encoding="utf-8") as f:
                    for s in rows:
                        f.write(json.dumps(s, ensure_ascii=False) + "\n")

    print(f"fixed {total_fixed} lemma links across {total_files} files"
          f"{'' if args.write else ' (dry run — pass --write to apply)'}")


if __name__ == "__main__":
    main()
