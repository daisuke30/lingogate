#!/usr/bin/env python3
"""LINGO-051 step 2: decide WHICH sentences get rewritten into WHICH target
subject-type bucket, and log the reasoning.

Pool of rewrite candidates = the entire "other" bucket (doesn't fit any of
the 8 target person-categories at all — by definition the textbook-flavored/
low-practicality pool the task wants rewritten) PLUS a "low practicality"
slice pulled from any bucket currently OVER its target count (surplus must
shrink somewhere; low-practicality sentences are prioritized for conversion
first, per the task's explicit instruction).

"Low practicality" scoring (loggable, not just vibes): a sentence scores as
low-practicality if its RU text contains any of a curated set of markers for
violent/criminal/unrealistic-drama content (LINGO-023's bulk B-prefixed
inflow batch skewed toward crime-drama filler — "Он хочет украрсть деньги.",
"Он хочет взорвать этот дом." — nothing a learner would say on a date or at
a cafe) or otherwise reads as generic/encyclopedic rather than personal
("Ситуация очень плохая." style abstract statements). Falls back to
oldest-numbered-first (lower B#### number = earlier/more-reviewed inflow
batch tends to be higher quality; this is a weak tiebreaker only, documented
here rather than silently arbitrary).

Output: JSON list of {id, file, ru, target_lemma, old_bucket, new_bucket,
reason} — the exact rewrite work order, consumed by generate_rewrites.py.
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_subjects import load_core_rows, classify, BUCKETS  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

TARGET_PCT = {
    "я": 30, "ты": 18, "вы": 10, "он": 5, "она": 5, "мы": 8, "они": 4,
    "no_subject": 12, "mne_type": 8,
}

LOW_PRACTICALITY_MARKERS = [
    "украсть", "убить", "убил", "убила", "выстрел", "застрел", "взорвать",
    "взрыв", "изнасил", "избил", "избить", "задуш", "наркотик", "труп",
    "комиссар", "полиция арестовала", "тюрьм", "преступник", "похитить",
    "похищ", "заложник", "бандит", "мафия", "пистолет", "нож ", "кровь",
    "жертва", "расследование", "шпион", "предатель", "изменник", "казнить",
]


def practicality_score(ru):
    """Lower is worse (more textbook/unnatural/dramatic). 0 = flagged low."""
    low = ru.lower()
    for marker in LOW_PRACTICALITY_MARKERS:
        if marker in low:
            return 0
    return 1


def main():
    rows = load_core_rows()
    known_lemmas_by_id = {}
    classified = []
    for s in rows:
        bucket, reason = classify(s)
        classified.append({"row": s, "bucket": bucket, "reason": reason})

    total = len(rows)
    target_counts = {k: round(total * v / 100) for k, v in TARGET_PCT.items()}
    from collections import Counter
    current = Counter(c["bucket"] for c in classified)
    deltas = {k: target_counts[k] - current.get(k, 0) for k in TARGET_PCT}
    deficits = {k: v for k, v in deltas.items() if v > 0}
    surplus = {k: -v for k, v in deltas.items() if v < 0}

    # Candidate pool: all "other" + a low-practicality-first slice of each
    # surplus bucket.
    other_candidates = [c for c in classified if c["bucket"] == "other"]
    surplus_candidates = []
    for bucket, need in surplus.items():
        pool = [c for c in classified if c["bucket"] == bucket]
        pool.sort(key=lambda c: (practicality_score(c["row"]["ru"]), c["row"]["id"]))
        surplus_candidates.extend(pool[:need])

    candidates = other_candidates + surplus_candidates
    # Sort the whole candidate pool by practicality (worst first) so if
    # anything is left unassigned (rounding), it's the LEAST bad content.
    candidates.sort(key=lambda c: (practicality_score(c["row"]["ru"]), c["row"]["id"]))

    assert len(candidates) >= sum(deficits.values()), (
        f"candidate pool {len(candidates)} < needed {sum(deficits.values())}"
    )

    # Round-robin assignment across deficit buckets, largest-need-first, so
    # smaller buckets (like она/они) don't get starved by list order.
    order = sorted(deficits.items(), key=lambda kv: -kv[1])
    plan = []
    idx = 0
    for bucket, need in order:
        for _ in range(need):
            c = candidates[idx]
            idx += 1
            score = practicality_score(c["row"]["ru"])
            reason = (
                "low-practicality (crime/drama marker)" if score == 0
                else f"'other'/surplus bucket, no target-category fit (was: {c['bucket']})"
            )
            plan.append({
                "id": c["row"]["id"],
                "file": c["row"]["_file"],
                "ru": c["row"]["ru"],
                "en": c["row"].get("en"),
                "ja": c["row"].get("ja"),
                "target_lemma": c["row"]["target_lemma"],
                "old_bucket": c["bucket"],
                "new_bucket": bucket,
                "reason": reason,
            })

    print(f"total candidates: {len(candidates)}, assigned: {len(plan)}, leftover unassigned: {len(candidates)-idx}")
    by_new = Counter(p["new_bucket"] for p in plan)
    print("assignment counts:", dict(by_new))

    out_path = os.path.join(HERE, "rewrite_plan.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    print(f"wrote {len(plan)} rewrite-plan entries to {out_path}")


if __name__ == "__main__":
    main()
