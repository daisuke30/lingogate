#!/usr/bin/env python3
"""LingoGate content importer.

Builds lingogate.db from the reviewable JSONL sources in ./data/:
  - words_band*.jsonl      one lemma per line
  - sentences_band*.jsonl  one example sentence per line

Standard library only (sqlite3, json). Idempotent: re-running rebuilds the
content tables (Deck / Word / Sentence / sentence_words) from the JSONL while
leaving user tables (ReviewState / GateSession) untouched. Adding
words_band2.jsonl / sentences_band2.jsonl and re-running picks them up with no
code change.

Usage:
    python3 import.py                # build ./lingogate.db, print coverage
    python3 import.py --db out.db    # custom output path
    python3 import.py --data ./data  # custom source dir

Design ref: ai-org/Ideas/20260703-quiz-gate-app-design.md §5
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

DECK_CODE = "RU-from-EN"
DECK = {
    "code": DECK_CODE,
    "name": "Russian from English (frequency bands)",
    "target_lang": "ru",
    "source_lang": "en",
}


def load_jsonl(path):
    """Yield (line_no, obj) for each non-blank line; raise on malformed JSON."""
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield i, json.loads(line)
            except json.JSONDecodeError as e:
                raise SystemExit(f"{path}:{i}: invalid JSON: {e}")


def ensure_schema(conn):
    with open(os.path.join(HERE, "schema.sql"), encoding="utf-8") as f:
        conn.executescript(f.read())
    ensure_migrations(conn)


def ensure_migrations(conn):
    """Idempotent ALTER TABLEs for columns added after the initial schema.

    LINGO-009: handwritten-note import adds
      Sentence.kind  ('sentence' | 'word')  -- 'word' = a vocab flashcard page
      Sentence.kana  (katakana pronunciation, best-effort, may be NULL)
      Sentence.note  (etymology / grammar note the author wrote, may be NULL)
    All are NULL/defaulted so existing iOS SELECTs (explicit column lists) and
    the generated 291-sentence deck are unaffected.
    """
    have = {row[1] for row in conn.execute("PRAGMA table_info(Sentence)")}
    if "kind" not in have:
        conn.execute("ALTER TABLE Sentence ADD COLUMN kind TEXT NOT NULL "
                     "DEFAULT 'sentence'")
    if "kana" not in have:
        conn.execute("ALTER TABLE Sentence ADD COLUMN kana TEXT")
    if "note" not in have:
        conn.execute("ALTER TABLE Sentence ADD COLUMN note TEXT")
    # LINGO-011: the single band-vocab lemma a sentence is built to teach.
    if "target_lemma" not in have:
        conn.execute("ALTER TABLE Sentence ADD COLUMN target_lemma TEXT")
    # LINGO-012: verb aspect + its aspectual partner, for the card-back
    # word-breakdown feature. NULL for non-verbs.
    have_word = {row[1] for row in conn.execute("PRAGMA table_info(Word)")}
    if "aspect" not in have_word:
        conn.execute("ALTER TABLE Word ADD COLUMN aspect TEXT")
    if "aspect_pair" not in have_word:
        conn.execute("ALTER TABLE Word ADD COLUMN aspect_pair TEXT")
    # LINGO-022: noun grammatical gender for the card-back word-breakdown.
    if "gender" not in have_word:
        conn.execute("ALTER TABLE Word ADD COLUMN gender TEXT")
    # LINGO-025: pair_kind ('pair'|'related'|'none') + pair_note — every verb
    # must show SOME aspect info on the card back, never a bare "no pair".
    if "pair_kind" not in have_word:
        conn.execute("ALTER TABLE Word ADD COLUMN pair_kind TEXT")
    if "pair_note" not in have_word:
        conn.execute("ALTER TABLE Word ADD COLUMN pair_note TEXT")


def upsert_deck(conn):
    conn.execute(
        """INSERT INTO Deck (code, name, target_lang, source_lang)
           VALUES (:code, :name, :target_lang, :source_lang)
           ON CONFLICT(code) DO UPDATE SET
             name=excluded.name,
             target_lang=excluded.target_lang,
             source_lang=excluded.source_lang""",
        DECK,
    )
    return conn.execute("SELECT id FROM Deck WHERE code=?", (DECK_CODE,)).fetchone()[0]


def word_paths(data_dir):
    """data/words_band<N>.jsonl only — excludes sidecar files like
    words_band1_aspects.jsonl (see word_aspect_paths), which would otherwise
    also match a loose words_band*.jsonl glob and corrupt Word rows (pos
    would be blanked out by the sidecar's narrower schema)."""
    paths = glob.glob(os.path.join(data_dir, "words_band*.jsonl"))
    return sorted(p for p in paths if re.match(r"^words_band\d+\.jsonl$", os.path.basename(p)))


def word_aspect_paths(data_dir):
    """LINGO-025: data/words_aspects.jsonl — the consolidated, all-band verb
    aspect sidecar (replaces LINGO-012's per-band words_band1_aspects.jsonl,
    which only ever covered band1). Also still picks up any stray legacy
    words_band<N>_aspects.jsonl for backward compatibility during migration."""
    paths = glob.glob(os.path.join(data_dir, "words_aspects.jsonl"))
    paths += glob.glob(os.path.join(data_dir, "words_band*_aspects.jsonl"))
    return sorted(
        p for p in paths
        if re.match(r"^words_aspects\.jsonl$|^words_band\d+_aspects\.jsonl$", os.path.basename(p))
    )


def import_words(conn, deck_id, data_dir):
    """Import every data/words_band<N>.jsonl. Returns count imported."""
    paths = word_paths(data_dir)
    if not paths:
        print("WARNING: no words_band*.jsonl found", file=sys.stderr)
    n = 0
    for path in paths:
        band = band_from_filename(path)
        for lineno, w in load_jsonl(path):
            lemma = w["lemma"].strip()
            conn.execute(
                """INSERT INTO Word (deck_id, lemma, rank, band, pos, en_gloss, ja_gloss, gender)
                   VALUES (?,?,?,?,?,?,?,?)
                   ON CONFLICT(deck_id, lemma) DO UPDATE SET
                     rank=excluded.rank, band=excluded.band, pos=excluded.pos,
                     en_gloss=excluded.en_gloss, ja_gloss=excluded.ja_gloss,
                     gender=excluded.gender""",
                (deck_id, lemma, w.get("rank"), w.get("band", band),
                 w.get("pos", ""), w.get("en_gloss"), w.get("ja_gloss"),
                 w.get("gender")),
            )
            n += 1
    return n


def import_word_aspects(conn, deck_id, data_dir):
    """Apply data/words_aspects.jsonl (LINGO-012, extended to all bands by
    LINGO-025) on top of Word rows already inserted by import_words.
    UPDATE-only: a lemma not present in Word (e.g. typo, or word pruned) is
    reported back as unmatched, not inserted. Idempotent — same file
    re-applied yields identical column values.
    """
    paths = word_aspect_paths(data_dir)
    n = 0
    unmatched = []
    for path in paths:
        for lineno, a in load_jsonl(path):
            lemma = a["lemma"].strip()
            cur = conn.execute(
                """UPDATE Word SET aspect=?, aspect_pair=?, pair_kind=?, pair_note=?
                   WHERE deck_id=? AND lemma=?""",
                (a.get("aspect"), a.get("aspect_pair"), a.get("pair_kind"),
                 a.get("pair_note"), deck_id, lemma),
            )
            if cur.rowcount == 0:
                unmatched.append(lemma)
            else:
                n += 1
    return n, unmatched


def import_sentences(conn, deck_id, data_dir):
    """Import every data/sentences_band*.jsonl and rebuild their word links.

    Returns (count, unmatched_lemmas) where unmatched_lemmas maps
    lemma -> [sentence_ids] for lemmas listed in a sentence but absent from Word.
    """
    # lemma -> word_id lookup for this deck
    lemma_to_id = {
        row[0]: row[1]
        for row in conn.execute("SELECT lemma, id FROM Word WHERE deck_id=?", (deck_id,))
    }
    paths = sentence_paths(data_dir)
    if not paths:
        print("WARNING: no sentence jsonl found", file=sys.stderr)
    n = 0
    unmatched = {}
    seen_ids = set()
    for path in paths:
        band = band_from_filename(path)
        for lineno, s in load_jsonl(path):
            sid = str(s["id"]).strip()
            if sid in seen_ids:
                raise SystemExit(f"{path}:{lineno}: duplicate sentence id {sid!r}")
            seen_ids.add(sid)
            conn.execute(
                """INSERT INTO Sentence
                     (id, deck_id, ru, en, ja, band, difficulty, source, kind,
                      kana, note, target_lemma)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET
                     deck_id=excluded.deck_id, ru=excluded.ru, en=excluded.en,
                     ja=excluded.ja, band=excluded.band,
                     difficulty=excluded.difficulty, source=excluded.source,
                     kind=excluded.kind, kana=excluded.kana, note=excluded.note,
                     target_lemma=excluded.target_lemma""",
                (sid, deck_id, s["ru"], s["en"], s.get("ja"),
                 s.get("band", band), s.get("difficulty", 1),
                 s.get("source", "generated"), s.get("kind", "sentence"),
                 s.get("kana"), s.get("note"), s.get("target_lemma")),
            )
            # rebuild links for this sentence
            conn.execute("DELETE FROM sentence_words WHERE sentence_id=?", (sid,))
            for lemma in s.get("lemmas", []):
                lemma = lemma.strip()
                wid = lemma_to_id.get(lemma)
                if wid is None:
                    unmatched.setdefault(lemma, []).append(sid)
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO sentence_words (sentence_id, word_id) VALUES (?,?)",
                    (sid, wid),
                )
            n += 1
    return n, unmatched


def band_from_filename(path):
    m = re.search(r"band(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else 1


def sentence_paths(data_dir):
    """All sentence sources: frequency-band decks plus the LINGO-009 imported
    handwritten-note deck (sentences_imported*.jsonl, band 1 by default since
    the filename has no bandN — band_from_filename returns 1)."""
    paths = glob.glob(os.path.join(data_dir, "sentences_band*.jsonl"))
    paths += glob.glob(os.path.join(data_dir, "sentences_imported*.jsonl"))
    return sorted(paths)


def prune_stale(conn, deck_id, data_dir):
    """Remove Word/Sentence rows for this deck that are no longer in any JSONL,
    keeping the DB a faithful rebuild of the source files."""
    live_lemmas = set()
    for path in word_paths(data_dir):
        for _, w in load_jsonl(path):
            live_lemmas.add(w["lemma"].strip())
    live_sids = set()
    for path in sentence_paths(data_dir):
        for _, s in load_jsonl(path):
            live_sids.add(str(s["id"]).strip())

    for (lemma,) in conn.execute(
        "SELECT lemma FROM Word WHERE deck_id=?", (deck_id,)
    ).fetchall():
        if lemma not in live_lemmas:
            conn.execute("DELETE FROM Word WHERE deck_id=? AND lemma=?", (deck_id, lemma))
    for (sid,) in conn.execute(
        "SELECT id FROM Sentence WHERE deck_id=?", (deck_id,)
    ).fetchall():
        if sid not in live_sids:
            conn.execute("DELETE FROM Sentence WHERE id=?", (sid,))


def coverage_report(conn, deck_id):
    print("\n=== Coverage report (deck %s) ===" % DECK_CODE)
    bands = [r[0] for r in conn.execute(
        "SELECT DISTINCT band FROM Word WHERE deck_id=? ORDER BY band", (deck_id,))]
    grand_uncovered = []
    for band in bands:
        total = conn.execute(
            "SELECT COUNT(*) FROM Word WHERE deck_id=? AND band=?", (deck_id, band)
        ).fetchone()[0]
        covered = conn.execute(
            """SELECT COUNT(DISTINCT w.id)
                 FROM Word w JOIN sentence_words sw ON sw.word_id=w.id
                WHERE w.deck_id=? AND w.band=?""",
            (deck_id, band),
        ).fetchone()[0]
        n_sent = conn.execute(
            "SELECT COUNT(*) FROM Sentence WHERE deck_id=? AND band=?", (deck_id, band)
        ).fetchone()[0]
        pct = (100.0 * covered / total) if total else 0.0
        print(f"  band{band}: {covered}/{total} words covered ({pct:.1f}%), "
              f"{n_sent} sentences")
        uncovered = [r[0] for r in conn.execute(
            """SELECT w.lemma FROM Word w
                 WHERE w.deck_id=? AND w.band=?
                   AND w.id NOT IN (SELECT word_id FROM sentence_words)
                 ORDER BY w.rank""",
            (deck_id, band),
        )]
        grand_uncovered += [(band, u) for u in uncovered]
    if grand_uncovered:
        print(f"\n  Uncovered lemmas ({len(grand_uncovered)}):")
        line = []
        for band, lemma in grand_uncovered:
            line.append(lemma)
            if len(line) == 12:
                print("    " + "  ".join(line))
                line = []
        if line:
            print("    " + "  ".join(line))


def main():
    ap = argparse.ArgumentParser(description="Build lingogate.db from JSONL sources")
    ap.add_argument("--db", default=os.path.join(HERE, "lingogate.db"))
    ap.add_argument("--data", default=os.path.join(HERE, "data"))
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        ensure_schema(conn)
        deck_id = upsert_deck(conn)
        nw = import_words(conn, deck_id, args.data)
        na, unmatched_aspects = import_word_aspects(conn, deck_id, args.data)
        ns, unmatched = import_sentences(conn, deck_id, args.data)
        prune_stale(conn, deck_id, args.data)
        conn.commit()
    finally:
        pass

    print(f"Imported {nw} words, {ns} sentences into {args.db}")
    if na:
        print(f"Applied aspect/aspect_pair to {na} word(s)")
    if unmatched_aspects:
        print(f"\nWARNING: {len(unmatched_aspects)} aspect-file lemma(s) not found "
              f"in Word table: {unmatched_aspects[:10]}"
              + (" ..." if len(unmatched_aspects) > 10 else ""))
    if unmatched:
        print(f"\nWARNING: {len(unmatched)} sentence lemma(s) not found in Word table "
              f"(fix the words list or the sentence's `lemmas`):")
        for lemma, sids in sorted(unmatched.items()):
            print(f"  {lemma!r} referenced by {sids[:5]}"
                  + (" ..." if len(sids) > 5 else ""))
    coverage_report(conn, deck_id)
    conn.close()


if __name__ == "__main__":
    main()
