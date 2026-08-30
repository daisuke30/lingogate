#!/usr/bin/env python3
"""LINGO-025: enforce the лежать precedent consistently across all Codex
batches BEFORE merge.

Katsuta's worked example (лежать) is explicit: a state verb whose "shown
partner" is a delimitative по-verb ("do X for a while", e.g. полежать,
постоять, посидеть) must be classified pair_kind="none" — the delimitative
is bonus vocabulary, not a functional near-substitute for a missing
perfective. Codex was NOT instructed narrowly enough and used pair_kind=
"related" for many delimitative по-pairs (e.g. беспокоиться→побеспокоиться).

Genuine inchoative/meaning-shift derivatives (знать→узнать "get to know",
захотеть→хотеть-related "start wanting", ненавидеть→возненавидеть "come to
hate") are a DIFFERENT, legitimate "related" pattern (they represent what
happens if you force a state verb to have a completed-event reading) and are
left untouched.

This script scans every out_*.json batch, flags pair_kind="related" rows
whose pair_note text signals a delimitative reading, and reclassifies them to
"none" in place (rewriting the batch file). Flags are printed for manual
spot-check — this is a HEURISTIC pre-pass, not a substitute for the full
manual review pass over every row.
"""
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

# Delimitative signal: pair_note describing a bounded/limited-duration reading
# ("for a while", "a little", "briefly") rather than a genuine state-change.
DELIM_RE = re.compile(r"しばらく|少しの間|一定時間|区切り|限定相|少し.*する（|一時的")
# Inchoative signal (state->change-of-state / meaning shift): keep as related.
INCHOATIVE_RE = re.compile(r"ようになる|し始める|なる（|くなる|学ぶ|覚える|になる")


def main():
    total_flagged = 0
    total_reclassified = 0
    log = []
    for path in sorted(glob.glob(os.path.join(HERE, "aspect_batches", "out_*.json"))):
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        changed = False
        for r in rows:
            if r.get("pair_kind") != "related":
                continue
            note = r.get("pair_note") or ""
            is_delim = bool(DELIM_RE.search(note))
            is_inchoative = bool(INCHOATIVE_RE.search(note))
            if is_delim and not is_inchoative:
                total_flagged += 1
                log.append(f"{os.path.basename(path)}: {r['lemma']} -> {r['aspect_pair']} | {note}")
                r["pair_kind"] = "none"
                changed = True
                total_reclassified += 1
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, indent=1)

    print(f"reclassified related->none (delimitative pattern, лежать precedent): {total_reclassified}")
    for l in log:
        print(" ", l)


if __name__ == "__main__":
    main()
