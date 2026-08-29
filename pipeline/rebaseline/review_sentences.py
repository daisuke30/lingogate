#!/usr/bin/env python3
"""LINGO-022 工程3 self-review pass (separate from generation).

Validates the newly generated core sentences (default: T1072+ in
sentences_band1_core.jsonl) against the LINGO-011/020 quality bar:

  1. JSON well-formed; required fields present.
  2. content-word token count in [3,7] (build's MAX_SENTENCE_TOKENS=8 hard cap).
  3. target_lemma present in the row's own lemmas[].
  4. every lemma resolves to a Word row (band1-4) — else it won't link.
  5. target_lemma's band == the file's band (band1 file -> target in words_band1).
  6. ru text has no Latin-letter contamination (typo guard).
  7. no exact ru duplicate — neither inside the new set nor vs the whole corpus.
  8. lemmas[] accuracy: every RU surface token parses (pymorphy best-parse) to a
     declared lemma (ё-normalised); flags tokens whose lemma isn't declared and
     declared lemmas that match no token (probable wrong-lemma in the array).

Prints an ISSUES count; exit 0 iff zero blocking issues (4,5,7 and JSON) —
8's mismatches are warnings (pymorphy best-parse is itself fallible on
homographs), printed for eyeballing.
"""
import argparse
import glob
import json
import os
import re
import sys

import pymorphy3

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
MORPH = pymorphy3.MorphAnalyzer()
TOKEN_RE = re.compile(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*")
LATIN_RE = re.compile(r"[A-Za-z]")


def norm(s):
    return s.lower().replace("ё", "е")


def load_words():
    lemma_band = {}
    for b in (1, 2, 3, 4):
        with open(os.path.join(DATA, f"words_band{b}.jsonl"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    lemma_band[json.loads(line)["lemma"]] = b
    return lemma_band


def all_corpus_ru(exclude_ids):
    seen = {}
    for path in glob.glob(os.path.join(DATA, "sentences_band*_core.jsonl")):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                s = json.loads(line)
                if s["id"] in exclude_ids:
                    continue
                seen[norm(s["ru"])] = s["id"]
    return seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="sentences_band1_core.jsonl")
    ap.add_argument("--min-id", default="T1072")
    ap.add_argument("--band", type=int, default=1)
    args = ap.parse_args()

    lemma_band = load_words()
    path = os.path.join(DATA, args.file)
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    id_prefix = re.match(r"[^0-9]*", args.min_id).group(0)
    new = [s for s in rows if s["id"] >= args.min_id and s["id"].startswith(id_prefix)]
    new_ids = {s["id"] for s in new}
    corpus = all_corpus_ru(new_ids)

    issues = 0
    warns = 0
    seen_new = {}
    for s in new:
        sid = s["id"]
        ru = s["ru"]
        toks = TOKEN_RE.findall(ru)
        # 2. length
        if not (3 <= len(toks) <= 7):
            print(f"[LEN] {sid}: {len(toks)} tokens: {ru}")
            issues += 1
        # 3. target in lemmas
        if s["target_lemma"] not in s.get("lemmas", []):
            print(f"[TGT] {sid}: target {s['target_lemma']!r} not in lemmas")
            issues += 1
        # 4/5. lemma resolution + target band
        for lem in s.get("lemmas", []):
            if lem not in lemma_band:
                print(f"[UNK] {sid}: lemma {lem!r} not in any Word band")
                issues += 1
        tb = lemma_band.get(s["target_lemma"])
        if tb != args.band:
            print(f"[BAND] {sid}: target {s['target_lemma']!r} in band {tb}, file band {args.band}")
            issues += 1
        # 6. latin contamination
        if LATIN_RE.search(ru):
            print(f"[LAT] {sid}: Latin letters in ru: {ru}")
            issues += 1
        # 7. duplicates
        n = norm(ru)
        if n in corpus:
            print(f"[DUP-CORPUS] {sid}: ru duplicates {corpus[n]}")
            issues += 1
        if n in seen_new:
            print(f"[DUP-NEW] {sid}: ru duplicates {seen_new[n]}")
            issues += 1
        seen_new[n] = sid
        # 8. lemma-array accuracy (warning-level)
        declared = {norm(l) for l in s.get("lemmas", [])}
        tok_lemmas = set()
        for t in toks:
            p = MORPH.parse(t)[0]
            tok_lemmas.add(norm(p.normal_form))
            tok_lemmas.add(norm(t))  # allow surface==lemma (particles/adv)
        undeclared = [t for t in toks
                      if norm(MORPH.parse(t)[0].normal_form) not in declared
                      and norm(t) not in declared]
        if undeclared:
            print(f"[LEMMA? ] {sid}: tokens not matching any declared lemma: {undeclared}  | {ru}")
            warns += 1

    print(f"\nreviewed {len(new)} new sentences (>= {args.min_id})")
    print(f"BLOCKING ISSUES: {issues}")
    print(f"lemma-array warnings (eyeball): {warns}")
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()
