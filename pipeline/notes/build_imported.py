#!/usr/bin/env python3
"""LINGO-009: turn transcribed notes into an importable sentence deck.

Reads   data/notes/notes_entries.jsonl   (one line per note image)
Writes  data/sentences_imported.jsonl    (source=imported, band 1)

Each entry becomes one Sentence row:
  - type "sentence" -> kind='sentence', ru/en/ja/kana/note as written
  - type "word"     -> kind='word' flashcard: ru=word, en=gloss, ja=gloss
                       (front = EN gloss, back = RU word; quiz stays EN->RU)
  - type "illegible"-> skipped, counted (never silently dropped)

Dedup (normalize = lowercase, ё->е, strip punctuation/space):
  - drop exact duplicates within the notes themselves (keep first)
  - drop any note sentence whose normalized RU already exists in the generated
    291-sentence deck (sentences_band1.jsonl) — those are already in the pool

Lemma links: best-effort match of RU tokens against words_band1 lemmas
(exact, plus a conservative stem-prefix match for inflected forms). Only lemmas
that exist in the words table are emitted, so import.py prints no unmatched
warnings for imported rows.

IDs: n0001.. assigned in chronological (date_hint, image) order so they are
stable across re-runs and never collide with the generated s001.. ids.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
NOTES = os.path.join(DATA, "notes", "notes_entries.jsonl")
GENERATED = os.path.join(DATA, "sentences_band1.jsonl")
WORDS = os.path.join(DATA, "words_band1.jsonl")
OUT = os.path.join(DATA, "sentences_imported.jsonl")

CYR = re.compile(r"[а-яёА-ЯЁ]+")


def norm(s):
    s = (s or "").lower().replace("ё", "е")
    return re.sub(r"[^a-zа-я0-9]+", " ", s).strip()


def load_generated_norms():
    seen = set()
    if os.path.exists(GENERATED):
        with open(GENERATED, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    seen.add(norm(json.loads(line)["ru"]))
    return seen


def load_lemmas():
    lemmas = []
    if os.path.exists(WORDS):
        with open(WORDS, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    lemmas.append(json.loads(line)["lemma"].strip())
    exact = {}
    for lm in lemmas:
        exact.setdefault(lm.lower().replace("ё", "е"), lm)
    return lemmas, exact


def match_lemmas(ru, lemmas, exact):
    """Best-effort: which band-1 lemmas does this RU sentence use?"""
    found = []
    seen = set()
    for tok in CYR.findall(ru):
        t = tok.lower().replace("ё", "е")
        hit = exact.get(t)
        if hit is None:
            # conservative stem-prefix: token is an inflection of a lemma
            best = None
            for ln, orig in exact.items():
                if len(ln) >= 4 and t.startswith(ln):
                    if best is None or len(ln) > len(best[0]):
                        best = (ln, orig)
            if best:
                hit = best[1]
        if hit and hit not in seen:
            seen.add(hit)
            found.append(hit)
    return found


def load_notes_sorted():
    records = []
    with open(NOTES, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    records.sort(key=lambda r: (r.get("date_hint", ""), r.get("image", "")))
    return records


def main():
    gen_norms = load_generated_norms()
    lemmas, exact = load_lemmas()
    records = load_notes_sorted()

    stats = {"images": len(records), "sentence": 0, "word": 0,
             "illegible": 0, "dup_in_notes": 0, "dup_vs_generated": 0,
             "skipped_incomplete": 0}
    seen_notes = set()
    newly_covered = set()
    already_covered_by_gen = None  # computed by import coverage, not here
    out_lines = []
    idx = 0

    for rec in records:
        for e in rec.get("entries", []):
            t = e.get("type", "sentence")
            if t == "illegible":
                stats["illegible"] += 1
                continue
            ru = (e.get("ru") or "").strip()
            en = (e.get("en") or "").strip()
            if t == "word":
                # flashcard: front = EN gloss, back = RU word
                ja = (e.get("ja") or en).strip()
                if not ru or not en:
                    stats["skipped_incomplete"] += 1
                    continue
                kind = "word"
            else:
                ja = (e.get("ja") or "").strip() or None
                kind = "sentence"
                if not ru or not en:
                    stats["skipped_incomplete"] += 1
                    continue
            key = norm(ru)
            if not key:
                stats["skipped_incomplete"] += 1
                continue
            if key in seen_notes:
                stats["dup_in_notes"] += 1
                continue
            if key in gen_norms:
                stats["dup_vs_generated"] += 1
                seen_notes.add(key)
                continue
            seen_notes.add(key)

            idx += 1
            sid = "n%04d" % idx
            lm = match_lemmas(ru, lemmas, exact)
            for x in lm:
                newly_covered.add(x)
            row = {"id": sid, "ru": ru, "en": en, "kind": kind,
                   "source": "imported", "difficulty": 1, "lemmas": lm}
            if ja:
                row["ja"] = ja
            if e.get("kana"):
                row["kana"] = e["kana"].strip()
            if e.get("note"):
                row["note"] = e["note"].strip()
            # keep a stable, readable key order
            ordered = {k: row[k] for k in
                       ["id", "ru", "en", "ja", "kana", "note", "kind",
                        "source", "difficulty", "lemmas"] if k in row}
            out_lines.append(json.dumps(ordered, ensure_ascii=False))
            stats[kind] += 1

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines) + ("\n" if out_lines else ""))

    print(f"wrote {len(out_lines)} rows -> {os.path.relpath(OUT)}")
    for k in ["images", "sentence", "word", "illegible", "dup_in_notes",
              "dup_vs_generated", "skipped_incomplete"]:
        print(f"  {k}: {stats[k]}")
    print(f"  band1 lemmas touched by imported rows: {len(newly_covered)}")


if __name__ == "__main__":
    main()
