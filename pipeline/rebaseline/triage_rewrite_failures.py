#!/usr/bin/env python3
"""LINGO-051 step 5: split apply_rewrites.py failures into two repair paths.

  A) "vocab-only" — the ONLY problem is one or more lemmas not yet in the
     Word table. The sentence itself is fine (right bucket, right length,
     right target_lemma, no duplicate) — once those lemmas exist, it passes
     with ZERO regeneration. Collected into new_words_todo (same shape as
     LINGO-049's pipeline) for Codex gloss/pos/aspect generation.

  B) "needs_regen" — anything else (wrong bucket/construction, duplicate,
     too short/long, target_lemma substituted for a different word). These
     go back to Codex as a retry batch with the specific rejection reason
     attached, so it can actually fix what was wrong instead of repeating
     the same mistake blind.

Usage: python3 triage_rewrite_failures.py
Writes: retry_batch.json, new_words_todo_rewrites.json
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from annotate_cases import MORPH, norm, NOISE_GRAMMEMES  # noqa: E402
from audit_lemma_links import load_all_known_lemmas, pos_class_of  # noqa: E402
from apply_rewrites import fix_pronoun_lemmas  # noqa: E402
from classify_subjects import classify, load_core_rows  # noqa: E402
from annotate_cases import TOKEN_RE  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
LATIN_RE = re.compile(r"[A-Za-z]")


def main():
    plan = json.load(open(os.path.join(HERE, "rewrite_plan.json"), encoding="utf-8"))
    plan_by_id = {p["id"]: p for p in plan}

    out_files = sorted(glob.glob(os.path.join(HERE, "rewrite_out", "out_*.json")))
    all_new = {}
    for path in out_files:
        for r in json.load(open(path, encoding="utf-8")):
            all_new[r.get("id")] = r

    known_lemmas = load_all_known_lemmas()
    core_rows = load_core_rows()
    corpus_ru = {norm(s["ru"]): s["id"] for s in core_rows}

    seen_new_ru = {}
    vocab_only = []   # (pid, plan_row, new_row, missing_lemmas)
    needs_regen = []  # (pid, plan_row, new_row_or_None, reasons)

    for pid, plan_row in plan_by_id.items():
        new = all_new.get(pid)
        if new is None:
            needs_regen.append((pid, plan_row, None, ["missing from Codex output"]))
            continue

        new_lemmas = fix_pronoun_lemmas(new.get("lemmas") or [], known_lemmas)
        reasons_structural = []
        missing_lemmas = []

        if norm(plan_row["target_lemma"]) not in {norm(l) for l in new_lemmas}:
            reasons_structural.append(f"target_lemma {plan_row['target_lemma']!r} not in new lemmas {new_lemmas}")

        ru = new.get("ru", "")
        toks = TOKEN_RE.findall(ru)
        if not (3 <= len(toks) <= 7):
            reasons_structural.append(f"token count {len(toks)} out of [3,7]")

        for lem in new_lemmas:
            if norm(lem) not in known_lemmas:
                missing_lemmas.append(lem)

        if LATIN_RE.search(ru):
            reasons_structural.append("Latin contamination")

        n = norm(ru)
        if n in corpus_ru and corpus_ru[n] != pid:
            reasons_structural.append(f"duplicates existing corpus sentence {corpus_ru[n]}")
        if n in seen_new_ru and seen_new_ru[n] != pid:
            reasons_structural.append(f"duplicates another rewrite {seen_new_ru[n]}")
        seen_new_ru[n] = pid

        fake_row = {"ru": ru, "id": pid, "target_lemma": plan_row["target_lemma"]}
        bucket, breason = classify(fake_row)
        if bucket != plan_row["new_bucket"]:
            reasons_structural.append(
                f"classifies as {bucket!r} ({breason}), expected {plan_row['new_bucket']!r}"
            )

        if reasons_structural:
            needs_regen.append((pid, plan_row, new, reasons_structural))
        elif missing_lemmas:
            vocab_only.append((pid, plan_row, new, missing_lemmas))
        # else: fully passing, nothing to do here

    print(f"vocab-only failures: {len(vocab_only)} rows")
    print(f"needs-regen failures: {len(needs_regen)} rows")

    # --- Collect distinct missing lemmas for Codex gloss generation ---
    lemma_examples = {}
    for pid, plan_row, new, missing in vocab_only:
        for lem in missing:
            lemma_examples.setdefault(lem, []).append(new["ru"])

    def pos_of(lemma):
        for p in MORPH.parse(lemma):
            if p.tag.grammemes & NOISE_GRAMMEMES:
                continue
            pc = pos_class_of(p.tag.POS)
            if pc:
                return pc
            if p.tag.POS == "ADVB":
                return "adv"
            if p.tag.POS in ("NPRO",):
                return "pronoun"
        return "noun"  # conservative fallback; reviewed manually anyway

    todo = {"verb": [], "noun": [], "adj": [], "adv": [], "other": []}
    for lem in sorted(lemma_examples):
        pc = pos_of(lem)
        bucket = pc if pc in ("verb", "noun", "adj", "adv") else "other"
        todo[bucket].append({"lemma": lem, "examples": lemma_examples[lem][:3]})

    with open(os.path.join(HERE, "new_words_todo_rewrites.json"), "w", encoding="utf-8") as f:
        json.dump(todo, f, ensure_ascii=False, indent=2)
    print(f"new_words_todo_rewrites.json: verb={len(todo['verb'])} noun={len(todo['noun'])} "
          f"adj={len(todo['adj'])} adv={len(todo['adv'])} other={len(todo['other'])}")
    if todo["other"]:
        print("  'other'-pos lemmas (need manual glossing, not auto-batched):", [t["lemma"] for t in todo["other"]])

    # --- Retry batch for structural failures ---
    from build_rewrite_batches import BUCKET_INSTRUCTION, EXAMPLES  # noqa: E402
    retry_rows = []
    for pid, plan_row, new, reasons in needs_regen:
        retry_rows.append({
            "id": pid,
            "target_lemma": plan_row["target_lemma"],
            "old_ru": plan_row["ru"],
            "new_bucket": plan_row["new_bucket"],
            "construction_instruction": BUCKET_INSTRUCTION[plan_row["new_bucket"]],
            "example": EXAMPLES[plan_row["new_bucket"]],
            "previous_attempt": new.get("ru") if new else None,
            "rejection_reasons": reasons,
        })
    with open(os.path.join(HERE, "retry_batch.json"), "w", encoding="utf-8") as f:
        json.dump(retry_rows, f, ensure_ascii=False, indent=2)
    print(f"retry_batch.json: {len(retry_rows)} rows")


if __name__ == "__main__":
    main()
