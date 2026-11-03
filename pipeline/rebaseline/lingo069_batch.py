#!/usr/bin/env python3
"""LINGO-069 generation helpers.

  next [N]        print the next N unwritten plan rows (default 25) with
                  everything needed to write the sentence: assigned id, target
                  lemma + pos/gender/aspect pair, glosses, and the assigned
                  subject bucket. Reads the cursor from lingo069_manifest.json
                  but recomputes it from what is actually on disk first, so a
                  crash mid-batch can never skip a row.
  status          print on-disk progress for sentences and commentary.
  bump            recompute the manifest cursors from disk and rewrite it.
  verify-lemmas   check that a list of lemmas (stdin, one per line) all exist
                  in words_band1-4 — a pre-flight for wrapping words so a
                  whole batch isn't rejected by review_sentences.py.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
EXPLAIN = os.path.join(DATA, "explain")
PLAN = os.path.join(HERE, "lingo069_plan.json")
MANIFEST = os.path.join(HERE, "lingo069_manifest.json")

BAND_FILE = {2: "sentences_band2_core.jsonl", 3: "sentences_band3_core.jsonl"}


def load_plan():
    with open(PLAN, encoding="utf-8") as f:
        return json.load(f)


def ids_in(path, key="id"):
    out = set()
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.add(json.loads(line)[key])
    return out


def on_disk():
    """Return (sentence_ids, commentary_ids_ja, commentary_ids_en) restricted
    to this task's id blocks."""
    sent = set()
    for band, fname in BAND_FILE.items():
        sent |= ids_in(os.path.join(DATA, fname))
    ja = ids_in(os.path.join(EXPLAIN, "sentence_commentary_ja.jsonl"))
    en = ids_in(os.path.join(EXPLAIN, "sentence_commentary_en.jsonl"))
    return sent, ja, en


def cursor(plan, done_ids):
    """Highest index i such that plan[0..i] are all present. Deliberately a
    prefix scan, not a count: an out-of-order write must not advance the
    cursor past a hole."""
    i = -1
    for idx, row in enumerate(plan):
        if row["id"] in done_ids:
            i = idx
        else:
            break
    return i


def cmd_status():
    plan = load_plan()
    sent, ja, en = on_disk()
    want = {r["id"] for r in plan}
    s_done = want & sent
    c_done = want & ja & en
    print(f"plan rows            : {len(plan)}")
    print(f"sentences written    : {len(s_done)}  (cursor {cursor(plan, sent)})")
    print(f"commentary ja+en both: {len(c_done)}  (cursor {cursor(plan, ja & en)})")
    only_ja = (want & ja) - en
    only_en = (want & en) - ja
    if only_ja or only_en:
        print(f"  !! one-sided commentary: ja-only {len(only_ja)} {sorted(only_ja)[:5]}, "
              f"en-only {len(only_en)} {sorted(only_en)[:5]}")
    orphan = s_done - c_done
    if orphan:
        print(f"  !! sentences with NO complete commentary: {len(orphan)} "
              f"{sorted(orphan)[:10]}")
    else:
        print("  ok: every written sentence has ja+en commentary")


def cmd_bump():
    plan = load_plan()
    sent, ja, en = on_disk()
    with open(MANIFEST, encoding="utf-8") as f:
        man = json.load(f)
    want = {r["id"] for r in plan}
    man["sentences_last_index"] = cursor(plan, sent)
    man["sentences_done"] = len(want & sent)
    man["commentary_last_index"] = cursor(plan, ja & en)
    man["commentary_done"] = len(want & ja & en)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: man[k] for k in
                      ("sentences_done", "sentences_last_index",
                       "commentary_done", "commentary_last_index")},
                     ensure_ascii=False))


def cmd_next(n):
    plan = load_plan()
    sent, ja, en = on_disk()
    todo = [r for r in plan if r["id"] not in sent][:n]
    if not todo:
        print("ALL SENTENCES DONE")
        todo_c = [r for r in plan if not (r["id"] in ja and r["id"] in en)][:n]
        if todo_c:
            print(f"commentary still needed for {len(todo_c)} shown:")
            for r in todo_c:
                print(f"  {r['id']}  {r['lemma']}")
        return
    print(f"# next {len(todo)} of {len([r for r in plan if r['id'] not in sent])} remaining")
    print("# id\tband\trank\tlemma\tpos\tbucket\tgender\taspect\tpair\tkind\ten\tja")
    for r in todo:
        print("\t".join(str(r.get(c) or "") for c in
                        ("id", "band", "rank", "lemma", "pos", "target_bucket",
                         "gender", "aspect", "aspect_pair", "pair_kind",
                         "en_gloss", "ja_gloss")))


def cmd_verify_lemmas():
    known = set()
    for b in (1, 2, 3, 4):
        with open(os.path.join(DATA, f"words_band{b}.jsonl"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    known.add(json.loads(line)["lemma"])
    bad = []
    for line in sys.stdin:
        lem = line.strip()
        if lem and lem not in known:
            bad.append(lem)
    if bad:
        print("NOT IN words_band1-4:", bad)
        sys.exit(1)
    print("all lemmas resolve")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "next":
        cmd_next(int(sys.argv[2]) if len(sys.argv) > 2 else 25)
    elif cmd == "status":
        cmd_status()
    elif cmd == "bump":
        cmd_bump()
    elif cmd == "verify-lemmas":
        cmd_verify_lemmas()
    else:
        raise SystemExit(__doc__)
