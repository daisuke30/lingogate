#!/usr/bin/env python3
"""LINGO-020 工程1 — lemma aggregation of the OpenSubtitles surface-form list.

Input : ru_50k.txt  (hermitdave/FrequencyWords, OpenSubtitles 2018, MIT;
        each line = "<surface_form> <count>", already frequency-descending)
Output: subtitle_lemma_freq.tsv  ("rank<TAB>lemma<TAB>count" per lemma)

Why this exists
---------------
The subtitle list is *surface forms* (activated/inflected). The band vocab is
*lemmas* (dictionary forms). To re-rank the vocab against spoken frequency we
collapse the surface forms to lemmas with pymorphy3 and sum their counts. This
is deliberately "good enough for a top-3000 judgement", not perfect (see the
limits section in README.md): pymorphy3 picks the single most-probable parse per
surface form; genuine homographs that lemmatise differently by context are not
resolved.

The known failure the previous agent hit — the top function words (в / и / с /
у / а / о …) dropping out — was a filtering bug (single Cyrillic letters being
discarded as "noise"). We keep the real one-letter words explicitly; see
KEEP_SINGLE below and the top-30 assertion at the end.
"""
import re
import sys
import pymorphy3

CYRILLIC = re.compile(r"^[а-яёА-ЯЁ-]+$")
# Real one-letter Russian words (prepositions / conjunctions / pronouns). Every
# other single-letter token is OCR/tokeniser noise and is dropped.
KEEP_SINGLE = set("явсуаоикбжз")

morph = pymorphy3.MorphAnalyzer()

# pymorphy tags we treat as non-lexical noise even when the surface is Cyrillic.
DROP_POS = set()  # keep everything pymorphy accepts; register handled downstream


def is_word(tok):
    if not CYRILLIC.match(tok):
        return False
    if len(tok) == 1 and tok not in KEEP_SINGLE:
        return False
    return True


def main(inp="ru_50k.txt", out="subtitle_lemma_freq.tsv"):
    agg = {}          # lemma -> summed count
    surfaces = {}     # lemma -> up to 5 example surface forms (for the log)
    kept = dropped = 0
    with open(inp, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) != 2:
                continue
            surface, cnt = parts[0].lower(), parts[1]
            try:
                cnt = int(cnt)
            except ValueError:
                continue
            if not is_word(surface):
                dropped += 1
                continue
            kept += 1
            p = morph.parse(surface)[0]
            lemma = p.normal_form
            # pymorphy sometimes normalises ё away; keep the lemma as returned
            # but the downstream reconcile step ё→е-normalises when matching.
            agg[lemma] = agg.get(lemma, 0) + cnt
            ex = surfaces.setdefault(lemma, [])
            if len(ex) < 5 and surface not in ex:
                ex.append(surface)

    ranked = sorted(agg.items(), key=lambda kv: (-kv[1], kv[0]))
    with open(out, "w", encoding="utf-8") as w:
        for i, (lemma, cnt) in enumerate(ranked, 1):
            w.write(f"{i}\t{lemma}\t{cnt}\n")

    top30 = [lemma for lemma, _ in ranked[:30]]
    print(f"surface forms: kept={kept} dropped={dropped}")
    print(f"distinct lemmas: {len(ranked)}")
    print("TOP 30 lemmas:", " ".join(top30))
    required = ["в", "и", "с", "у", "а", "о"]
    missing = [w for w in required if w not in top30]
    if missing:
        print(f"!! VERIFICATION FAILED: function words missing from top30: {missing}",
              file=sys.stderr)
        sys.exit(2)
    print("VERIFICATION OK: в/и/с/у/а/о all present in top30")


if __name__ == "__main__":
    main(*sys.argv[1:])
