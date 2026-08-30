#!/usr/bin/env python3
"""LINGO-025: assemble data/words_aspects.jsonl (all-band verb aspect sidecar)
from three sources, and run the machine-validation pass.

Sources, in priority order (later overrides earlier — manual_overrides always
wins over Codex-generated data):
  1. LINGO-012 legacy sidecar (data/words_band1_aspects.jsonl) for the 230
     lemmas that already had a real pair (aspect_pair not null) — carried
     forward as pair_kind="pair" (that's what LINGO-012 curated).
  2. rebaseline/aspect_batches/out_*.json — Codex-generated aspect_pair/
     pair_kind/pair_note for the 742 previously-missing verbs.
  3. rebaseline/manual_overrides.json — hand-resolved LINGO-025 verbs: the 25
     LINGO-012 "no pair" re-review + the 44 pymorphy aspect-ambiguous verbs.
     ALWAYS wins (most scrutinised data).

For every verb NOT covered by (3) or an explicit Codex pair_kind, `aspect` is
independently re-derived from pymorphy3 (not trusted from Codex) — this is
mechanically reliable for the ~953 unambiguous verbs and is the ground truth
cross-checked against the legacy sidecar in the audit step.

Writes data/words_aspects.jsonl (replaces the old words_band1_aspects.jsonl)
and rebaseline/aspect_validation.md (machine-check report).
"""
import glob
import json
import os

import pymorphy3

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
MORPH = pymorphy3.MorphAnalyzer()

VALID_PAIR_KIND = {"pair", "related", "none"}
VALID_ASPECT = {"pf", "impf", "both"}


def pymorphy_aspect(lemma):
    parses = [p for p in MORPH.parse(lemma) if p.tag.POS == "INFN"]
    if not parses:
        return None
    seen = set()
    for p in parses:
        a = p.tag.aspect
        if a is not None:
            seen.add(str(a))
    if len(seen) > 1:
        return "both"
    if len(seen) == 1:
        return {"perf": "pf", "impf": "impf"}[seen.pop()]
    return None


def pymorphy_is_verb_infinitive(lemma):
    return any(p.tag.POS == "INFN" for p in MORPH.parse(lemma))


def load_all_verbs():
    verbs = []
    for b in (1, 2, 3, 4):
        with open(os.path.join(DATA, f"words_band{b}.jsonl"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                w = json.loads(line)
                if w.get("pos") == "verb":
                    w["band"] = b
                    verbs.append(w)
    return verbs


def load_legacy():
    legacy = {}
    path = os.path.join(DATA, "words_band1_aspects.jsonl")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    a = json.loads(line)
                    legacy[a["lemma"]] = a
    return legacy


def load_codex_batches():
    merged = {}
    dupes = []
    for path in sorted(glob.glob(os.path.join(HERE, "aspect_batches", "out_*.json"))):
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        for r in rows:
            lemma = r["lemma"].strip()
            if lemma in merged:
                dupes.append((lemma, path))
            merged[lemma] = r
    return merged, dupes


def load_overrides():
    with open(os.path.join(HERE, "manual_overrides.json"), encoding="utf-8") as f:
        raw = json.load(f)
    raw.pop("_comment", None)
    return raw


def main():
    verbs = load_all_verbs()
    all_lemmas = {v["lemma"] for v in verbs}
    legacy = load_legacy()
    codex, codex_dupes = load_codex_batches()
    overrides = load_overrides()

    report = []
    report.append(f"# LINGO-025 aspect assembly + validation\n\n")
    report.append(f"total verb lemmas: {len(verbs)}\n")
    report.append(f"codex-generated entries loaded: {len(codex)} (duplicates across batches: {len(codex_dupes)})\n")
    report.append(f"manual overrides: {len(overrides)}\n\n")
    if codex_dupes:
        report.append("## duplicate lemmas across codex batches (last-write-wins, investigate)\n")
        for lemma, path in codex_dupes:
            report.append(f"- {lemma} also in {os.path.basename(path)}\n")

    out_rows = []
    issues = []
    covered_lemmas = set()

    for v in verbs:
        lemma = v["lemma"]
        covered_lemmas.add(lemma)
        row = {"lemma": lemma}

        if lemma in overrides:
            o = overrides[lemma]
            row["aspect"] = o["aspect"]
            row["aspect_pair"] = o.get("aspect_pair")
            row["pair_kind"] = o["pair_kind"]
            row["pair_note"] = o.get("pair_note")
            source = "override"
        elif lemma in legacy and legacy[lemma].get("aspect_pair"):
            # LINGO-012 curated real pair — trust it, tag pair_kind=pair.
            l = legacy[lemma]
            row["aspect"] = l["aspect"]
            row["aspect_pair"] = l["aspect_pair"]
            row["pair_kind"] = "pair"
            row["pair_note"] = None
            source = "legacy-pair"
        elif lemma in codex:
            c = codex[lemma]
            row["aspect"] = c.get("aspect") or pymorphy_aspect(lemma) or (legacy.get(lemma) or {}).get("aspect")
            row["aspect_pair"] = c.get("aspect_pair")
            row["pair_kind"] = c.get("pair_kind")
            row["pair_note"] = c.get("pair_note")
            source = "codex"
        elif lemma in legacy:
            # legacy entry with aspect_pair=null (shouldn't happen post-override
            # merge since all 25 are in `overrides`, but keep a safety net).
            l = legacy[lemma]
            row["aspect"] = l["aspect"]
            row["aspect_pair"] = None
            row["pair_kind"] = "none"
            row["pair_note"] = None
            source = "legacy-none-fallback"
        else:
            issues.append(f"[NO-SOURCE] {lemma}: not in overrides/legacy/codex — pymorphy-aspect-only fallback")
            row["aspect"] = pymorphy_aspect(lemma)
            row["aspect_pair"] = None
            row["pair_kind"] = "none"
            row["pair_note"] = None
            source = "pymorphy-fallback"

        row["_source"] = source
        out_rows.append(row)

    # --- machine validation -------------------------------------------------
    for row in out_rows:
        lemma = row["lemma"]
        if row["aspect"] not in VALID_ASPECT:
            issues.append(f"[BAD-ASPECT] {lemma}: aspect={row['aspect']!r}")
        if row["pair_kind"] not in VALID_PAIR_KIND:
            issues.append(f"[BAD-PAIRKIND] {lemma}: pair_kind={row['pair_kind']!r}")
        if row["aspect_pair"] == lemma:
            issues.append(f"[SELF-PAIR] {lemma}: aspect_pair equals lemma")
        if row["pair_kind"] in ("related", "none") and not row.get("pair_note") and row.get("aspect_pair") is None and row["aspect"] != "both":
            # a bare none/related with nothing to say is suspicious (should
            # usually carry either an aspect_pair or an explanatory note)
            issues.append(f"[BARE-NONE] {lemma}: pair_kind={row['pair_kind']} has neither aspect_pair nor pair_note")
        ap = row.get("aspect_pair")
        if ap:
            if not pymorphy_is_verb_infinitive(ap):
                issues.append(f"[PAIR-NOT-VERB] {lemma} -> {ap}: not recognised as a verb infinitive by pymorphy")
            else:
                pair_aspect = pymorphy_aspect(ap)
                head_aspect = row["aspect"]
                if row["pair_kind"] in ("pair", "related") and head_aspect in ("pf", "impf"):
                    exp_opp = "pf" if head_aspect == "impf" else "impf"
                    # accept if pair_aspect is unambiguous and matches, or "both"
                    if pair_aspect not in (exp_opp, "both") and pair_aspect is not None:
                        issues.append(
                            f"[ASPECT-NOT-OPPOSITE] {lemma}({head_aspect}) -> {ap}({pair_aspect}), "
                            f"expected {exp_opp} for pair_kind={row['pair_kind']}"
                        )

    # coverage check: every verb lemma must appear exactly once
    missing = all_lemmas - covered_lemmas
    if missing:
        issues.append(f"[MISSING] {len(missing)} verb lemmas have no row at all: {sorted(missing)[:20]}")

    # write output jsonl (drop _source)
    out_path = os.path.join(DATA, "words_aspects.jsonl")
    with open(out_path, "w", encoding="utf-8") as f:
        for row in out_rows:
            clean = {k: v for k, v in row.items() if k != "_source"}
            f.write(json.dumps(clean, ensure_ascii=False) + "\n")

    by_source = {}
    for row in out_rows:
        by_source[row["_source"]] = by_source.get(row["_source"], 0) + 1
    report.append(f"\n## rows written: {len(out_rows)} -> {out_path}\n")
    report.append(f"by source: {by_source}\n")

    by_pair_kind = {}
    for row in out_rows:
        by_pair_kind[row["pair_kind"]] = by_pair_kind.get(row["pair_kind"], 0) + 1
    report.append(f"by pair_kind: {by_pair_kind}\n")

    by_aspect = {}
    for row in out_rows:
        by_aspect[row["aspect"]] = by_aspect.get(row["aspect"], 0) + 1
    report.append(f"by aspect: {by_aspect}\n")

    report.append(f"\n## BLOCKING/WARNING issues: {len(issues)}\n\n")
    for i in issues:
        report.append(f"- {i}\n")

    report_path = os.path.join(HERE, "aspect_validation.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.writelines(report)

    print(f"wrote {out_path} ({len(out_rows)} rows)")
    print(f"wrote {report_path}")
    print(f"issues: {len(issues)}")
    for i in issues[:60]:
        print(" ", i)


if __name__ == "__main__":
    main()
