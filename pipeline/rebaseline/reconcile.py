#!/usr/bin/env python3
"""LINGO-020 工程2 — 3-point reconciliation: subtitle frequency (primary) x
ТРКИ B1 boost x current band1-3 placement -> candidate new band1-3 (+band4
retirement pool for words that fall out but must not be deleted).

Inputs (all in this dir / ../data):
  subtitle_lemma_freq.tsv      rank\tlemma\tcount   (stage1 output, primary axis)
  trki_b1_core.txt             boost list (authored, see README)
  ../data/words_band1.jsonl    current band1 (1-1000)
  ../data/words_band2.jsonl    current band2 (1001-2000)
  ../data/words_band3.jsonl    current band3 (2001-3000)

Outputs (this dir):
  candidate_bands.tsv   new_rank  lemma  new_band  old_band  old_rank
                         subtitle_rank  subtitle_count  in_trki  is_new_inflow
                         pos  en_gloss  ja_gloss   (pos/glosses only when known
                         from the old band data; blank for new inflow -> stage3
                         fills these in)
  report.md             top30 check, band1 retention rate, dropped/added lists

Algorithm
---------
Primary axis = subtitle lemma rank (from stage1's lemma aggregation).
Boost = ТРКИ-B1 core lemmas get their effective rank multiplied by BOOST_FACTOR
  (<1, i.e. moved up / earlier) when they DO have a subtitle rank. A TRKI lemma
  with no subtitle rank at all (rare — core vocab is almost always in the top
  18k) gets a synthetic near-band3 rank so it's not lost outright, logged as
  "trki_only".
Reconcile current band1-3: any current-band lemma not reached via the subtitle
  LEMMA table is re-placed by its own rank there if it appears anywhere,
  however far down. Some current "lemmas" are pedagogical case-forms the app
  treats as their own dictionary entry (его/их/себя/должен/может/чем/во/...)
  that pymorphy folds into a DIFFERENT normal_form (он/он/себя/должный/мочь/
  что/в) during lemma aggregation, so they never surface as their own row in
  subtitle_lemma_freq.tsv and would wrongly look signal-less despite being
  top-150 words. Fallback: look the exact string up in the RAW (unlemmatised)
  surface-frequency table (ru_50k.txt) instead — for a word the app already
  treats as its own unit, its own surface frequency is the fairer proxy. Only
  lemmas absent from BOTH the lemma table and the raw surface table (genuine
  multi-word entries like "если бы", "пока что") fall through to the "no
  signal" tier and rank last -> candidates for band4 retirement, logged
  individually with the reason.
New inflow filtering: a lemma that is NOT already in the current 3000 and is
  reached only via the subtitle list is excluded if pymorphy tags it as a
  proper name / patronymic / surname / geographic name (subtitle corpora are
  full of character names) UNLESS it is also in the TRKI boost list.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

BOOST_FACTOR = 0.6          # TRKI lemmas rank as if this fraction of their subtitle rank
TRKI_ONLY_BASE_RANK = 2600  # synthetic rank tier for TRKI lemmas absent from subtitle list
SUBTITLE_SCAN_LIMIT = 8000  # only need a buffer well past 3000 for filtering losses
TOP_N = 3000

# pymorphy grammemes that mark a lemma as a proper name, not a common word.
PROPER_NOUN_GRAMMEMES = {"Name", "Surn", "Patr", "Geox"}


def norm(lemma):
    """Matching key: lowercase, ё->е (band2/3 and the boost/current data are
    not consistently ё-marked; see README limits)."""
    return lemma.strip().lower().replace("ё", "е")


def load_raw_surface(path):
    """-> dict lower_surface -> (rank, count), from the RAW (unlemmatised)
    ru_50k.txt, ranked by count. Fallback signal for current-band lemmas that
    are actually fixed case-forms (see module docstring)."""
    entries = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) != 2:
                continue
            surf, cnt = parts[0].lower(), parts[1]
            try:
                cnt = int(cnt)
            except ValueError:
                continue
            entries.append((surf, cnt))
    entries.sort(key=lambda x: -x[1])
    out = {}
    for i, (surf, cnt) in enumerate(entries, 1):
        if surf not in out:
            out[surf] = (i, cnt)
    return out


def load_subtitle_freq(path):
    """-> dict norm_lemma -> (rank, count, canonical_lemma_with_ё)"""
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            rank_s, lemma, count_s = line.rstrip("\n").split("\t")
            key = norm(lemma)
            # file is already rank-sorted; first occurrence per norm key wins
            # (norm can collapse two distinct ё/е spellings pymorphy emitted
            # separately onto one key -- keep the higher-frequency one, i.e.
            # first seen, since the file is frequency-descending).
            if key not in out:
                out[key] = (int(rank_s), int(count_s), lemma)
    return out


def load_trki(path):
    """-> (norm_set for the boost check, ordered list of original tokens for
    the trki_only synthetic tier, spelling preserved as authored)."""
    norm_set = set()
    tokens = []
    seen = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            for tok in line.split():
                norm_set.add(norm(tok))
                if tok not in seen:
                    seen.add(tok)
                    tokens.append(tok)
    return norm_set, tokens


def load_band_file(path, band):
    """-> dict keyed by EXACT lemma text (not norm!) — ё/е-differing lemmas
    that are genuinely distinct current words (e.g. "все" vs "всё") must not
    collide here. norm() is only used later, as a cross-source matching key
    against the subtitle table, via a separate norm_to_current index."""
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            w = json.loads(line)
            out[w["lemma"]] = {
                "lemma": w["lemma"],
                "old_band": band,
                "old_rank": w.get("rank"),
                "pos": w.get("pos", ""),
                "en_gloss": w.get("en_gloss"),
                "ja_gloss": w.get("ja_gloss"),
            }
    return out


def is_proper_noun(lemma, morph):
    try:
        p = morph.parse(lemma)[0]
        tagset = set(str(p.tag).replace(",", " ").split())
        return bool(tagset & PROPER_NOUN_GRAMMEMES)
    except Exception:
        return False


def main():
    try:
        import pymorphy3
        morph = pymorphy3.MorphAnalyzer()
    except ImportError:
        print("pymorphy3 not available (activate pipeline/rebaseline/.venv)", file=sys.stderr)
        sys.exit(1)

    subtitle = load_subtitle_freq(os.path.join(HERE, "subtitle_lemma_freq.tsv"))
    raw_surface = load_raw_surface(os.path.join(HERE, "ru_50k.txt"))
    trki_norm, trki_tokens = load_trki(os.path.join(HERE, "trki_b1_core.txt"))

    band1 = load_band_file(os.path.join(DATA, "words_band1.jsonl"), 1)
    band2 = load_band_file(os.path.join(DATA, "words_band2.jsonl"), 2)
    band3 = load_band_file(os.path.join(DATA, "words_band3.jsonl"), 3)
    current = {}
    for d in (band1, band2, band3):
        current.update(d)  # dedup across bands: none expected, last wins if any

    # norm_key -> [exact current lemmas sharing it]. Almost always length 1;
    # verified exception: "все" (everyone) / "всё" (everything) both norm to
    # "все" — both are kept as distinct pool entries below, sharing whatever
    # subtitle signal the (ё-dropping) corpus gives that norm bucket. This is
    # a genuine corpus ambiguity, not a pipeline bug (logged in report.md).
    norm_to_current = {}
    for exact_lemma in current:
        norm_to_current.setdefault(norm(exact_lemma), []).append(exact_lemma)

    # Current lemmas whose pymorphy normal_form is a DIFFERENT lemma than the
    # spelling the app already uses pedagogically (должен -> должный; ладно ->
    # ладный; каков -> каковой; ...). Left unhandled, that pymorphy-preferred
    # form would be pulled in separately as "new inflow" from the subtitle
    # list — a near-duplicate of a word already in the deck. Scoped precisely:
    # only when (a) the difference is NOT just ё/е spelling (that's already
    # reconciled by norm_to_current matching above) and (b) the pymorphy form
    # isn't ITSELF already a distinct current lemma (which would mean it's
    # legitimately a separate word, not a duplicate). Checked across all 3000
    # current lemmas: 14 genuine cases — see report.md for the full list.
    predic_long_forms = set()
    for exact_lemma in current:
        try:
            nf = morph.parse(exact_lemma)[0].normal_form
        except Exception:
            continue
        if nf == exact_lemma or norm(nf) == norm(exact_lemma) or nf in current:
            continue
        predic_long_forms.add(nf)

    # --- build candidate pool -------------------------------------------------
    pool = {}  # EXACT lemma -> dict (never the norm-collapsed key)
    excluded_proper = []  # log of new-inflow lemmas dropped as proper nouns
    excluded_predic_dup = []  # log of long-form adjectives dropped as duplicates

    subtitle_ranked = sorted(subtitle.items(), key=lambda kv: kv[1][0])[:SUBTITLE_SCAN_LIMIT]
    for norm_key, (rank, count, canon) in subtitle_ranked:
        in_trki = norm_key in trki_norm
        matched_current = norm_to_current.get(norm_key, [])
        effective = rank * BOOST_FACTOR if in_trki else float(rank)
        if matched_current:
            for exact_lemma in matched_current:
                if exact_lemma in pool:
                    continue
                w = current[exact_lemma]
                pool[exact_lemma] = {
                    "lemma": exact_lemma,
                    "effective": effective,
                    "subtitle_rank": rank,
                    "subtitle_count": count,
                    "in_trki": in_trki,
                    "old_band": w["old_band"],
                    "old_rank": w["old_rank"],
                    "pos": w["pos"],
                    "en_gloss": w["en_gloss"],
                    "ja_gloss": w["ja_gloss"],
                    "source": "subtitle",
                }
        else:
            if canon in pool:
                continue
            if canon in predic_long_forms:
                excluded_predic_dup.append((canon, rank))
                continue
            if is_proper_noun(canon, morph) and not in_trki:
                excluded_proper.append((canon, rank))
                continue
            pool[canon] = {
                "lemma": canon,
                "effective": effective,
                "subtitle_rank": rank,
                "subtitle_count": count,
                "in_trki": in_trki,
                "old_band": None,
                "old_rank": None,
                "pos": "",
                "en_gloss": None,
                "ja_gloss": None,
                "source": "subtitle",
            }

    # TRKI tokens with no subtitle-list signal at all (norm key absent from
    # the FULL subtitle table, not just the scanned window) -> synthetic
    # near-band3 rank tier so they aren't lost outright.
    trki_only = []
    for tok in trki_tokens:
        nk = norm(tok)
        if nk in subtitle:
            continue  # has real signal, already handled above
        exact_lemma = tok if tok in current else tok
        if exact_lemma in pool:
            continue
        is_current = tok in current
        trki_only.append(tok)
        w = current.get(tok)
        pool[exact_lemma] = {
            "lemma": tok,
            "effective": TRKI_ONLY_BASE_RANK + len(trki_only),
            "subtitle_rank": None,
            "subtitle_count": None,
            "in_trki": True,
            "old_band": w["old_band"] if is_current else None,
            "old_rank": w["old_rank"] if is_current else None,
            "pos": w["pos"] if is_current else "",
            "en_gloss": w["en_gloss"] if is_current else None,
            "ja_gloss": w["ja_gloss"] if is_current else None,
            "source": "trki_only",
        }

    # Current band words not yet placed -> (a) deep-lookup the FULL subtitle
    # LEMMA table (no SUBTITLE_SCAN_LIMIT cap) by norm key, then (b) fall back
    # to the word's own RAW surface frequency (pedagogical case-forms like
    # его/их/себя/должен/может/чем/во — see module docstring) before giving up.
    raw_fallback_used = []
    stale_no_signal = []
    for exact_lemma, w in current.items():
        if exact_lemma in pool:
            continue
        in_trki = norm(exact_lemma) in trki_norm
        full_hit = subtitle.get(norm(exact_lemma))
        if full_hit:
            rank, count, canon = full_hit
            effective = rank * BOOST_FACTOR if in_trki else float(rank)
            pool[exact_lemma] = {
                "lemma": w["lemma"],
                "effective": effective,
                "subtitle_rank": rank,
                "subtitle_count": count,
                "in_trki": in_trki,
                "old_band": w["old_band"],
                "old_rank": w["old_rank"],
                "pos": w["pos"],
                "en_gloss": w["en_gloss"],
                "ja_gloss": w["ja_gloss"],
                "source": "subtitle_deep",
            }
            continue
        raw_hit = raw_surface.get(exact_lemma.lower())
        if raw_hit:
            rank, count = raw_hit
            effective = rank * BOOST_FACTOR if in_trki else float(rank)
            raw_fallback_used.append(exact_lemma)
            pool[exact_lemma] = {
                "lemma": w["lemma"],
                "effective": effective,
                "subtitle_rank": rank,
                "subtitle_count": count,
                "in_trki": in_trki,
                "old_band": w["old_band"],
                "old_rank": w["old_rank"],
                "pos": w["pos"],
                "en_gloss": w["en_gloss"],
                "ja_gloss": w["ja_gloss"],
                "source": "raw_surface_fallback",
            }
            continue
        stale_no_signal.append(exact_lemma)
        pool[exact_lemma] = {
            "lemma": w["lemma"],
            "effective": 1_000_000 + (w["old_rank"] or 0),
            "subtitle_rank": None,
            "subtitle_count": None,
            "in_trki": False,
            "old_band": w["old_band"],
            "old_rank": w["old_rank"],
            "pos": w["pos"],
            "en_gloss": w["en_gloss"],
            "ja_gloss": w["ja_gloss"],
            "source": "no_signal",
        }

    # --- rank + assign bands ---------------------------------------------------
    ordered = sorted(pool.items(), key=lambda kv: (kv[1]["effective"], kv[0]))
    for new_rank, (key, w) in enumerate(ordered, 1):
        w["new_rank"] = new_rank
        w["new_band"] = 1 if new_rank <= 1000 else 2 if new_rank <= 2000 else 3 if new_rank <= TOP_N else 4
        w["is_new_inflow"] = w["old_band"] is None

    # --- write candidate_bands.tsv ---------------------------------------------
    out_path = os.path.join(HERE, "candidate_bands.tsv")
    cols = ["new_rank", "lemma", "new_band", "old_band", "old_rank",
            "subtitle_rank", "subtitle_count", "in_trki", "is_new_inflow",
            "source", "pos", "en_gloss", "ja_gloss"]
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\t".join(cols) + "\n")
        for key, w in ordered:
            row = [str(w[c]) if w[c] is not None else "" for c in cols]
            f.write("\t".join(row) + "\n")

    # --- report -----------------------------------------------------------------
    new_band1 = [w for _, w in ordered if w["new_band"] == 1]
    new_top3000_keys = {k for k, w in ordered if w["new_band"] in (1, 2, 3)}
    old_band1_keys = set(band1.keys())
    old_all_keys = set(current.keys())

    retained_band1 = old_band1_keys & {k for k, w in ordered if w["new_band"] == 1}
    band1_retention_pct = 100.0 * len(retained_band1) / len(old_band1_keys)

    dropped_from_3000 = sorted(
        (old_all_keys - new_top3000_keys),
        key=lambda k: current[k]["old_rank"] or 99999,
    )
    added_to_3000 = sorted(
        (new_top3000_keys - old_all_keys),
        key=lambda k: pool[k]["new_rank"],
    )
    dropped_from_band1_only = sorted(
        (old_band1_keys - {k for k, w in ordered if w["new_band"] == 1}),
        key=lambda k: current[k]["old_rank"] or 99999,
    )
    added_to_band1_only = sorted(
        ({k for k, w in ordered if w["new_band"] == 1} - old_band1_keys),
        key=lambda k: pool[k]["new_rank"],
    )

    top30 = [w["lemma"] for _, w in ordered[:30]]
    required = ["в", "и", "с", "у", "а", "о"]
    missing = [w for w in required if w not in top30]

    with open(os.path.join(HERE, "report.md"), "w", encoding="utf-8") as f:
        f.write("# LINGO-020 stage2 reconcile report\n\n")
        f.write(f"Candidate pool size: {len(pool)} lemmas "
                f"(top {TOP_N} kept as band1-3, rest -> band4 retirement pool)\n\n")
        f.write("## Top-30 verification (regression guard)\n\n")
        f.write("Top 30 new-band1 lemmas: " + " ".join(top30) + "\n\n")
        if missing:
            f.write(f"**FAILED**: missing function words {missing}\n\n")
        else:
            f.write("OK — в/и/с/у/а/о all present in top30 (same check as stage1).\n\n")

        f.write("## band1 retention\n\n")
        f.write(f"{len(retained_band1)} / {len(old_band1_keys)} old band1 lemmas "
                f"({band1_retention_pct:.1f}%) remain in new band1.\n\n")

        f.write(f"## Whole-3000 churn\n\n")
        f.write(f"Dropped from top-3000 entirely (-> band4): {len(dropped_from_3000)}\n")
        f.write(f"New inflow into top-3000: {len(added_to_3000)}\n\n")

        f.write("## band1-only churn (headline number for the task report)\n\n")
        f.write(f"Dropped out of band1: {len(dropped_from_band1_only)}\n")
        f.write(f"Newly entered band1: {len(added_to_band1_only)}\n\n")

        f.write("### Dropped from band1 (first 40, by old rank)\n\n")
        for k in dropped_from_band1_only[:40]:
            w = current[k]
            newb = pool[k]["new_band"]
            f.write(f"- {w['lemma']} (old rank {w['old_rank']}) -> new_band {newb} "
                    f"(new_rank {pool[k]['new_rank']}, source={pool[k]['source']})\n")

        f.write("\n### Newly entered band1 (first 40, by new rank)\n\n")
        for k in added_to_band1_only[:40]:
            w = pool[k]
            f.write(f"- {w['lemma']} (new rank {w['new_rank']}, "
                    f"subtitle_rank={w['subtitle_rank']}, in_trki={w['in_trki']})\n")

        f.write(f"\n## Excluded as predicative-short-form duplicates "
                f"(pymorphy's long-form lemma of an existing predic word — "
                f"see module docstring): {len(excluded_predic_dup)}\n\n")
        for canon, rank in sorted(excluded_predic_dup, key=lambda x: x[1]):
            f.write(f"- {canon} (subtitle rank {rank})\n")

        f.write(f"\n## Excluded as proper nouns from new inflow: {len(excluded_proper)}\n\n")
        for canon, rank in sorted(excluded_proper, key=lambda x: x[1])[:40]:
            f.write(f"- {canon} (subtitle rank {rank})\n")

        f.write(f"\n## Raw-surface fallback used (pedagogical case-form "
                f"lemmas recovered via their own surface frequency): "
                f"{len(raw_fallback_used)}\n\n")
        for k in sorted(raw_fallback_used, key=lambda k: current[k]["old_rank"] or 99999)[:60]:
            w = current[k]
            f.write(f"- {w['lemma']} (old band{w['old_band']} rank {w['old_rank']}) "
                    f"-> new_rank {pool[k]['new_rank']} (raw surface rank {pool[k]['subtitle_rank']})\n")

        f.write(f"\n## Current-band lemmas with zero subtitle signal "
                f"(no_signal tier, retired to band4 unless TRKI-boosted): "
                f"{len(stale_no_signal)}\n\n")
        for k in sorted(stale_no_signal, key=lambda k: current[k]["old_rank"] or 99999)[:60]:
            w = current[k]
            f.write(f"- {w['lemma']} (old band{w['old_band']} rank {w['old_rank']})\n")

    print(f"candidate_bands.tsv written: {len(pool)} rows")
    print(f"raw-surface fallback recovered: {len(raw_fallback_used)} lemmas")
    print(f"predic-duplicate long-forms excluded: {len(excluded_predic_dup)}")
    print(f"true no-signal (band4-bound): {len(stale_no_signal)} lemmas")
    print(f"band1 retention: {len(retained_band1)}/{len(old_band1_keys)} "
          f"({band1_retention_pct:.1f}%)")
    print(f"band1 churn: -{len(dropped_from_band1_only)} +{len(added_to_band1_only)}")
    print(f"whole-3000 churn: -{len(dropped_from_3000)} +{len(added_to_3000)}")
    print("top30:", " ".join(top30))
    if missing:
        print(f"!! VERIFICATION FAILED: missing {missing}", file=sys.stderr)
        sys.exit(2)
    print("VERIFICATION OK")


if __name__ == "__main__":
    main()
