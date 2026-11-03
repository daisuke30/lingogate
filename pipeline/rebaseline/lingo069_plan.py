#!/usr/bin/env python3
"""LINGO-069 step 1: identify every band1-3 word that has NO dedicated core
sentence (target_lemma) and lay out the generation plan.

Why this exists
---------------
LINGO-065/066's mastery simulation (ai-org/Ideas/_work/20261103-lingogate-
pace-projection-simulation.md) found that band2 and band3 each contain words
with no core sentence at all. A word with no target sentence can never enter
the study queue (buildGateSession only ever serves sentences), so those words
are unreachable by studying — 3000 mastered words is arithmetically impossible
until they have sentences. This script produces the authoritative worklist.

Outputs (all checked in, all regenerable — run with no args):
  lingo069_missing_words.tsv   human/diff-friendly worklist, band then rank
  lingo069_plan.json           same rows + assigned sentence id + target
                               subject bucket, consumed by the generator
  lingo069_manifest.json       resume cursors (created once, never clobbered)

ID scheme
---------
Existing core ids: T0001-T1387 (LINGO-011/022) and B2001-B3462 (LINGO-023;
the B number is a flat counter, it does NOT encode the band). This task adds
two fresh, non-overlapping B blocks so that
  * ids stay globally unique,
  * build.test.ts's core-id test (/^[TB]/) keeps working unchanged, and
  * review_sentences.py --min-id can isolate this task's rows by plain string
    compare (all B ids are B + 4 digits, so lexical order == numeric order).

  band2 missing (476 words) -> B4001 .. B4476
  band3 missing (444 words) -> B5001 .. B5444

Subject-bucket pre-assignment
-----------------------------
LINGO-051 fixed the corpus subject distribution (я30/ты18/вы10/он5/она5/мы8/
они4/no_subject12/mne_type8 %, +-3pp, enforced by subjectDistribution.test.ts,
and "other" must stay at exactly zero). Adding 920 sentences = 43% of the
corpus, so the new rows cannot be written first and measured later. Each row
gets a target bucket up front, allocated by largest-remainder quota and then
spread with a Bresenham-style interleave so that ANY contiguous prefix of the
plan is already near-proportional — which matters because generation runs in
25-row batches across sessions and may stop at any batch boundary.
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

CORE_FILES = [
    "sentences_band1_core.jsonl",
    "sentences_band2_core.jsonl",
    "sentences_band3_core.jsonl",
    "sentences_band4_core.jsonl",
]

# LINGO-051 approved target distribution (percent).
TARGET_PCT = {
    "я": 30,
    "ты": 18,
    "вы": 10,
    "он": 5,
    "она": 5,
    "мы": 8,
    "они": 4,
    "no_subject": 12,
    "mne_type": 8,
}

ID_BLOCK = {2: 4001, 3: 5001}


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def existing_targets():
    targets = set()
    for fname in CORE_FILES:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        for s in load_jsonl(path):
            if s.get("target_lemma"):
                targets.add(s["target_lemma"])
    return targets


def allocate_buckets(n):
    """Return a list of n bucket names whose counts match TARGET_PCT (largest
    remainder) and which are evenly interleaved, so every prefix is close to
    proportional. Bresenham/Bjornson-style: repeatedly emit the bucket with
    the largest accumulated deficit."""
    quotas = {}
    floors = {}
    for b, pct in TARGET_PCT.items():
        exact = n * pct / 100.0
        quotas[b] = exact
        floors[b] = int(exact)
    remainder = n - sum(floors.values())
    # largest remainder gets the leftovers
    for b, _ in sorted(quotas.items(), key=lambda kv: (-(kv[1] - floors[kv[0]]), kv[0]))[:remainder]:
        floors[b] += 1
    assert sum(floors.values()) == n, (sum(floors.values()), n)

    # Even interleave: each bucket accrues floors[b]/n credit per slot; emit
    # whichever bucket has the most credit banked (ties broken by name for
    # determinism).
    credit = {b: 0.0 for b in floors}
    left = dict(floors)
    out = []
    for _ in range(n):
        for b in credit:
            credit[b] += floors[b] / n
        pick = max((b for b in credit if left[b] > 0), key=lambda b: (credit[b], b))
        out.append(pick)
        credit[pick] -= 1.0
        left[pick] -= 1
    return out, floors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify the checked-in plan still matches the data; "
                         "do not write anything")
    args = ap.parse_args()

    targets = existing_targets()
    aspects = {w["lemma"]: w for w in load_jsonl(os.path.join(DATA, "words_aspects.jsonl"))}

    missing = []
    for band in (1, 2, 3):
        words = load_jsonl(os.path.join(DATA, f"words_band{band}.jsonl"))
        for w in words:
            if w["lemma"] in targets:
                continue
            missing.append({
                "band": band,
                "rank": w["rank"],
                "lemma": w["lemma"],
                "pos": w["pos"],
                "gender": w.get("gender"),
                "en_gloss": w.get("en_gloss"),
                "ja_gloss": w.get("ja_gloss"),
                "aspect": aspects.get(w["lemma"], {}).get("aspect"),
                "aspect_pair": aspects.get(w["lemma"], {}).get("aspect_pair"),
                "pair_kind": aspects.get(w["lemma"], {}).get("pair_kind"),
            })

    missing.sort(key=lambda r: (r["band"], r["rank"]))
    if any(r["band"] == 1 for r in missing):
        raise SystemExit("band1 has missing targets — the ID scheme here only "
                         "covers band2/3; revisit before generating.")

    buckets, floors = allocate_buckets(len(missing))
    counters = dict(ID_BLOCK)
    for row, bucket in zip(missing, buckets):
        row["target_bucket"] = bucket
        row["id"] = f"B{counters[row['band']]}"
        counters[row["band"]] += 1

    by_band = {}
    for r in missing:
        by_band.setdefault(r["band"], []).append(r)

    print(f"missing core-sentence words: {len(missing)}")
    for band, rows in sorted(by_band.items()):
        print(f"  band{band}: {len(rows)}  ids {rows[0]['id']}..{rows[-1]['id']}")
    print("target bucket allocation:")
    for b, c in sorted(floors.items(), key=lambda kv: -kv[1]):
        print(f"  {b:<11} {c:>4}  ({100*c/len(missing):.1f}% / target {TARGET_PCT[b]}%)")

    plan_path = os.path.join(HERE, "lingo069_plan.json")
    tsv_path = os.path.join(HERE, "lingo069_missing_words.tsv")

    if args.check:
        if not os.path.exists(plan_path):
            raise SystemExit("no checked-in plan to check against")
        with open(plan_path, encoding="utf-8") as f:
            old = json.load(f)
        # A regenerated plan must be identical EXCEPT that words which now
        # have a sentence (because this task generated it) drop out. So check
        # the checked-in plan is a superset with identical id/bucket mapping.
        old_by_lemma = {r["lemma"]: r for r in old}
        drift = [r["lemma"] for r in missing
                 if r["lemma"] not in old_by_lemma
                 or old_by_lemma[r["lemma"]]["id"] != r["id"]]
        print(f"\nplan drift (unplanned or re-numbered words): {len(drift)}", drift[:10])
        raise SystemExit(1 if drift else 0)

    with open(plan_path, "w", encoding="utf-8") as f:
        json.dump(missing, f, ensure_ascii=False, indent=1)
    cols = ["id", "band", "rank", "lemma", "pos", "target_bucket", "gender",
            "aspect", "aspect_pair", "pair_kind", "en_gloss", "ja_gloss"]
    with open(tsv_path, "w", encoding="utf-8") as f:
        f.write("\t".join(cols) + "\n")
        for r in missing:
            f.write("\t".join("" if r.get(c) is None else str(r.get(c)) for c in cols) + "\n")
    print(f"\nwrote {plan_path}\nwrote {tsv_path}")

    man_path = os.path.join(HERE, "lingo069_manifest.json")
    if not os.path.exists(man_path):
        with open(man_path, "w", encoding="utf-8") as f:
            json.dump({
                "task": "LINGO-069",
                "total": len(missing),
                "sentences_done": 0,
                "sentences_last_index": -1,
                "commentary_done": 0,
                "commentary_last_index": -1,
                "note": "indexes are into lingo069_plan.json (0-based). "
                        "-1 = not started; resume at index+1. sentences and "
                        "commentary advance together, 25 rows per write.",
            }, f, ensure_ascii=False, indent=1)
        print(f"wrote {man_path}")
    else:
        print(f"kept existing {man_path}")


if __name__ == "__main__":
    main()
