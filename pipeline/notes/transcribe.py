#!/usr/bin/env python3
"""LINGO-009 transcription driver.

Delegates handwritten-note OCR to `codex exec` (image input), one image at a
time, and appends one structured JSON line per image to
  data/notes/notes_entries.jsonl   -> {image, date_hint, entries:[...]}
Resumable: a manifest (data/notes/manifest.json) records processed images, and
the jsonl is reconciled on startup so an interrupt never double-writes a line.

Codex quality was validated by the backend engineer against direct reads of
IMG_7894 (sentence page) and IMG_1090 (etymology page): RU/EN accurate, kana
best-effort. So the bulk run is delegated to codex; a human self-review pass
(review_sample.py output) spot-checks 10 random pages afterwards.

Usage:
  python3 transcribe.py                 # process all not-yet-done images
  python3 transcribe.py --limit 3       # process at most 3 (for validation)
  python3 transcribe.py --only IMG_7894 # (re)process specific images
  python3 transcribe.py --workers 3     # parallel codex calls (default 3)
"""
import argparse
import concurrent.futures as cf
import json
import os
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
JPEG_DIR = os.path.join(HERE, "jpeg")
DATA_DIR = os.path.join(HERE, "..", "data", "notes")
JSONL = os.path.join(DATA_DIR, "notes_entries.jsonl")
MANIFEST = os.path.join(DATA_DIR, "manifest.json")
PROMPT = open(os.path.join(HERE, "codex_prompt.txt"), encoding="utf-8").read()
DATES_TSV = os.path.join(HERE, "dates.tsv")

_append_lock = threading.Lock()
_manifest_lock = threading.Lock()


def load_dates():
    """image_base -> 'YYYY-MM-DD' from dates.tsv (EXIF creation)."""
    d = {}
    with open(DATES_TSV, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            base, raw = line.split("\t")
            # raw like '2024:09:26 18:45:43'
            day = raw.strip().split(" ")[0].replace(":", "-")
            d[base] = day
    return d


def load_manifest(dates):
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            m = json.load(f)
    else:
        m = {"images": {}}
    # ensure every known image is present, chronologically ordered
    order = sorted(dates, key=lambda b: (dates[b], b))
    for b in order:
        m["images"].setdefault(b, {"date_hint": dates[b], "processed": False})
        m["images"][b]["date_hint"] = dates[b]
    m["_order"] = order
    return m


def save_manifest(m):
    tmp = MANIFEST + ".tmp"
    out = {"images": {k: {"date_hint": v["date_hint"],
                          "processed": v.get("processed", False),
                          "n_entries": v.get("n_entries")}
                      for k, v in m["images"].items()}}
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    os.replace(tmp, MANIFEST)


def images_in_jsonl():
    """Reconcile: which images already have a line written."""
    seen = set()
    if os.path.exists(JSONL):
        with open(JSONL, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    seen.add(json.loads(line)["image"])
                except Exception:
                    pass
    return seen


def run_codex(image_base, date_hint):
    """Call codex exec on one JPEG. Returns list[entry] or raises."""
    jpg = os.path.join(JPEG_DIR, image_base + ".jpg")
    prompt = PROMPT + f"\n\nThis page's date (from photo EXIF) is {date_hint}; " \
             "use it only as context, do not add it to the JSON."
    with tempfile.NamedTemporaryFile("r", suffix=".json", delete=False) as tf:
        outfile = tf.name
    try:
        proc = subprocess.run(
            ["codex", "exec", "-s", "read-only", "--skip-git-repo-check",
             "--color", "never", "-o", outfile, "-i", jpg, "-"],
            input=prompt, capture_output=True, text=True, timeout=300,
        )
        raw = ""
        if os.path.exists(outfile):
            raw = open(outfile, encoding="utf-8").read().strip()
        if not raw:
            raise RuntimeError(f"empty codex output (rc={proc.returncode}): "
                               f"{proc.stderr[-300:]}")
        # strip accidental code fences
        if raw.startswith("```"):
            raw = raw.strip("`")
            raw = raw[raw.find("{"):raw.rfind("}") + 1]
        else:
            raw = raw[raw.find("{"):raw.rfind("}") + 1]
        obj = json.loads(raw)
        entries = obj.get("entries", [])
        if not isinstance(entries, list):
            raise RuntimeError("entries not a list")
        return entries
    finally:
        try:
            os.remove(outfile)
        except OSError:
            pass


def append_line(record):
    with _append_lock:
        with open(JSONL, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())


def process_one(image_base, date_hint, m):
    try:
        entries = run_codex(image_base, date_hint)
    except Exception as e:
        return image_base, None, str(e)
    record = {"image": image_base, "date_hint": date_hint, "entries": entries}
    append_line(record)
    with _manifest_lock:
        m["images"][image_base]["processed"] = True
        m["images"][image_base]["n_entries"] = len(entries)
        save_manifest(m)
    return image_base, len(entries), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    dates = load_dates()
    m = load_manifest(dates)

    # reconcile manifest with what is actually in the jsonl
    already = images_in_jsonl()
    for b in already:
        if b in m["images"]:
            m["images"][b]["processed"] = True
    save_manifest(m)

    if args.only:
        todo = [b for b in args.only if b in m["images"]]
    else:
        todo = [b for b in m["_order"]
                if not m["images"][b]["processed"] and b not in already]
    if args.limit:
        todo = todo[:args.limit]

    print(f"to process: {len(todo)} image(s); "
          f"already done: {sum(1 for v in m['images'].values() if v['processed'])}"
          f"/{len(m['images'])}")
    if not todo:
        return

    done = 0
    errors = []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process_one, b, m["images"][b]["date_hint"], m): b
                for b in todo}
        for fut in cf.as_completed(futs):
            b, n, err = fut.result()
            if err:
                errors.append((b, err))
                print(f"  ERROR {b}: {err[:120]}", flush=True)
            else:
                done += 1
                print(f"  ok {b}: {n} entries  ({done}/{len(todo)})", flush=True)

    print(f"\ndone={done} errors={len(errors)}")
    for b, err in errors:
        print(f"  {b}: {err[:200]}")


if __name__ == "__main__":
    main()
