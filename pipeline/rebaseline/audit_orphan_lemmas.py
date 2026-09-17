#!/usr/bin/env python3
"""LINGO-051 side-fix: reverse of audit_lemma_links.py.

Turning on the マイノート lane (build-content.mjs now ships non-core
sentences from sentences_imported.jsonl / sentences_imported_lessons.jsonl)
exposed a class of PRE-EXISTING data bug in those files that was invisible
before because they never reached the built deck: a declared `lemmas` entry
that doesn't correspond to ANY token actually present in the sentence's `ru`
text (most likely leftover cruft from LINGO-009-era authoring — e.g. a word
copy-pasted from a similar sentence and never trimmed). This inflates
wordIds beyond the real RU token count, violating build.test.ts's own
invariant (tokenCount >= wordIds.length) the moment these rows started
shipping.

For each sentence, a declared lemma is "orphan" if NO token in the RU text
has ANY pymorphy parse (any POS) whose normal_form/effective_lemma matches
it, and its own surface spelling doesn't literally match a token either
(same literal-fallback rule as audit_lemma_links.is_linked, just applied in
reverse). Orphans are reported for manual confirmation before removal —
never auto-applied blind, per this project's "never guess, always verify"
precedent (LINGO-033/043/049).

Usage:
  python3 audit_orphan_lemmas.py --file sentences_imported.jsonl
  python3 audit_orphan_lemmas.py --file sentences_imported.jsonl --write
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from annotate_cases import MORPH, TOKEN_RE, norm, NOISE_GRAMMEMES  # noqa: E402
from audit_lemma_links import effective_lemma  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def token_lemmas(ru):
    """Every lemma reachable from any token in ru (any POS, any parse) —
    mirrors is_linked's own reachability logic exactly."""
    reachable = set()
    for tok in TOKEN_RE.findall(ru):
        reachable.add(norm(tok))  # literal-surface fallback
        for p in MORPH.parse(tok):
            if p.tag.grammemes & NOISE_GRAMMEMES:
                continue
            reachable.add(norm(p.normal_form))
            reachable.add(effective_lemma(p))
    return reachable


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    path = os.path.join(DATA, args.file)
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]

    total_orphans = 0
    changed = False
    for s in rows:
        if s.get("kind") == "word":
            continue  # word cards' lemmas ARE the whole card; different rule
        ru = s.get("ru", "")
        declared = s.get("lemmas", [])
        if not declared:
            continue
        reachable = token_lemmas(ru)
        orphans = [l for l in declared if norm(l) not in reachable]
        if orphans:
            total_orphans += len(orphans)
            print(f"{s['id']}: orphan lemma(s) {orphans}  | declared={declared} | ru={ru!r}")
            if args.write:
                s["lemmas"] = [l for l in declared if l not in orphans]
                changed = True

    print(f"\ntotal orphan lemmas found: {total_orphans}")
    if args.write and changed:
        with open(path, "w", encoding="utf-8") as f:
            for s in rows:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
        print(f"wrote fixes to {path}")


if __name__ == "__main__":
    main()
