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


def _flatten_forms(forms):
    """verb forms -> {'past.m': 'казался', 'nonpast.3sg': 'кажется', ...},
    skipping defective slots marked '—'."""
    out = {}
    for group in ("past", "nonpast", "imperative"):
        sub = forms.get(group) or {}
        for k, v in sub.items():
            if v and v != "—":
                out[f"{group}.{k}"] = v
    return out


def validate_v2_words():
    """LINGO-059: structural check of the v2 verb-enrichment fields
    (governance/aspectExamples/synonymComparison/formExamples). Incremental —
    a verb with none of these yet is not an error, only uncounted toward
    progress. Once a verb has ANY v2 field, its v2 structure must be complete."""
    order = json.load(open(os.path.join(EXPLAIN, "word_order.json"), encoding="utf-8"))
    pos_by_lemma = {w["lemma"]: w["pos"] for w in order}
    verb_lemmas = {lemma for lemma, pos in pos_by_lemma.items() if pos == "verb"}

    errors = []
    for lang in ("ja", "en"):
        path = os.path.join(EXPLAIN, f"word_dict_{lang}.jsonl")
        rows = load_jsonl(path)
        v2_count = 0
        for r in rows:
            lemma = r.get("lemma")
            if lemma not in verb_lemmas:
                if any(k in r for k in ("governance", "aspectExamples", "synonymComparison", "formExamples")):
                    errors.append(f"[{lang}] {lemma}: v2 verb fields present on non-verb entry (pos={r.get('pos')!r})")
                continue
            has_any = any(k in r for k in ("governance", "aspectExamples", "formExamples"))
            if not has_any:
                continue  # not enriched yet — fine, incremental
            v2_count += 1

            gov = r.get("governance")
            if not gov or not isinstance(gov, list) or len(gov) < 1:
                errors.append(f"[{lang}] {lemma}: governance must be a non-empty list")
            else:
                for g in gov:
                    if not g.get("pattern") or not str(g.get("pattern")).strip():
                        errors.append(f"[{lang}] {lemma}: governance entry missing pattern: {g}")
                    ex = g.get("example") or {}
                    if not ex.get("ru") or not ex.get("gloss"):
                        errors.append(f"[{lang}] {lemma}: governance example missing ru/gloss: {g}")

            aex = r.get("aspectExamples")
            if not aex or not isinstance(aex, list) or not (1 <= len(aex) <= 2):
                errors.append(f"[{lang}] {lemma}: aspectExamples must have 1-2 entries (got {len(aex) if aex else 0})")
            else:
                for a in aex:
                    if a.get("aspect") not in ("impf", "pf", "both"):
                        errors.append(f"[{lang}] {lemma}: aspectExamples entry has invalid aspect: {a.get('aspect')!r}")
                    if not a.get("lemma"):
                        errors.append(f"[{lang}] {lemma}: aspectExamples entry missing lemma: {a}")
                    examples = a.get("examples")
                    if not examples or len(examples) < 2:
                        errors.append(f"[{lang}] {lemma}: aspectExamples[{a.get('lemma')}] needs >=2 examples (got {len(examples) if examples else 0})")
                    else:
                        for ex in examples:
                            if not ex.get("ru") or not ex.get("gloss"):
                                errors.append(f"[{lang}] {lemma}: aspectExamples example missing ru/gloss: {ex}")

            syn = r.get("synonymComparison")
            if syn is not None:
                if not isinstance(syn, list):
                    errors.append(f"[{lang}] {lemma}: synonymComparison must be a list if present")
                else:
                    for s in syn:
                        if not s.get("lemma") or not s.get("note"):
                            errors.append(f"[{lang}] {lemma}: synonymComparison entry missing lemma/note: {s}")

            fex = r.get("formExamples")
            forms = r.get("forms") or {}
            expected_keys = set(_flatten_forms(forms).keys())
            if not fex or not isinstance(fex, dict):
                errors.append(f"[{lang}] {lemma}: formExamples missing/not a dict")
            else:
                got_keys = set(fex.keys())
                missing_keys = expected_keys - got_keys
                extra_keys = got_keys - expected_keys
                if missing_keys:
                    errors.append(f"[{lang}] {lemma}: formExamples missing keys {sorted(missing_keys)}")
                if extra_keys:
                    errors.append(f"[{lang}] {lemma}: formExamples has unexpected keys {sorted(extra_keys)}")
                for k, v in fex.items():
                    if not v.get("ru") or not v.get("gloss"):
                        errors.append(f"[{lang}] {lemma}: formExamples[{k}] missing ru/gloss: {v}")

        if errors:
            pass
        print(f"[{lang}] v2 verb enrichment progress: {v2_count}/{len(verb_lemmas)}")

    if errors:
        print(f"V2_WORD_DICT ERRORS: {len(errors)}")
        for e in errors[:60]:
            print(" ", e)
        if len(errors) > 60:
            print(f"  ...and {len(errors)-60} more")
    else:
        print("V2_WORD_DICT: no errors")
    return len(errors) == 0


def validate_v2_sentences():
    """LINGO-059: structural check of the v2 sentence-enrichment fields
    (grammarFocus/variations/paraphrases/takeaway). Incremental — a sentence
    with none of these yet is not an error, only uncounted toward progress."""
    order = json.load(open(os.path.join(EXPLAIN, "sentence_order.json"), encoding="utf-8"))
    expected = {s["id"] for s in order}

    errors = []
    for lang in ("ja", "en"):
        path = os.path.join(EXPLAIN, f"sentence_commentary_{lang}.jsonl")
        rows = load_jsonl(path)
        v2_count = 0
        for r in rows:
            sid = r.get("id")
            if sid not in expected:
                continue  # already flagged by validate_sentences
            has_any = any(k in r for k in ("grammarFocus", "variations", "paraphrases", "takeaway"))
            if not has_any:
                continue  # not enriched yet — fine, incremental
            v2_count += 1

            gf = r.get("grammarFocus")
            if not gf or not gf.get("construction") or not gf.get("note"):
                errors.append(f"[{lang}] {sid}: grammarFocus missing/incomplete: {gf}")

            variations = r.get("variations")
            if not variations or not isinstance(variations, list) or len(variations) < 1:
                errors.append(f"[{lang}] {sid}: variations must be a non-empty list")
            else:
                for v in variations:
                    if not v.get("ru") or not v.get("note"):
                        errors.append(f"[{lang}] {sid}: variations entry missing ru/note: {v}")

            para = r.get("paraphrases")
            if not para:
                errors.append(f"[{lang}] {sid}: paraphrases missing")
            else:
                opts = para.get("options")
                if not opts or not (2 <= len(opts) <= 3):
                    errors.append(f"[{lang}] {sid}: paraphrases.options must have 2-3 items (got {len(opts) if opts else 0})")
                else:
                    for o in opts:
                        if not o.get("ru") or not o.get("note"):
                            errors.append(f"[{lang}] {sid}: paraphrases option missing ru/note: {o}")
                if not para.get("simplest") or not str(para.get("simplest")).strip():
                    errors.append(f"[{lang}] {sid}: paraphrases.simplest missing")

            tk = r.get("takeaway")
            if not tk or not tk.get("pattern") or not tk.get("note"):
                errors.append(f"[{lang}] {sid}: takeaway missing/incomplete: {tk}")

        print(f"[{lang}] v2 sentence enrichment progress: {v2_count}/{len(expected)}")

    if errors:
        print(f"V2_SENTENCE_COMMENTARY ERRORS: {len(errors)}")
        for e in errors[:60]:
            print(" ", e)
        if len(errors) > 60:
            print(f"  ...and {len(errors)-60} more")
    else:
        print("V2_SENTENCE_COMMENTARY: no errors")
    return len(errors) == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--words", action="store_true")
    ap.add_argument("--sentences", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--v2-words", action="store_true")
    ap.add_argument("--v2-sentences", action="store_true")
    ap.add_argument("--v2-all", action="store_true")
    args = ap.parse_args()
    any_v1 = args.words or args.sentences or args.all
    any_v2 = args.v2_words or args.v2_sentences or args.v2_all
    ok = True
    if args.words or args.all:
        ok = validate_words() and ok
    if args.sentences or args.all:
        ok = validate_sentences() and ok
    if args.v2_words or args.v2_all:
        ok = validate_v2_words() and ok
    if args.v2_sentences or args.v2_all:
        ok = validate_v2_sentences() and ok
    if not any_v1 and not any_v2:
        ok = validate_words() and ok
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
