#!/usr/bin/env python3
"""LINGO-069: ingest one generated batch (sentences + ja/en commentary together).

The whole point of taking both in one file is the task's hard rule: never
leave a sentence that has no commentary. A batch is accepted only if every
row carries both, and the four destination files are updated in one go:

  data/sentences_band{2,3}_core.jsonl      the core sentence
  data/explain/sentence_commentary_ja.jsonl
  data/explain/sentence_commentary_en.jsonl
  data/explain/sentence_order.json         APPEND-only (existing 2135 entries
                                           keep their indices, because
                                           manifest.json's v2 cursors point
                                           into this list)

Then lingo069_batch.py's disk-derived cursors are recomputed into
lingo069_manifest.json. Every write is idempotent by id, so re-running a batch
after a disconnect (or running a batch twice) is safe.

Batch file shape — a JSON array of:
  {
    "id": "B4001", "band": 2,
    "ru": "...", "en": "...", "ja": "...",
    "lemmas": ["..."], "target_lemma": "...", "difficulty": 1,
    "note": "...", "note_en": "...", "note_ru": "...",   # all optional
    "commentary": {"ja": {...v1+v2 fields...}, "en": {...}}
  }

Usage: python3 lingo069_ingest.py <batch.json>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "data"))
EXPLAIN = os.path.join(DATA, "explain")
PLAN = os.path.join(HERE, "lingo069_plan.json")

SENT_KEYS = ("id", "ru", "en", "ja", "lemmas", "target_lemma", "difficulty",
             "kind", "note", "note_en", "note_ru")
BAND_FILE = {2: "sentences_band2_core.jsonl", 3: "sentences_band3_core.jsonl"}


def load_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def append_jsonl(path, rows):
    """Append rows whose id is not already in the file. Returns (added, skipped)."""
    existing = {r["id"] for r in load_jsonl(path)}
    added = 0
    with open(path, "a", encoding="utf-8") as fh:
        for r in rows:
            if r["id"] in existing:
                continue
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
            existing.add(r["id"])
            added += 1
    return added, len(rows) - added


def main():
    batch = json.load(open(sys.argv[1], encoding="utf-8"))
    plan = {r["id"]: r for r in json.load(open(PLAN, encoding="utf-8"))}

    # --- reject the batch outright rather than half-ingesting it ---
    problems = []
    for r in batch:
        sid = r.get("id")
        if sid not in plan:
            problems.append(f"{sid}: not in lingo069_plan.json")
            continue
        p = plan[sid]
        if r.get("target_lemma") != p["lemma"]:
            problems.append(f"{sid}: target_lemma {r.get('target_lemma')!r} != planned {p['lemma']!r}")
        if r.get("band") != p["band"]:
            problems.append(f"{sid}: band {r.get('band')} != planned {p['band']}")
        for f in ("ru", "en", "ja", "lemmas"):
            if not r.get(f):
                problems.append(f"{sid}: missing {f}")
        if p["lemma"] not in (r.get("lemmas") or []):
            problems.append(f"{sid}: target_lemma not listed in lemmas[]")
        c = r.get("commentary") or {}
        for lang in ("ja", "en"):
            e = c.get(lang)
            if not e:
                problems.append(f"{sid}: commentary.{lang} missing "
                                "(a sentence without commentary is not accepted)")
                continue
            for f in ("skeleton", "keyPoint", "replies", "grammarFocus",
                      "variations", "paraphrases", "takeaway"):
                if not e.get(f):
                    problems.append(f"{sid}: commentary.{lang}.{f} missing")
    if problems:
        print(f"BATCH REJECTED — {len(problems)} problems, nothing written:")
        for p in problems[:40]:
            print("  ", p)
        sys.exit(1)

    # --- sentences ---
    tot_s = 0
    for band, fname in BAND_FILE.items():
        rows = []
        for r in batch:
            if r["band"] != band:
                continue
            row = {k: r[k] for k in SENT_KEYS if r.get(k) is not None}
            row.setdefault("difficulty", 1)
            row.setdefault("kind", "sentence")
            rows.append(row)
        if rows:
            a, s = append_jsonl(os.path.join(DATA, fname), rows)
            print(f"{fname}: +{a} ({s} already present)")
            tot_s += a

    # --- commentary ---
    for lang in ("ja", "en"):
        rows = []
        for r in batch:
            e = dict(r["commentary"][lang])
            e["id"] = r["id"]
            # keep key order stable with the existing corpus: v1 first
            ordered = {k: e[k] for k in
                       ("id", "skeleton", "keyPoint", "replies", "grammarFocus",
                        "variations", "paraphrases", "takeaway") if k in e}
            ordered.update({k: v for k, v in e.items() if k not in ordered})
            rows.append(ordered)
        a, s = append_jsonl(os.path.join(EXPLAIN, f"sentence_commentary_{lang}.jsonl"), rows)
        print(f"sentence_commentary_{lang}.jsonl: +{a} ({s} already present)")

    # --- sentence_order.json (append-only) ---
    order_path = os.path.join(EXPLAIN, "sentence_order.json")
    order = json.load(open(order_path, encoding="utf-8"))
    have = {s["id"] for s in order}
    added = 0
    for r in batch:
        if r["id"] in have:
            continue
        order.append({"id": r["id"], "ru": r["ru"],
                      "target_lemma": r["target_lemma"],
                      "lemmas": r["lemmas"], "band": r["band"]})
        have.add(r["id"])
        added += 1
    if added:
        tmp = order_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(order, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, order_path)
    print(f"sentence_order.json: +{added} (now {len(order)})")

    os.system(f'python3 {os.path.join(HERE, "lingo069_batch.py")} bump')


if __name__ == "__main__":
    main()
