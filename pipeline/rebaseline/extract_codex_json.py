#!/usr/bin/env python3
"""Extract the JSON array Codex produced from a raw `codex exec` transcript.

The transcript has: prompt echo (contains our own INPUT json), then a line
literally "codex", then the model's JSON response, then "tokens used" and a
duplicate echo. We take the text between the first "codex" line and the next
"tokens used" line.
"""
import json
import sys


def extract(path):
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    start = None
    end = None
    for i, line in enumerate(lines):
        if line.strip() == "codex" and start is None:
            start = i + 1
            continue
        if start is not None and line.strip() == "tokens used":
            end = i
            break
    if start is None or end is None:
        raise SystemExit(f"{path}: could not find codex/tokens-used markers")
    text = "".join(lines[start:end]).strip()
    return json.loads(text)


if __name__ == "__main__":
    data = extract(sys.argv[1])
    json.dump(data, sys.stdout, ensure_ascii=False, indent=1)
