#!/usr/bin/env python3
"""LINGO-056: machine validation for the word_dict / sentence_commentary
generation files. Run after every batch (or at least every 100 entries per
the task's protocol) to catch gaps/structural issues immediately rather than
by manual recount.

Checks:
  word_dict (ja/en):
    - every word in word_order.json (3000) has an entry in BOTH files
    - no duplicate lemmas, no extra lemmas not in word_order.json
    - required fields present and non-empty: pos, etymology, related (>=1),
      collocations (2-3), commonMistakes
    - forms present iff pos in {verb,noun,adj}, else null
    - verb forms have past{m,f,n,pl} + nonpast{1sg,2sg,3sg,1pl,2pl,3pl} +
      imperative{sg,pl} (imperative values may be "—" for defective verbs)
    - noun forms have sg{nom,gen,dat,acc,instr,prep}
    - adj forms have {m,f,n,pl}
    - aspectUsage present (non-null) iff pos == verb, cross-checked against
      words_aspects.jsonl: if that lemma has an aspect entry, aspectUsage
      must not be empty; flag (warning) if the aspect_pair lemma mentioned
      in words_aspects isn't referenced anywhere in aspectUsage text (loose
      heuristic, not a hard fail — phrasing varies).
  sentence_commentary (ja/en):
    - every sentence in sentence_order.json (2135) has an entry in BOTH files
    - skeleton non-empty, each item has surface+note
    - keyPoint non-empty
    - replies has 2-3 items, each with ru+gloss, ru non-empty and gloss non-empty

Usage:
  python3 validate_explain.py --words
  python3 validate_explain.py --sentences
  python3 validate_explain.py --all
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
EXPLAIN = os.path.join(DATA, "explain")

VERB_NONPAST_KEYS = {"1sg", "2sg", "3sg", "1pl", "2pl", "3pl"}
VERB_PAST_KEYS = {"m", "f", "n", "pl"}
NOUN_CASE_KEYS = {"nom", "gen", "dat", "acc", "instr", "prep"}
ADJ_GENDER_KEYS = {"m", "f", "n", "pl"}


def load_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def validate_words():
    order = json.load(open(os.path.join(EXPLAIN, "word_order.json"), encoding="utf-8"))
    pos_by_lemma = {w["lemma"]: w["pos"] for w in order}
    expected = {w["lemma"] for w in order}

    aspects = {}
    for line in open(os.path.join(DATA, "words_aspects.jsonl"), encoding="utf-8"):
        line = line.strip()
        if line:
            d = json.loads(line)
            aspects[d["lemma"]] = d

    errors = []
    warnings = []

    for lang in ("ja", "en"):
        path = os.path.join(EXPLAIN, f"word_dict_{lang}.jsonl")
        rows = load_jsonl(path)
        seen = {}
        for r in rows:
            lemma = r.get("lemma")
            if lemma in seen:
                errors.append(f"[{lang}] duplicate lemma: {lemma}")
            seen[lemma] = r
            if lemma not in expected:
                errors.append(f"[{lang}] unexpected lemma not in word_order.json: {lemma}")
                continue
            pos = pos_by_lemma[lemma]
            if r.get("pos") != pos:
                errors.append(f"[{lang}] {lemma}: pos mismatch (entry={r.get('pos')!r}, expected={pos!r})")
            for field in ("etymology", "commonMistakes"):
                v = r.get(field)
                if not v or not str(v).strip():
                    errors.append(f"[{lang}] {lemma}: missing/empty {field}")
            related = r.get("related")
            if not related or not isinstance(related, list) or len(related) < 1:
                errors.append(f"[{lang}] {lemma}: related must be a non-empty list")
            colloc = r.get("collocations")
            if not colloc or not isinstance(colloc, list) or not (2 <= len(colloc) <= 3):
                errors.append(f"[{lang}] {lemma}: collocations must have 2-3 items (got {colloc})")

            forms = r.get("forms")
            if pos in ("verb", "noun", "adj"):
                if forms is None:
                    errors.append(f"[{lang}] {lemma}: forms is null but pos={pos} requires forms")
                elif pos == "verb":
                    past = forms.get("past") or {}
                    nonpast = forms.get("nonpast") or {}
                    imper = forms.get("imperative") or {}
                    if set(past.keys()) != VERB_PAST_KEYS:
                        errors.append(f"[{lang}] {lemma}: verb past keys {sorted(past.keys())} != {sorted(VERB_PAST_KEYS)}")
                    if set(nonpast.keys()) != VERB_NONPAST_KEYS:
                        errors.append(f"[{lang}] {lemma}: verb nonpast keys {sorted(nonpast.keys())} != {sorted(VERB_NONPAST_KEYS)}")
                    if set(imper.keys()) != {"sg", "pl"}:
                        errors.append(f"[{lang}] {lemma}: verb imperative keys {sorted(imper.keys())} != ['sg','pl']")
                elif pos == "noun":
                    sg = forms.get("sg") or {}
                    if set(sg.keys()) != NOUN_CASE_KEYS:
                        errors.append(f"[{lang}] {lemma}: noun sg keys {sorted(sg.keys())} != {sorted(NOUN_CASE_KEYS)}")
                elif pos == "adj":
                    if set(forms.keys()) != ADJ_GENDER_KEYS:
                        errors.append(f"[{lang}] {lemma}: adj form keys {sorted(forms.keys())} != {sorted(ADJ_GENDER_KEYS)}")
            else:
                if forms is not None:
                    errors.append(f"[{lang}] {lemma}: pos={pos} should have forms=null, got {forms!r}")

            aspect_usage = r.get("aspectUsage")
            if pos == "verb":
                if not aspect_usage or not str(aspect_usage).strip():
                    errors.append(f"[{lang}] {lemma}: verb missing aspectUsage")
                a = aspects.get(lemma)
                if a and a.get("aspect_pair") and aspect_usage:
                    pair = a["aspect_pair"]
                    if pair not in aspect_usage:
                        warnings.append(f"[{lang}] {lemma}: aspect_pair {pair!r} (from words_aspects.jsonl) not mentioned in aspectUsage text")
            else:
                if aspect_usage is not None:
                    errors.append(f"[{lang}] {lemma}: pos={pos} should have aspectUsage=null, got {aspect_usage!r}")

        missing = expected - set(seen.keys())
        if missing:
            errors.append(f"[{lang}] {len(missing)} words from word_order.json missing entirely (first 10): {sorted(missing)[:10]}")

    if errors:
        print(f"WORD_DICT ERRORS: {len(errors)}")
        for e in errors[:60]:
            print(" ", e)
        if len(errors) > 60:
            print(f"  ...and {len(errors)-60} more")
    else:
        print("WORD_DICT: no errors")
    if warnings:
        print(f"WORD_DICT WARNINGS: {len(warnings)} (showing first 20)")
        for w in warnings[:20]:
            print(" ", w)
    ja_count = len(load_jsonl(os.path.join(EXPLAIN, "word_dict_ja.jsonl")))
    en_count = len(load_jsonl(os.path.join(EXPLAIN, "word_dict_en.jsonl")))
    print(f"progress: ja={ja_count}/3000 en={en_count}/3000")
    return len(errors) == 0


def validate_sentences():
    order = json.load(open(os.path.join(EXPLAIN, "sentence_order.json"), encoding="utf-8"))
    expected = {s["id"] for s in order}
    ru_by_id = {s["id"]: s["ru"] for s in order}

    errors = []
    for lang in ("ja", "en"):
        path = os.path.join(EXPLAIN, f"sentence_commentary_{lang}.jsonl")
        rows = load_jsonl(path)
        seen = {}
        for r in rows:
            sid = r.get("id")
            if sid in seen:
                errors.append(f"[{lang}] duplicate id: {sid}")
            seen[sid] = r
            if sid not in expected:
                errors.append(f"[{lang}] unexpected id not in sentence_order.json: {sid}")
                continue
            skeleton = r.get("skeleton")
            if not skeleton or not isinstance(skeleton, list):
                errors.append(f"[{lang}] {sid}: skeleton empty/missing")
            else:
                for item in skeleton:
                    if not item.get("surface") or not item.get("note"):
                        errors.append(f"[{lang}] {sid}: skeleton item missing surface/note: {item}")
            if not r.get("keyPoint") or not str(r.get("keyPoint")).strip():
                errors.append(f"[{lang}] {sid}: missing keyPoint")
            replies = r.get("replies")
            if not replies or not (2 <= len(replies) <= 3):
                errors.append(f"[{lang}] {sid}: replies must have 2-3 items (got {len(replies) if replies else 0})")
            else:
                for rep in replies:
                    if not rep.get("ru") or not rep.get("gloss"):
                        errors.append(f"[{lang}] {sid}: reply missing ru/gloss: {rep}")

        missing = expected - set(seen.keys())
        if missing:
            errors.append(f"[{lang}] {len(missing)} sentences missing entirely (first 10): {sorted(missing)[:10]}")

    if errors:
        print(f"SENTENCE_COMMENTARY ERRORS: {len(errors)}")
        for e in errors[:60]:
            print(" ", e)
        if len(errors) > 60:
            print(f"  ...and {len(errors)-60} more")
    else:
        print("SENTENCE_COMMENTARY: no errors")
    ja_count = len(load_jsonl(os.path.join(EXPLAIN, "sentence_commentary_ja.jsonl")))
    en_count = len(load_jsonl(os.path.join(EXPLAIN, "sentence_commentary_en.jsonl")))
    print(f"progress: ja={ja_count}/2135 en={en_count}/2135")
    return len(errors) == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--words", action="store_true")
    ap.add_argument("--sentences", action="store_true")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    ok = True
    if args.words or args.all or not (args.words or args.sentences):
        ok = validate_words() and ok
    if args.sentences or args.all:
        ok = validate_sentences() and ok
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
