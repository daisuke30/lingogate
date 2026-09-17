#!/usr/bin/env python3
"""LINGO-051 step 4: validate Codex's rewrite_out/out_*.json against
rewrite_plan.json and, if clean, replace the corresponding rows IN PLACE
(same id, same target_lemma, same file) in the sentences_*_core.jsonl files.

Validation (mirrors review_sentences.py's rigor, LINGO-011/020/022 lineage):
  1. id matches the plan row exactly (no drift/reordering).
  2. target_lemma UNCHANGED and present in the new lemmas[] (task's hard
     "target_lemmaは変えない" constraint).
  3. RU content-word token count in [3,7].
  4. every declared lemma resolves to a Word row (band1-4) — else it can't link.
  5. no exact RU duplicate — neither vs. the whole corpus nor within the
     rewrite batch itself.
  6. no Latin-letter contamination (typo guard, same as review_sentences.py).
  7. re-classifying the NEW ru with classify_subjects.classify() lands in the
     EXACT bucket the plan assigned — the core purpose of this whole
     exercise, so a construction-instruction miss is a hard reject, not a
     warning.

Rows failing ANY check are printed and EXCLUDED from the apply (left
untouched in the source file, original content preserved) — never applied
half-validated. A clean summary reports pass/fail counts per batch.

Usage:
  python3 apply_rewrites.py                 # dry run, full validation report
  python3 apply_rewrites.py --write          # apply all PASSING rows
"""
import argparse
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from annotate_cases import MORPH, TOKEN_RE, norm  # noqa: E402
from audit_lemma_links import load_all_known_lemmas  # noqa: E402
from classify_subjects import classify, load_core_rows  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
LATIN_RE = re.compile(r"[A-Za-z]")

# Codex sometimes puts an INFLECTED pronoun surface form directly into
# `lemmas` (e.g. "вам"/"тебе" — dative case) instead of the dictionary
# (nominative) headword the Word table actually registers. Auto-correct
# these known oblique->nominative mappings before validating rather than
# rejecting an otherwise-good rewrite over a mechanical lemma-array slip.
PRONOUN_LEMMA_FIX = {
    "меня": "я", "мне": "я", "мной": "я", "мною": "я",
    "тебя": "ты", "тебе": "ты", "тобой": "ты", "тобою": "ты",
    "вас": "вы", "вам": "вы", "вами": "вы",
    "его": "он", "него": "он", "ему": "он", "нему": "он",
    "её": "она", "нее": "она", "неё": "она", "ей": "она", "ней": "она", "ею": "она", "нею": "она",
    "нас": "мы", "нам": "мы", "нами": "мы",
    "их": "они", "них": "они",
    # "им"/"ним" and "ими" are genuinely ambiguous — dative/instrumental of
    # BOTH он (singular "to/by him") and они (plural "to/by them") share the
    # identical spelling, so a blind mapping would be a silent guess. Left
    # unmapped on purpose: such a row just fails validation and gets a
    # manual look rather than risking a wrong pronoun.
}


def canonicalize_lemma(lemma, known_lemmas):
    """General version of the pronoun fix: Codex occasionally writes an
    inflected surface form instead of the dictionary headword even for
    ordinary nouns (found via "родом" written instead of "род" — pymorphy's
    own normal_form of "родом" IS "род", which IS registered). If the given
    lemma isn't directly registered but pymorphy's own top-parse normal_form
    of it IS, use that — a safe, non-guessing correction (pymorphy is doing
    the same job it always does, just applied to a `lemmas` entry instead of
    a RU-text token). Left unchanged (and later reported as genuinely
    missing) if pymorphy can't resolve it to something registered either."""
    key = norm(lemma)
    if key in known_lemmas:
        # IMPORTANT: return the Word table's own registered spelling, not the
        # raw input. norm()-equivalence (ё/е folding, case folding) is only
        # for MATCHING — the actual string written into a sentence's
        # `lemmas` array must be byte-identical to the registered lemma,
        # because both build-content.mjs and import.py link by EXACT string
        # match (no folding at all). Passing the raw string through here
        # produced a real bug: Codex correctly wrote "далёкий" (modern ё
        # spelling) where this project's own Word row is registered as the
        # older "далекий" (no ё) — norm()-matched fine, so validation
        # passed, but import.py's exact-match linking then silently failed
        # (same failure class as "ДНК" vs registered "днк", and "Джон" vs
        # registered "джон" — acronym/proper-noun casing Codex reasonably
        # capitalized but the Word table stores lowercase).
        return known_lemmas[key]["lemma"]
    parses = MORPH.parse(lemma)
    if parses:
        top_norm = norm(parses[0].normal_form)
        if top_norm in known_lemmas:
            return known_lemmas[top_norm]["lemma"]
    return lemma


def fix_pronoun_lemmas(lemmas, known_lemmas=None):
    # IMPORTANT: only apply the oblique->nominative pronoun fix when the raw
    # spelling ISN'T already a directly-registered word. This project
    # registers его/их/неё/etc. as their OWN separate headwords (possessive
    # determiners / after-preposition forms — see words_band1.jsonl), so a
    # sentence whose target_lemma genuinely IS "его" must keep it verbatim;
    # blindly normalising to "он" would silently rewrite away the very word
    # the sentence exists to teach (found via T0048/T0050/T1146 — three
    # target_lemma checks starting to fail again after this fix ran
    # unconditionally).
    def fix_one(l):
        if known_lemmas is not None and norm(l) in known_lemmas:
            return l
        return PRONOUN_LEMMA_FIX.get(norm(l), l)
    out = [fix_one(l) for l in lemmas]
    if known_lemmas is not None:
        out = [canonicalize_lemma(l, known_lemmas) for l in out]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    plan = json.load(open(os.path.join(HERE, "rewrite_plan.json"), encoding="utf-8"))
    plan_by_id = {p["id"]: p for p in plan}

    out_files = sorted(glob.glob(os.path.join(HERE, "rewrite_out", "out_*.json")))
    all_new = {}
    for path in out_files:
        try:
            rows = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            print(f"[PARSE FAIL] {path}: {e}")
            continue
        for r in rows:
            all_new[r.get("id")] = r

    known_lemmas = load_all_known_lemmas()
    core_rows = load_core_rows()
    corpus_ru = {norm(s["ru"]): s["id"] for s in core_rows}

    seen_new_ru = {}
    passed = []
    failed = []

    for pid, plan_row in plan_by_id.items():
        new = all_new.get(pid)
        if new is None:
            failed.append((pid, "MISSING from Codex output"))
            continue

        issues = []
        if new.get("id") != pid:
            issues.append(f"id mismatch: {new.get('id')!r}")

        target_lemma = plan_row["target_lemma"]
        new_lemmas = fix_pronoun_lemmas(new.get("lemmas") or [], known_lemmas)
        new["lemmas"] = new_lemmas  # persist the fix for the --write pass
        # norm() (ё->е, lowercase) both sides — known_lemmas is keyed by norm()
        # (see audit_lemma_links.load_all_known_lemmas), and Codex correctly
        # spells ё-words with ё (e.g. "тёплый"), so a raw string comparison
        # against the folded dict key would false-fail every ё-word AND every
        # acronym-cased target_lemma (e.g. target_lemma "днк" vs written "ДНК").
        if norm(target_lemma) not in {norm(l) for l in new_lemmas}:
            issues.append(f"target_lemma {target_lemma!r} not in new lemmas {new_lemmas}")

        ru = new.get("ru", "")
        toks = TOKEN_RE.findall(ru)
        if not (3 <= len(toks) <= 7):
            issues.append(f"token count {len(toks)} out of [3,7]: {ru!r}")

        for lem in new_lemmas:
            if norm(lem) not in known_lemmas:
                issues.append(f"lemma {lem!r} not in Word table")

        if LATIN_RE.search(ru):
            issues.append(f"Latin contamination: {ru!r}")

        n = norm(ru)
        if n in corpus_ru and corpus_ru[n] != pid:
            issues.append(f"duplicates existing corpus sentence {corpus_ru[n]}: {ru!r}")
        if n in seen_new_ru and seen_new_ru[n] != pid:
            issues.append(f"duplicates another rewrite {seen_new_ru[n]}: {ru!r}")
        seen_new_ru[n] = pid

        # The core check: does the rewritten sentence actually land in the
        # intended bucket?
        fake_row = {"ru": ru, "id": pid, "target_lemma": target_lemma}
        bucket, reason = classify(fake_row)
        if bucket != plan_row["new_bucket"]:
            issues.append(
                f"classifies as {bucket!r} ({reason}), expected {plan_row['new_bucket']!r}"
            )

        if issues:
            failed.append((pid, "; ".join(issues)))
        else:
            passed.append((pid, plan_row, new))

    print(f"plan rows: {len(plan)}  passed: {len(passed)}  failed: {len(failed)}")
    if failed:
        print("\n--- FAILURES ---")
        for pid, reason in failed:
            print(f"{pid}: {reason}")

    if not args.write:
        print("\n(dry run — pass --write to apply the passing rows)")
        return

    # Group passing rows by their target file, apply in place.
    by_file = {}
    for pid, plan_row, new in passed:
        by_file.setdefault(plan_row["file"], []).append((pid, new))

    total_applied = 0
    for fname, updates in by_file.items():
        path = os.path.join(DATA, fname)
        rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
        update_by_id = {pid: new for pid, new in updates}
        changed = False
        for s in rows:
            if s["id"] in update_by_id:
                new = update_by_id[s["id"]]
                s["ru"] = new["ru"]
                s["en"] = new.get("en", s.get("en"))
                s["ja"] = new.get("ja", s.get("ja"))
                s["lemmas"] = new["lemmas"]
                # Old per-token case/number annotations and notes described
                # the OLD sentence text — clear them rather than ship stale
                # metadata; LINGO-033's `forms` array and any note/note_en/
                # note_ru are optional fields, safe to drop.
                s.pop("forms", None)
                s.pop("note", None)
                s.pop("note_en", None)
                s.pop("note_ru", None)
                changed = True
                total_applied += 1
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                for s in rows:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")
            print(f"applied {sum(1 for pid in update_by_id if pid)} updates to {fname}")

    print(f"\ntotal applied: {total_applied}")


if __name__ == "__main__":
    main()
