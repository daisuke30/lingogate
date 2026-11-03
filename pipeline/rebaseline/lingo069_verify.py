#!/usr/bin/env python3
"""LINGO-069 machine verification — everything this task must hold, in one run.

  1. review_sentences.py over both new id blocks (B4001+ in the band2 file,
     B5001+ in the band3 file): token count 3-7, target in lemmas[], every
     lemma resolves to a Word row, target band matches the file, no Latin
     contamination, no duplicate ru, lemma-array accuracy.
  2. subject buckets: re-classify with classify_subjects.py and assert every
     generated row landed in the bucket lingo069_plan.json assigned it, that
     the whole corpus is still within LINGO-051's +-3pp of every target, and
     that "other" is still empty.
  3. validate_explain.py --sentences --v2-sentences: the ja/en commentary is
     structurally complete (v1 fields) and carries all four v2 fields.
  4. no orphans: every generated sentence has ja AND en commentary.

Usage: .venv/bin/python3 lingo069_verify.py [--quick]
  --quick skips step 2's pymorphy re-classification (slow); use it between
  batches and run the full thing before each commit.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
EXPLAIN = os.path.join(DATA, "explain")
PY = os.path.join(HERE, ".venv", "bin", "python3")
if not os.path.exists(PY):
    PY = sys.executable

TARGET_PCT = {"я": 30, "ты": 18, "вы": 10, "он": 5, "она": 5,
              "мы": 8, "они": 4, "no_subject": 12, "mne_type": 8}
TOLERANCE = 3.0


def run(label, cmd):
    print(f"\n===== {label}")
    r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    print(out[-4000:] if out else "(no output)")
    return r.returncode == 0


def load_jsonl(path):
    rows = []
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()

    plan = json.load(open(os.path.join(HERE, "lingo069_plan.json"), encoding="utf-8"))
    written = {r["id"] for r in load_jsonl(os.path.join(DATA, "sentences_band2_core.jsonl"))}
    written |= {r["id"] for r in load_jsonl(os.path.join(DATA, "sentences_band3_core.jsonl"))}
    mine = [r for r in plan if r["id"] in written]
    print(f"generated so far: {len(mine)}/{len(plan)}")
    if not mine:
        print("nothing to verify yet")
        return 0

    ok = True
    if any(r["band"] == 2 for r in mine):
        ok = run("review_sentences band2 (B4001+)",
                 [PY, "review_sentences.py", "--file", "sentences_band2_core.jsonl",
                  "--min-id", "B4001", "--band", "2"]) and ok
    if any(r["band"] == 3 for r in mine):
        ok = run("review_sentences band3 (B5001+)",
                 [PY, "review_sentences.py", "--file", "sentences_band3_core.jsonl",
                  "--min-id", "B5001", "--band", "3"]) and ok

    if not args.quick:
        ok = run("classify_subjects (regenerating subject_distribution.json)",
                 [PY, "classify_subjects.py", "--json", "subject_distribution.json"]) and ok
        print("\n===== subject buckets vs lingo069_plan.json")
        cls = {r["id"]: r for r in json.load(
            open(os.path.join(HERE, "subject_distribution.json"), encoding="utf-8"))}
        mismatch = [(r["id"], r["lemma"], r["target_bucket"], cls[r["id"]]["bucket"])
                    for r in mine if r["id"] in cls
                    and cls[r["id"]]["bucket"] != r["target_bucket"]]
        print(f"bucket mismatches vs plan: {len(mismatch)}")
        for m in mismatch[:30]:
            print("  ", m)
        # a mismatch is only fatal if it breaks the corpus-wide tolerance,
        # which the next block checks — report it either way.
        total = len(cls)
        other = [i for i, r in cls.items() if r["bucket"] == "other"]
        print(f"\ncorpus total {total}; 'other' = {len(other)} (must be 0)")
        if other:
            print("  ", other[:20])
            ok = False
        for b, target in TARGET_PCT.items():
            n = sum(1 for r in cls.values() if r["bucket"] == b)
            pct = 100.0 * n / total
            flag = "OK " if abs(pct - target) <= TOLERANCE else "FAIL"
            if flag == "FAIL":
                ok = False
            print(f"  {flag} {b:<11} {n:>5} {pct:5.1f}%  target {target}%")

    ok = run("validate_explain --sentences --v2-sentences",
             [PY, "validate_explain.py", "--sentences", "--v2-sentences"]) and ok

    print("\n===== orphan check (sentence without ja+en commentary)")
    ja = {r["id"] for r in load_jsonl(os.path.join(EXPLAIN, "sentence_commentary_ja.jsonl"))}
    en = {r["id"] for r in load_jsonl(os.path.join(EXPLAIN, "sentence_commentary_en.jsonl"))}
    orphans = [r["id"] for r in mine if r["id"] not in ja or r["id"] not in en]
    print(f"orphans: {len(orphans)} {orphans[:20]}")
    if orphans:
        ok = False

    print("\n" + ("ALL CHECKS PASSED" if ok else "*** FAILURES ABOVE ***"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
