#!/usr/bin/env python3
"""Print the transcription of given image(s) from notes_entries.jsonl, for
side-by-side self-review against the JPEG. Usage: python3 show.py IMG_xxxx ..."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JSONL = os.path.join(HERE, "..", "data", "notes", "notes_entries.jsonl")

want = set(sys.argv[1:])
rows = {}
with open(JSONL, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            o = json.loads(line)
            rows[o["image"]] = o

for img in sys.argv[1:]:
    o = rows.get(img)
    if not o:
        print(f"== {img}: NOT FOUND =="); continue
    print(f"== {img}  ({o['date_hint']}) ==")
    for i, e in enumerate(o["entries"], 1):
        print(f"  [{i}] {e.get('type')}")
        for k in ["ru", "en", "ja", "kana", "note"]:
            if e.get(k):
                print(f"        {k}: {e[k]}")
