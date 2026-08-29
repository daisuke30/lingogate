#!/usr/bin/env python3
"""Append core sentences to a data/sentences_band*_core.jsonl file.

Reads a JSON array of row objects from stdin and appends each as one JSONL
line (ensure_ascii=False). Skips any id already present in the target file so
re-running a batch after a disconnect is safe (idempotent by id).

Usage: python3 append_sentences.py <target_basename>  < batch.json
  e.g. python3 append_sentences.py sentences_band1_core.jsonl
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def main():
    target = os.path.join(DATA, sys.argv[1])
    rows = json.load(sys.stdin)
    existing = set()
    if os.path.exists(target):
        with open(target, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    existing.add(json.loads(line)["id"])
    added = 0
    with open(target, "a", encoding="utf-8") as f:
        for r in rows:
            if r["id"] in existing:
                continue
            r.setdefault("kind", "sentence")
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            added += 1
    print(f"appended {added} rows to {sys.argv[1]} ({len(rows)-added} skipped as dup)")


if __name__ == "__main__":
    main()
