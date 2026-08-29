#!/usr/bin/env python3
"""LINGO-022 工程3 — inflection-variation analysis over the core-sentence corpus.

For every core sentence (all sentences_band*_core.jsonl), tokenise the RU text,
map each surface token to (lemma, form-signature) via pymorphy3, and report,
per lemma that appears in 2+ sentences, how many DISTINCT surface forms it uses.

Two uses:
  * guidance while generating: `--lemma X` prints which forms of X are already
    spent so a new sentence can pick an unused case/number/tense/person.
  * measurement (task deliverable): the headline "variation rate" = of all
    lemmas appearing in >=2 core sentences, the share appearing in >=2 forms.

"Form" = the lowercased surface token itself (ё→е normalised), which is a
faithful proxy for a distinct inflected form (case/number/tense/person all
change the surface). We count over WRAPPING words too, not just targets.
"""
import argparse
import glob
import json
import os
import re
from collections import defaultdict

import pymorphy3

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
MORPH = pymorphy3.MorphAnalyzer()

TOKEN_RE = re.compile(r"[а-яёА-ЯЁ]+(?:-[а-яёА-ЯЁ]+)*")


def norm(s):
    return s.lower().replace("ё", "е")


def load_core(extra_files=None):
    rows = []
    files = sorted(glob.glob(os.path.join(DATA, "sentences_band*_core.jsonl")))
    for path in files:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    if extra_files:
        for path in extra_files:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rows.append(json.loads(line))
    return rows


def surface_to_lemma(tok):
    p = MORPH.parse(tok)[0]
    return norm(p.normal_form)


def build_map(rows):
    # lemma -> Counter(surface_form)
    forms = defaultdict(lambda: defaultdict(int))
    # which lemmas each sentence declares (authoritative), for pairing
    for s in rows:
        toks = TOKEN_RE.findall(s["ru"])
        declared = set(s.get("lemmas", []))
        for tok in toks:
            lem = surface_to_lemma(tok)
            # attribute to the declared lemma if the parse matches one, else raw
            key = lem
            for d in declared:
                if norm(d) == lem:
                    key = norm(d)
                    break
            forms[key][norm(tok)] += 1
    return forms


def variation_rate(forms):
    multi = {l: fs for l, fs in forms.items() if sum(fs.values()) >= 2}
    two_plus = {l: fs for l, fs in multi.items() if len(fs) >= 2}
    rate = (100.0 * len(two_plus) / len(multi)) if multi else 0.0
    return rate, len(two_plus), len(multi)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lemma", help="show spent surface forms for one lemma")
    ap.add_argument("--extra", nargs="*", help="extra jsonl files to include")
    ap.add_argument("--top", type=int, default=0, help="show N most-reused lemmas")
    args = ap.parse_args()
    rows = load_core(args.extra)
    forms = build_map(rows)
    if args.lemma:
        l = norm(args.lemma)
        fs = forms.get(l, {})
        print(f"{args.lemma}: {sum(fs.values())} uses, {len(fs)} distinct forms")
        for form, n in sorted(fs.items(), key=lambda x: -x[1]):
            print(f"  {form}  x{n}")
        return
    rate, tp, m = variation_rate(forms)
    print(f"core sentences analysed: {len(rows)}")
    print(f"lemmas appearing >=2x: {m}")
    print(f"  of those, appearing in >=2 forms: {tp}")
    print(f"VARIATION RATE: {rate:.1f}%")
    if args.top:
        reuse = sorted(((sum(fs.values()), len(fs), l) for l, fs in forms.items()),
                       reverse=True)[:args.top]
        print(f"\ntop {args.top} most-reused lemmas (uses, forms, lemma):")
        for uses, nf, l in reuse:
            print(f"  {uses:4} {nf:3}  {l}")


if __name__ == "__main__":
    main()
