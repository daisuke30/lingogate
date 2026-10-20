#!/usr/bin/env python3
"""LINGO-059 helper: dump the next v2-enrichment batch, and merge generated v2
fields back into the explain JSONL files in place.

Why this lives in the repo: the v2 walk is incremental over many sessions, and
the cursor state (manifest.json) plus this tool are the only things a fresh
session needs in order to resume exactly where the last one stopped.

Usage
-----
Dump the next batch of source material to generate from:
    python3 pipeline/rebaseline/explain_v2_batch.py dump sentences --count 25
    python3 pipeline/rebaseline/explain_v2_batch.py dump verbs --count 25

Merge a generated batch file back in (file shape documented in merge_file()):
    python3 pipeline/rebaseline/explain_v2_batch.py merge <batch.json>

The merge recomputes the manifest counters/cursors from the data itself, so a
partial or repeated merge can never desynchronise the cursor from reality.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXPLAIN = os.path.abspath(os.path.join(HERE, "..", "data", "explain"))

SENTENCE_V2_KEYS = ("grammarFocus", "variations", "paraphrases", "takeaway")
WORD_V2_KEYS = ("governance", "aspectExamples", "synonymComparison", "formExamples")


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path, rows):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def flatten_forms(forms):
    """Same key shape validate_explain.py expects: "<group>.<key>", skipping
    missing forms marked "—"."""
    out = {}
    for group, val in (forms or {}).items():
        if isinstance(val, dict):
            for k, v in val.items():
                if v and v != "—":
                    out[f"{group}.{k}"] = v
        elif val and val != "—":
            out[group] = val
    return out


def manifest_path():
    return os.path.join(EXPLAIN, "manifest.json")


def load_manifest():
    with open(manifest_path(), encoding="utf-8") as fh:
        return json.load(fh)


def save_manifest(m):
    tmp = manifest_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(m, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, manifest_path())


def has_v2(row, keys):
    return any(k in row for k in keys)


# ---------------------------------------------------------------- dump


def dump_sentences(count):
    order = json.load(open(os.path.join(EXPLAIN, "sentence_order.json"), encoding="utf-8"))
    rows = {r["id"]: r for r in load_jsonl(os.path.join(EXPLAIN, "sentence_commentary_ja.jsonl"))}
    out = []
    for idx, s in enumerate(order):
        if len(out) >= count:
            break
        row = rows.get(s["id"])
        if row is None or has_v2(row, SENTENCE_V2_KEYS):
            continue
        out.append(
            {
                "i": idx,
                "id": s["id"],
                "ru": s["ru"],
                "target_lemma": s.get("target_lemma"),
                "keyPoint": row.get("keyPoint"),
            }
        )
    print(json.dumps(out, ensure_ascii=False, indent=1))


def dump_verbs(count):
    order = json.load(open(os.path.join(EXPLAIN, "verb_order.json"), encoding="utf-8"))
    rows = {r["lemma"]: r for r in load_jsonl(os.path.join(EXPLAIN, "word_dict_ja.jsonl"))}
    out = []
    for idx, v in enumerate(order):
        if len(out) >= count:
            break
        row = rows.get(v["lemma"])
        if row is None or has_v2(row, WORD_V2_KEYS):
            continue
        out.append(
            {
                "i": idx,
                "lemma": v["lemma"],
                "formKeys": flatten_forms(row.get("forms")),
                "aspectUsage": row.get("aspectUsage"),
                "related": row.get("related"),
                "collocations": row.get("collocations"),
                "commonMistakes": row.get("commonMistakes"),
            }
        )
    print(json.dumps(out, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------- merge


def merge_file(path):
    """Batch file shape:

        {"kind": "sentences"|"verbs",
         "ja": {"<id or lemma>": {<v2 fields>}, ...},
         "en": {"<id or lemma>": {<v2 fields>}, ...}}
    """
    with open(path, encoding="utf-8") as fh:
        batch = json.load(fh)
    kind = batch["kind"]
    if kind == "sentences":
        keyfield, fname, v2keys = "id", "sentence_commentary_{}.jsonl", SENTENCE_V2_KEYS
    elif kind == "verbs":
        keyfield, fname, v2keys = "lemma", "word_dict_{}.jsonl", WORD_V2_KEYS
    else:
        sys.exit(f"unknown kind: {kind!r}")

    ja_keys = set(batch.get("ja", {}))
    en_keys = set(batch.get("en", {}))
    if ja_keys != en_keys:
        sys.exit(
            "ja/en key sets differ; ja-only=%s en-only=%s"
            % (sorted(ja_keys - en_keys), sorted(en_keys - ja_keys))
        )

    touched = 0
    for lang in ("ja", "en"):
        entries = batch.get(lang, {})
        path_l = os.path.join(EXPLAIN, fname.format(lang))
        rows = load_jsonl(path_l)
        index = {r.get(keyfield): r for r in rows}
        missing = [k for k in entries if k not in index]
        if missing:
            sys.exit(f"[{lang}] keys not present in {fname.format(lang)}: {missing}")
        for k, v2 in entries.items():
            row = index[k]
            for vk in v2keys:
                row.pop(vk, None)
            for vk, vv in v2.items():
                if vk not in v2keys:
                    sys.exit(f"[{lang}] {k}: unexpected v2 field {vk!r}")
                row[vk] = vv
            touched += 1
        write_jsonl(path_l, rows)

    refresh_manifest()
    print(f"merged {kind}: {len(ja_keys)} entries x2 langs ({touched} row updates)")


def refresh_manifest():
    """Recompute done counts and contiguous cursors straight from the data."""
    m = load_manifest()

    s_order = json.load(open(os.path.join(EXPLAIN, "sentence_order.json"), encoding="utf-8"))
    s_rows = {r["id"]: r for r in load_jsonl(os.path.join(EXPLAIN, "sentence_commentary_ja.jsonl"))}
    s_done_ids = {sid for sid, r in s_rows.items() if has_v2(r, SENTENCE_V2_KEYS)}
    s_cursor = -1
    for idx, s in enumerate(s_order):
        if s["id"] in s_done_ids:
            s_cursor = idx
        else:
            break

    v_order = json.load(open(os.path.join(EXPLAIN, "verb_order.json"), encoding="utf-8"))
    w_rows = {r["lemma"]: r for r in load_jsonl(os.path.join(EXPLAIN, "word_dict_ja.jsonl"))}
    v_done = {l for l, r in w_rows.items() if has_v2(r, WORD_V2_KEYS)}
    v_cursor = -1
    for idx, v in enumerate(v_order):
        if v["lemma"] in v_done:
            v_cursor = idx
        else:
            break

    m["v2_words_total"] = len(v_order)
    m["v2_words_done"] = len([v for v in v_order if v["lemma"] in v_done])
    m["v2_words_last_verb_index"] = v_cursor
    m["v2_sentences_total"] = len(s_order)
    m["v2_sentences_done"] = len([s for s in s_order if s["id"] in s_done_ids])
    m["v2_sentences_last_index"] = s_cursor
    save_manifest(m)
    print(
        "manifest: verbs %d/%d (cursor %d) | sentences %d/%d (cursor %d)"
        % (
            m["v2_words_done"],
            m["v2_words_total"],
            v_cursor,
            m["v2_sentences_done"],
            m["v2_sentences_total"],
            s_cursor,
        )
    )


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dump")
    d.add_argument("what", choices=["sentences", "verbs"])
    d.add_argument("--count", type=int, default=25)
    mg = sub.add_parser("merge")
    mg.add_argument("file")
    sub.add_parser("refresh")
    args = ap.parse_args()

    if args.cmd == "dump":
        (dump_sentences if args.what == "sentences" else dump_verbs)(args.count)
    elif args.cmd == "merge":
        merge_file(args.file)
    else:
        refresh_manifest()


if __name__ == "__main__":
    main()
