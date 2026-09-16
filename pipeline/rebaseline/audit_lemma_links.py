#!/usr/bin/env python3
"""LINGO-049: audit every RU sentence source for content-word tokens
(verb/noun/adjective) that pymorphy3 can identify in the RU text but whose
lemma is absent from the sentence's own `lemmas` array — the exact bug class
Katsuta reported ("to spend time" / "to make money" cards showing no verb
breakdown at all, because проводить/зарабатывать were never linked).

Scope: ALL RU sentence sources (not just what currently ships to the app —
kind="word" cards ship unconditionally; non-core kind="sentence" rows are
currently build-time-filtered out unless target_lemma is set, but we audit
them too for data hygiene/future-proofing per the task's literal "全数列挙"
instruction):
  sentences_band{1,2,3,4}_core.jsonl, sentences_band1.jsonl (old handwritten),
  sentences_imported.jsonl, sentences_imported_lessons.jsonl.

Method: tokenize RU text (same TOKEN_RE as annotate_cases.py), and for each
token take pymorphy's parses filtered to POS in {VERB,INFN,NOUN,ADJF} with
the same proper-noun/abbreviation noise-grammeme exclusion LINGO-033 uses
(Init/Abbr/Patr/Name/Surn/Arch/Geox/Orgn/Trad) — otherwise a name-initial
homograph would falsely "prove" a word is linked. A token is UNLINKED if NONE
of its surviving parses' normal_form (ё-normalised) matches any lemma already
declared on the sentence. Reports one row per unlinked token, grouped by verb
vs noun/adj, plus whether the lemma already exists somewhere in
words_band{1,2,3,4}.jsonl (fixable by just adding to `lemmas`) or needs a new
Word entry entirely.
"""
import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from annotate_cases import MORPH, TOKEN_RE, norm, NOISE_GRAMMEMES  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

SOURCE_FILES = [
    "sentences_band1_core.jsonl",
    "sentences_band2_core.jsonl",
    "sentences_band3_core.jsonl",
    "sentences_band4_core.jsonl",
    "sentences_band1.jsonl",
    "sentences_imported.jsonl",
    "sentences_imported_lessons.jsonl",
]

CONTENT_POS = {"VERB", "INFN", "NOUN", "ADJF"}


def load_all_known_lemmas():
    known = {}
    for b in (1, 2, 3, 4):
        with open(os.path.join(DATA, f"words_band{b}.jsonl"), encoding="utf-8") as f:
            for line in f:
                w = json.loads(line)
                known[norm(w["lemma"])] = w
    return known


def pos_class_of(pos):
    if pos in ("VERB", "INFN"):
        return "verb"
    if pos == "NOUN":
        return "noun"
    # ADJS = short-form predicative adjective (рад/должен/нужен/готов/...),
    # this project's own pos="predic" category — mapped to "adj" here since
    # it's still a genuine content word needing breakdown coverage. Found via
    # "рада" (a real standalone noun, "council") outscoring its ADJS "рад"
    # (glad) reading in pymorphy's own ranking for "Она была так рада..." —
    # without this, a declared, already-registered "рад" was invisible to
    # classify_for_report's candidate search entirely (filtered out before
    # the "prefer a registered lemma" check ever saw it).
    if pos in ("ADJF", "ADJS"):
        return "adj"
    return None


# Genuine pymorphy dictionary gaps found by manual review of the audit output
# (checked directly with MORPH.parse(): these tokens have NO alternate parse
# at all producing the project's own registered headword, unlike это/все
# which do have a matching alternate reading — see classify_token's
# docstring). "деньги" is a pluralia tantum noun this project registers as
# its own headword (LINGO-022), but pymorphy's ONLY dictionary entry for its
# oblique forms (денег/деньгами/...) normalises to the archaic singular
# "деньга". Mapping is pymorphy_normal_form -> this project's headword.
CANONICAL_LEMMA_ALIASES = {
    "деньга": "деньги",
    # "счастья"/"счастье" normalise to the archaic spelling "счастие" in
    # pymorphy's dictionary; the project registers the modern "счастье".
    "счастие": "счастье",
    # "должен"/"должны"/"должна"/"должно" (short-form predicative "must")
    # ALWAYS normalise to the archaic long-form "должный" in pymorphy — even
    # for the base masculine "должен" itself (confirmed via direct parse
    # inspection: no alternate reading exists). Project registers "должен".
    "должный": "должен",
    # "каков"/"какова"/"каково"/"каковы" (predicative "what ... is like") have
    # NO alternate pymorphy reading at all — every form normalises to the
    # archaic long-form "каковой" (confirmed via direct parse inspection,
    # score 1.0, no competing parse). Project already registers the modern
    # short predicative "каков" (words_band4.jsonl, pos="pron") from an
    # earlier task; without this alias, the audit would wrongly propose
    # creating a brand-new (duplicate, archaic-spelled) "каковой" entry.
    "каковой": "каков",
}


def effective_lemma(p):
    """The lemma to use for THIS parse, applying both the static
    CANONICAL_LEMMA_ALIASES and the one grammeme-dependent case: "человек"
    (person, singular) and "люди" (people — this project registers it as its
    own headword, LINGO-022) are both real, separately-registered Word rows,
    but pymorphy always normalises oblique PLURAL forms of человек (людей/
    людям/людьми/...) to the suppletive singular "человек" — a blind string
    alias would incorrectly redirect genuine singular "человек" uses too, so
    this checks the parse's own number grammeme instead."""
    lemma = norm(p.normal_form)
    if lemma == "человек" and p.tag.number == "plur":
        return "люди"
    return CANONICAL_LEMMA_ALIASES.get(lemma, lemma)


def classify_token(tok):
    """Decide (a) whether this token is even in scope (its single best-guess
    reading is a verb/noun/adjective — a word whose TOP parse is e.g. PRCL,
    ADVB or NPRO is out of scope regardless of some rarer alternate ADJF/NOUN
    homograph reading buried in its parse list — e.g. "уже" is overwhelmingly
    the adverb "already", not the rare noun "уж" (grass snake)), and (b)
    whether it is LINKED — searching ALL of the token's parses (any POS, not
    just the target set) for one whose lemma matches a declared sentence
    lemma, since the correct reading for THIS sentence may not be the
    top-scored one at all (mirrors LINGO-033's effective_verb_lemma finding
    for "есть": top parse is INFN "to eat" at ~0.89, but "У меня есть кофе"
    genuinely declares быть — searching only the top parse would wrongly
    flag it as unlinked). Also mirrors this project's own lemma conventions
    that diverge from pymorphy's default lemmatisation (это/все are their
    own headwords here, not folded into этот/весь — a broad any-POS,
    any-parse search finds the PRCL "всё" reading of "Все", which
    ё-normalises to "все" and matches, without needing to special-case it).
    Returns (pos_class, top_lemma) if in scope, else (None, None).
    """
    parses = [p for p in MORPH.parse(tok) if not (p.tag.grammemes & NOISE_GRAMMEMES)]
    if not parses:
        return None, None
    top = parses[0]
    pos_class = pos_class_of(top.tag.POS)
    if pos_class is None:
        return None, None
    return pos_class, effective_lemma(top)


def classify_for_report(tok, known_lemmas):
    """Like classify_token, but for an already-confirmed-unlinked token:
    prefer a REGISTERED lemma among ALL of the token's target-POS parses
    (not just the top-scored one) when one exists, before falling back to
    the raw top parse. This matters when pymorphy's top-scored reading is a
    rare/marginal one (e.g. "старое" top-parses as a substantivised NOUN at
    ~0.44 score, ahead of the genuinely-intended ADJF "старый" reading at a
    combined ~0.44 across its nom/accs forms) — reporting the marginal
    reading would misclassify a real, already-in-the-Word-table "старый"
    gap as if it needed a brand-new "старое" entry. Only used for reporting
    (which lemma to show/add-to-lemmas); classify_token's top-parse choice
    still gates whether a token is in scope at all."""
    candidates = []  # (pos_class, lemma) in pymorphy score order
    for p in MORPH.parse(tok):
        if p.tag.grammemes & NOISE_GRAMMEMES:
            continue
        pos_class = pos_class_of(p.tag.POS)
        if pos_class is None:
            continue
        candidates.append((pos_class, effective_lemma(p)))
    for pos_class, lemma in candidates:
        if lemma in known_lemmas:
            return pos_class, lemma
    return candidates[0] if candidates else (None, None)


def is_linked(tok, declared):
    # Frozen particles/interjections this project registers as their OWN
    # headword (давай/давайте/пожалуйста/...) that pymorphy's dictionary has
    # NO alternate reading for at all — its only parse of "Давай" is the
    # imperative of "давать" (score 1.0, no competing reading — confirmed via
    # direct pymorphy inspection). A literal surface-vs-declared-lemma match
    # (case/ё-insensitive) catches these without needing an exhaustive
    # allowlist: if the sentence declares a lemma spelled exactly like the
    # surface token, it is definitionally that word, regardless of what
    # pymorphy's grammatical analysis of it would otherwise suggest.
    if norm(tok) in declared:
        return True
    for p in MORPH.parse(tok):
        if p.tag.grammemes & NOISE_GRAMMEMES:
            continue
        if norm(p.normal_form) in declared:
            return True
        eff = effective_lemma(p)
        if eff in declared:
            return True
        # "весь" (determiner, "whole/all", rank49) and "всё"/"все" (this
        # project's own separate pronoun headwords, "everything"/"everyone")
        # are DIFFERENT registered Word rows with different glosses, but
        # morphologically identical outside the nominative/accusative
        # neuter-singular form — Russian has no distinct declension for the
        # pronominal "всё" sense; oblique forms (всего/всём/всему/...) are
        # pymorphy-lemmatised to "весь" regardless of which sense is meant
        # (confirmed via direct parse inspection: "всём"/"всего" have NO
        # alternate PRCL "всё" reading at all, unlike nominative "всё"
        # itself). Found via a real over-linking bug: relinking "всём"/
        # "всего" in sentences that already correctly declare "всё" (e.g.
        # "Расскажи мне обо всём" = "Tell me about everything") added a
        # spurious SECOND, semantically-wrong "весь" (determiner) lemma
        # alongside it. Only treat "весь" as satisfied when "всё"/"все" is
        # ALREADY declared — never the reverse, so genuine determiner usage
        # ("весь день", "по всей стране") with neither pronoun declared is
        # still correctly flagged as needing its own "весь" link.
        if eff == "весь" and ("всё" in declared or "все" in declared):
            return True
    return False


def audit_sentence(s, known_lemmas):
    """Return list of {pos_class, lemma, surface, in_word_table} for unlinked tokens."""
    toks = TOKEN_RE.findall(s.get("ru", ""))
    declared = {norm(l) for l in s.get("lemmas", [])}
    issues = []
    seen_this_sentence = set()  # avoid reporting the same missing lemma twice per sentence
    for tok in toks:
        pos_class, _ = classify_token(tok)
        if pos_class is None:
            continue
        if is_linked(tok, declared):
            continue
        pos_class, lemma = classify_for_report(tok, known_lemmas)
        key = (pos_class, lemma)
        if key in seen_this_sentence:
            continue
        seen_this_sentence.add(key)
        in_word_table = lemma in known_lemmas
        # IMPORTANT: `lemma` here is a norm()-folded key (ё->е, lowercase),
        # used purely for lookup/matching. When it IS in the Word table, the
        # canonical spelling stored there may still have ё (e.g. Word row
        # "лёгкий" vs folded key "легкий") — build-content.mjs's lemmaToId
        # lookup is an EXACT string match with no ё-folding, so writing the
        # folded key into a sentence's `lemmas` array would silently break
        # the link again (found via a real bug: apply_relink.py had written
        # "легкий"/"теплый"/"учеба" instead of the registered "лёгкий"/
        # "тёплый"/"учёба", surfaced by import.py's own unmatched-lemma
        # warning). Report the REAL canonical spelling when known.
        report_lemma = known_lemmas[lemma]["lemma"] if in_word_table else lemma
        issues.append({
            "pos_class": pos_class,
            "lemma": report_lemma,
            "surface": tok,
            "in_word_table": in_word_table,
        })
    return issues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pos", choices=["verb", "noun", "adj"], help="filter report to one pos class")
    ap.add_argument(
        "--json",
        metavar="PATH",
        help=(
            "write the full issue list as a JSON array to PATH instead of (in "
            "addition to) the human-readable report — used to regenerate the "
            "LINGO-049 Vitest fixture, web/src/content/verb_lemma_link_exceptions.json"
        ),
    )
    args = ap.parse_args()

    known_lemmas = load_all_known_lemmas()

    total_sentences = 0
    all_issues = []  # (path, sentence_id, ru, issue)
    for fname in SOURCE_FILES:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                s = json.loads(line)
                total_sentences += 1
                for issue in audit_sentence(s, known_lemmas):
                    all_issues.append((fname, s["id"], s.get("ru", ""), s.get("kind"), issue))

    if args.pos:
        all_issues = [row for row in all_issues if row[4]["pos_class"] == args.pos]

    by_pos = {"verb": [], "noun": [], "adj": []}
    for row in all_issues:
        by_pos[row[4]["pos_class"]].append(row)

    if args.json:
        json_rows = [
            {
                "file": fname,
                "sentence_id": sid,
                "ru": ru,
                "kind": kind,
                "pos_class": issue["pos_class"],
                "lemma": issue["lemma"],
                "surface": issue["surface"],
                "in_word_table": issue["in_word_table"],
            }
            for fname, sid, ru, kind, issue in all_issues
        ]
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(json_rows, f, ensure_ascii=False, indent=2)
            f.write("\n")

    print(f"total sentences scanned: {total_sentences}")
    print(f"total unlinked content-word issues: {len(all_issues)}")
    for pc in ("verb", "noun", "adj"):
        rows = by_pos[pc]
        not_in_table = [r for r in rows if not r[4]["in_word_table"]]
        print(f"  {pc}: {len(rows)} issues ({len(not_in_table)} lemma not in Word table at all)")

    print()
    for fname, sid, ru, kind, issue in all_issues:
        flag = "" if issue["in_word_table"] else "  [NOT IN WORD TABLE]"
        print(f"{fname}:{sid} ({kind}) [{issue['pos_class']}] {issue['surface']} -> {issue['lemma']}{flag}   | {ru}")


if __name__ == "__main__":
    main()
