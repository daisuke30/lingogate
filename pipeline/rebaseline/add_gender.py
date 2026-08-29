#!/usr/bin/env python3
"""LINGO-022 工程1 — assign grammatical gender to every RU noun lemma.

Reads ../data/words_band{1,2,3,4}.jsonl, and for each row whose pos == "noun"
adds a `gender` field:
  m  — masculine       (masc)
  f  — feminine        (femn)
  n  — neuter          (neut)
  pl — pluralia tantum (plural-only noun: деньги, ножницы, часы, каникулы)
  mf — common gender   (Ms-f: коллега, сирота — takes m or f agreement by referent)

Non-noun rows are left untouched (no gender field). Idempotent: rewrites the
same value on re-run. Uses pymorphy3 (rebaseline/.venv).

Tricky lemmas (soft-sign endings, indeclinables, pluralia tantum, common
gender, and anything pymorphy can't parse) are written to gender_review.tsv
for human check — pymorphy's single-best parse is unreliable exactly there.
"""
import json
import os
import sys

import pymorphy3

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

MORPH = pymorphy3.MorphAnalyzer()

# Hand-verified overrides for lemmas pymorphy gets wrong or can't parse.
# (Filled in after the first review pass — see LINGO-022 task log.)
OVERRIDES = {
    # pymorphy tags кофе/виски "Ms-f" (masc/neut colloquial variance), NOT the
    # person-referent common gender our "mf" code means. Prescriptive: masculine.
    "кофе": "m",
    "виски": "m",
    # True common-gender nouns (masc-or-femn agreement by referent):
    "убийца": "mf",
    "судья": "mf",
    "коллега": "mf",
    "одиночка": "mf",
    "дорогуша": "mf",
    "саша": "mf",  # given name, either sex
    # Indeclinable / unparsed forms of address — feminine:
    "мэм": "f",
    "ма": "f",
    "малышка": "f",  # feminine diminutive
    # глава: primary sense here is 章 "chapter" (feminine); the leader sense is
    # common gender but the gloss/ja fixes the chapter reading.
    "глава": "f",
    # Substantivized adjectives pymorphy parses as ADJ, not NOUN:
    "выпускной": "m",  # выпускной (бал/вечер) = prom, masculine
    "прочее": "n",     # "the rest" — neuter substantive
    # Plural-form-lemma / ё-normalised lemmas pymorphy mis-singularised
    # (found by the plural-form-noun audit, not the soft-sign/Fixd flags):
    "деньги": "pl",    # money — pluralia tantum; pymorphy found archaic sg деньга
    "черт": "m",       # = чёрт "devil" (ё→е normalised); misread as gen.pl of черта
    "коп": "m",        # cop — misread as gen.pl of копа
    "снимок": "m",     # photo (снимок/снимка) — masculine
    "десяток": "m",    # a ten/dozen (десяток/десятка) — masculine
}


def detect_gender(lemma):
    """Return (gender_code, reason, needs_review) for a noun lemma."""
    if lemma in OVERRIDES:
        return OVERRIDES[lemma], "override", False
    parses = [p for p in MORPH.parse(lemma) if p.tag.POS == "NOUN"]
    if not parses:
        return None, "no-noun-parse", True
    p = parses[0]
    g = p.tag.grammemes
    needs_review = False
    # pluralia tantum
    if "Pltm" in g:
        return "pl", "Pltm", False
    # common gender (masc-or-femn by referent)
    if "Ms-f" in g:
        return "mf", "Ms-f", False
    # plural-only with no gender assigned (ножницы: GNdr, Pltm sometimes absent)
    if p.tag.gender is None and p.tag.number == "plur":
        return "pl", "no-gender-plural", True
    gmap = {"masc": "m", "femn": "f", "neut": "n"}
    code = gmap.get(p.tag.gender)
    if code is None:
        return None, f"unknown-gender:{p.tag.gender}", True
    # Flag likely-ambiguous shapes for review even when pymorphy is confident:
    #   - soft-sign endings (м/ж split: день vs ночь)
    #   - indeclinable loanwords (Fixd: кофе, такси, метро)
    if lemma.endswith(("ь", "ь".upper())):
        needs_review = True
    if "Fixd" in g:
        needs_review = True
    return code, p.tag.gender, needs_review


def main():
    review = []
    counts = {"m": 0, "f": 0, "n": 0, "pl": 0, "mf": 0, None: 0}
    total_nouns = 0
    for b in (1, 2, 3, 4):
        path = os.path.join(DATA, f"words_band{b}.jsonl")
        rows = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
        for w in rows:
            if w.get("pos") != "noun":
                w.pop("gender", None)  # keep non-nouns clean/idempotent
                continue
            total_nouns += 1
            code, reason, needs_review = detect_gender(w["lemma"])
            if code is None:
                w.pop("gender", None)
            else:
                w["gender"] = code
            counts[code] = counts.get(code, 0) + 1
            if needs_review or code is None:
                review.append((b, w["lemma"], code, reason))
        with open(path, "w", encoding="utf-8") as f:
            for w in rows:
                f.write(json.dumps(w, ensure_ascii=False) + "\n")

    review_path = os.path.join(HERE, "gender_review.tsv")
    with open(review_path, "w", encoding="utf-8") as f:
        f.write("band\tlemma\tgender\treason\n")
        for row in review:
            f.write("\t".join(str(x) for x in row) + "\n")

    print(f"nouns processed: {total_nouns}")
    print("gender counts:", {k: v for k, v in counts.items() if v})
    print(f"flagged for review: {len(review)} -> {review_path}")


if __name__ == "__main__":
    main()
