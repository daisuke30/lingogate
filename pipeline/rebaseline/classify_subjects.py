#!/usr/bin/env python3
"""LINGO-051: classify the grammatical SUBJECT TYPE of every RU core sentence
(target_lemma-bearing T#### / B#### rows in sentences_band{1,2,3,4}_core.jsonl)
against Katsuta's approved 8-bucket distribution (derived from a dating/
ordering/small-talk conversation simulation, see LINGO-052):

  я / ты / вы / он / она / мы / они / no_subject / mne_type

Classification priority (highest first — a sentence gets exactly one label):

1. mne_type — dative-experiencer constructions (Мне нравится / нужно / холодно
   / скучно / ...) OR "у X есть/нет" possession constructions. These have NO
   nominative grammatical subject at all (the dative/genitive noun phrase is
   not the subject in Russian grammar), so they must be checked before any
   pronoun-based rule — otherwise "Мне холодно" would wrongly fall through to
   "no_subject" or be missed entirely (мне is dative, not nominative "я").
2. no_subject — imperative-mood verbs (командный тон has no distinct subject
   pronoun in Russian, регardless of addressee), hortative "давай(те)",
   standalone modal predicatives (можно/нельзя/надо/нужно with NO dative
   experiencer attached — that's rule 1's job when a dative IS present), and
   verb-less interjection/backchannel fragments (Конечно. Хорошо. Спасибо.).
3. Explicit nominative personal pronoun token (я/ты/вы/он/она/мы/они/оно) —
   these pronouns are undeclinable-by-spelling in the nominative (oblique
   cases use entirely different word forms: меня/тебя/его/её/нас/их/...), so
   a literal token match is safe and doesn't need a pymorphy case check.
4. Verb-person-agreement fallback for a DROPPED subject pronoun (very common
   in natural spoken Russian: "Хочу кофе" = "(Я) хочу кофе") — classified by
   the finite verb's person/number (+ gender for past tense) grammemes.
5. Everything else (copula-less nominal sentences like "Это трудный курс",
   "Русский — трудный язык", impersonal weather/fact statements with no verb
   and no pronoun) -> "other". This is deliberately NOT one of the 8 target
   buckets: Katsuta's distribution has no slot for generic textbook nominal
   sentences, and this bucket is exactly the "教科書臭 / 実用性の低い文" pool
   this task is meant to rewrite away from — see the task's own
   rewrite-priority instruction.

Usage:
  python3 classify_subjects.py                 # full distribution report
  python3 classify_subjects.py --json out.json # + per-sentence JSON dump
  python3 classify_subjects.py --show other     # list all "other" sentences
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from annotate_cases import MORPH, TOKEN_RE, norm, NOISE_GRAMMEMES  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

CORE_FILES = [
    "sentences_band1_core.jsonl",
    "sentences_band2_core.jsonl",
    "sentences_band3_core.jsonl",
    "sentences_band4_core.jsonl",
]

BUCKETS = ["я", "ты", "вы", "он", "она", "мы", "они", "no_subject", "mne_type", "other"]

# Nominative-only personal pronoun spellings (oblique cases use different word
# forms entirely, so a literal surface match is unambiguous).
NOM_PRONOUN_BUCKET = {
    "я": "я",
    "ты": "ты",
    "вы": "вы",
    "он": "он",
    "она": "она",
    "оно": "он",  # neuter folded into он/она combined bucket per task's own grouping; tracked separately below
    "мы": "мы",
    "они": "они",
}

DATIVE_PRONOUNS = {"мне", "тебе", "вам", "ему", "ей", "нам", "им"}
GENITIVE_PRONOUNS_FOR_U = {"меня", "тебя", "вас", "него", "нее", "неё", "нас", "вас", "них"}

# Predicative/impersonal words that combine with a dative experiencer (rule 1)
# or stand alone as a subjectless modal (rule 2). Non-exhaustive but covers
# the standard A1-B1 set; anything missed falls through to "other" and shows
# up for manual review rather than being silently misclassified.
EXPERIENCER_PREDICATIVES = {
    "нравиться", "нужно", "нужен", "нужна", "нужны", "надо", "холодно",
    "жарко", "скучно", "весело", "интересно", "лень", "пора", "стыдно",
    "обидно", "приятно", "удобно", "неудобно", "понятно", "непонятно",
    "плохо", "хорошо", "видно", "слышно", "везёт", "везет", "повезло",
    "страшно", "грустно", "радостно", "легко", "трудно", "сложно",
    "интересоваться", "казаться", "хотеться",
}
STANDALONE_MODALS = {"можно", "нельзя", "надо", "нужно", "пора"}

IMPERATIVE_GRAMMEMES = {"impr"}

# Genuine backchannel/interjection/discourse-marker words — a CURATED list,
# not a length heuristic. Found via review: a crude "<=3 tokens with no verb"
# rule was misclassifying real elided-copula nominal sentences ("Поезд уже
# здесь." = "The train is already here.", subject "поезд") as backchannel
# fragments. Only sentences consisting SOLELY of these markers (+ punctuation
# already stripped by TOKEN_RE) are genuine subject-less utterances.
BACKCHANNEL_WORDS = {
    "конечно", "хорошо", "ладно", "спасибо", "пожалуйста", "извини",
    "извините", "отлично", "договорились", "понятно", "ясно", "возможно",
    "естественно", "разумеется", "ничего", "неважно", "именно", "точно",
    "правда", "серьёзно", "серьезно", "действительно", "прекрасно",
    "замечательно", "супер", "класс", "ого", "ух", "ой", "эй", "алло",
    "привет", "пока", "здравствуйте", "добро", "пожаловать", "поздравляю",
    "увы", "жаль", "странно", "интересно", "кстати", "вообще",
}


def load_core_rows():
    rows = []
    for fname in CORE_FILES:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                s = json.loads(line)
                s["_file"] = fname
                rows.append(s)
    return rows


def parse_tokens(ru):
    toks = TOKEN_RE.findall(ru)
    out = []
    for t in toks:
        parses = [p for p in MORPH.parse(t) if not (p.tag.grammemes & NOISE_GRAMMEMES)]
        out.append((t, parses))
    return out


def has_imperative(parsed, toks_lower=None):
    has_explicit_nom_pronoun = bool(toks_lower) and any(t in NOM_PRONOUN_BUCKET for t in toks_lower)
    for tok, parses in parsed:
        if not parses:
            continue
        top = parses[0]
        if top.tag.POS != "VERB" or "impr" not in top.tag.grammemes:
            continue
        # pymorphy dictionary quirk (found via "нашли"/"пришли" — a genuine
        # 0.5/0.5 tie): some -ли past-tense-plural verb forms collide with an
        # archaic/rare "excl" (exclamatory) singular imperative reading, and
        # pymorphy's internal tie-break happens to rank it first. Both
        # readings are genuinely live in this corpus: "Вы нашли документ?"
        # (indicative, WITH an explicit "Вы" subject) vs. "Пришли мне фото."
        # (a real imperative — "Send me a photo" — with NO subject pronoun at
        # all). The disambiguator is exactly that: an explicit nominative
        # pronoun elsewhere in the sentence is strong evidence for the
        # indicative reading (a genuine imperative essentially never
        # co-occurs with one here); its absence, especially alongside a
        # dative recipient ("мне"/"тебе"/...), is strong evidence FOR the
        # imperative. Only distrust the "excl"+"impr" top parse when a rival
        # "indc"+"past" parse exists AND a nominative pronoun is present.
        if "excl" in top.tag.grammemes and has_explicit_nom_pronoun:
            has_past_indc_alt = any(
                p.tag.POS == "VERB" and "indc" in p.tag.grammemes and "past" in p.tag.grammemes
                for p in parses
            )
            if has_past_indc_alt:
                continue
        return True
    return False


def has_davai(ru_lower_tokens):
    return ru_lower_tokens and ru_lower_tokens[0] in ("давай", "давайте")


def has_dative_experiencer(ru_lower_tokens, parsed):
    dative_present = any(t in DATIVE_PRONOUNS for t in ru_lower_tokens)
    if not dative_present:
        return False
    for tok, parses in parsed:
        n = norm(tok)
        if n in EXPERIENCER_PREDICATIVES:
            return True
        for p in parses:
            if norm(p.normal_form) in EXPERIENCER_PREDICATIVES:
                return True
    # "мне/тебе/... + verb" with no clear predicative word still generally
    # reads as a dative-experiencer/indirect-object construction distinct
    # from a nominative-subject one (e.g. "Скажи мне правду" has ты as the
    # real imperative subject, correctly caught by the imperative rule
    # BEFORE this one runs). If we get here (no imperative, dative present,
    # no known predicative), don't guess -> fall through to other rules.
    return False


def has_u_menya_sentence_initial(ru_lower_tokens):
    # Sentence-INITIAL "У меня/тебя/вас/нас ..." — the idiomatic Russian
    # possession/experiencer fronting ("У меня свидание." = "I have a date.",
    # "У меня болит спина." = "My back hurts.") very often elides "есть"
    # entirely in natural speech, so requiring a literal есть/нет token (the
    # original has_u_menya_est check) missed most real examples. Restricted
    # to SENTENCE-INITIAL "у" + a 1st/2nd-person genitive pronoun specifically
    # (не него/неё/них — those skew locative, "у него" = "at his place", and
    # would misfire against an explicit 3rd-person subject elsewhere in the
    # sentence, e.g. "Он живёт у меня." — checked before this rule can ever
    # run since mne_type is priority 1, so that guard matters).
    if len(ru_lower_tokens) < 2:
        return False
    return ru_lower_tokens[0] == "у" and ru_lower_tokens[1] in ("меня", "тебя", "вас", "нас")


def has_u_menya_est(ru_lower_tokens):
    # "У меня есть/нет ..." — genitive-of-possession construction, anywhere
    # in the sentence (not just sentence-initial) when the explicit есть/нет
    # marker removes the "он живёт у меня" locative ambiguity above.
    if "у" not in ru_lower_tokens:
        return False
    has_gen_pronoun = any(t in GENITIVE_PRONOUNS_FOR_U for t in ru_lower_tokens)
    has_est_net = ("есть" in ru_lower_tokens) or ("нет" in ru_lower_tokens)
    return has_gen_pronoun and has_est_net


def has_finite_verb(parsed):
    for tok, parses in parsed:
        if not parses:
            continue
        top = parses[0]
        if top.tag.POS in ("VERB",) and "impr" not in top.tag.grammemes:
            return top
    return None


def find_subject_noun_gender(parsed):
    """Best-effort subject-noun detector for 3rd-person sentences where the
    verb itself doesn't morphologically mark gender (present/future tense —
    only past tense does) or there's no verb at all (Russian zero-copula
    present: "Ситуация очень плохая." = "[the] situation is very bad").
    Returns 'masc'/'femn'/None from the FIRST nominative-case singular
    ANIMATE NOUN token's top parse (Russian's default word order puts the
    subject first in these short pedagogical sentences; a deliberately
    narrow heuristic — never guesses when the case/number isn't unambiguous
    nominative singular, consistent with this project's "never guess on
    homographs" precedent). Restricted to animate nouns: this bucket means
    "он/она" as in HE/SHE (a person), not grammatical masculine/feminine
    gender on an inanimate object — found via a real bug where "Поезд уже
    здесь." (the train is here), "Мой город на западе." (my city is in the
    west) and similar inanimate-subject sentences were wrongly bucketed as
    он purely because поезд/город happen to be grammatically masculine."""
    for tok, parses in parsed:
        if not parses:
            continue
        top = parses[0]
        if top.tag.POS != "NOUN":
            continue
        if top.tag.case != "nomn" or top.tag.number != "sing":
            continue
        if "anim" not in top.tag.grammemes:
            continue
        if top.tag.gender == "masc":
            return "masc"
        if top.tag.gender == "femn":
            return "femn"
        return None  # neuter or indeterminate — don't guess он/она
    return None


def classify(s):
    ru = s.get("ru", "")
    toks_raw = TOKEN_RE.findall(ru)
    toks_lower = [norm(t) for t in toks_raw]
    parsed = parse_tokens(ru)

    # 1. mne_type
    if has_dative_experiencer(toks_lower, parsed):
        return "mne_type", "dative-experiencer predicative"
    if has_u_menya_est(toks_lower):
        return "mne_type", "у X есть/нет possession"
    if has_u_menya_sentence_initial(toks_lower):
        return "mne_type", "sentence-initial У меня/тебя/вас/нас (elided-есть possession/experiencer)"

    # 2. no_subject
    if has_davai(toks_lower):
        return "no_subject", "давай/давайте hortative"
    if has_imperative(parsed, toks_lower):
        return "no_subject", "imperative mood verb"
    if any(t in STANDALONE_MODALS for t in toks_lower):
        return "no_subject", "standalone modal predicative (no dative experiencer)"
    if toks_lower and all(t in BACKCHANNEL_WORDS for t in toks_lower):
        return "no_subject", "backchannel/interjection (curated word list)"

    # 3. explicit nominative pronoun
    for t in toks_lower:
        if t in NOM_PRONOUN_BUCKET:
            bucket = NOM_PRONOUN_BUCKET[t]
            return bucket, f"explicit nominative pronoun '{t}'"

    # 4. verb-person-agreement fallback (dropped pronoun)
    top_verb = has_finite_verb(parsed)
    if top_verb is not None:
        g = top_verb.tag
        if g.person == "1per" and g.number == "sing":
            return "я", "1sg verb agreement, dropped pronoun"
        if g.person == "2per" and g.number == "sing":
            return "ты", "2sg verb agreement, dropped pronoun"
        if g.person == "1per" and g.number == "plur":
            return "мы", "1pl verb agreement, dropped pronoun"
        if g.person == "3per" and g.number == "plur":
            return "они", "3pl verb agreement, dropped pronoun (unnamed subject)"
        # Guard: "Это был X." / "Это была X." — был/была AGREES WITH THE
        # PREDICATE NOUN's gender (a genuine Russian copula quirk), not with
        # "это" itself; the real subject is the impersonal "это" ("it"), so
        # attributing this to он/она via the verb's gender would be wrong.
        # Found via "Это была ловушка для нас." wrongly bucketed as "она".
        is_eto_construction = toks_lower and toks_lower[0] in ("это", "то")
        if g.number == "sing" and g.tense == "past" and not is_eto_construction:
            if g.gender == "masc":
                return "он", "past-tense masc agreement, dropped/named subject"
            if g.gender == "femn":
                return "она", "past-tense femn agreement, dropped/named subject"
        if g.person == "3per" and g.number == "sing" and not is_eto_construction:
            # Present/future 3sg doesn't mark gender morphologically on the
            # verb itself ("ждёт" works for он/она/it alike) — fall back to
            # the sentence's own nominative subject noun.
            gender = find_subject_noun_gender(parsed)
            if gender == "masc":
                return "он", "3sg pres/futr verb + nominative masc subject noun"
            if gender == "femn":
                return "она", "3sg pres/futr verb + nominative femn subject noun"

    # Zero-copula nominal sentence (no verb at all): "Ситуация очень плохая."
    # Guard: "Это/То N" (Это трудный курс.) puts это/то itself as the real
    # subject and N as the PREDICATE noun, not the subject — grabbing N's
    # gender would misattribute these textbook copula sentences to он/она.
    # Leave them in "other" (correctly — they're exactly the low-practicality
    # pool this task wants rewritten, not a real он/она statement).
    if not (toks_lower and toks_lower[0] in ("это", "то")):
        gender = find_subject_noun_gender(parsed)
        if gender == "masc":
            return "он", "zero-copula nominal sentence + nominative masc subject noun"
        if gender == "femn":
            return "она", "zero-copula nominal sentence + nominative femn subject noun"

    return "other", "no pronoun, no clear verb-person marker (copula-less nominal, etc.)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", metavar="PATH", help="write full per-sentence classification to PATH")
    ap.add_argument("--show", metavar="BUCKET", help="list all sentences in one bucket")
    args = ap.parse_args()

    rows = load_core_rows()
    results = []
    counts = {b: 0 for b in BUCKETS}
    for s in rows:
        bucket, reason = classify(s)
        counts[bucket] += 1
        results.append({
            "id": s["id"], "file": s["_file"], "ru": s["ru"],
            "target_lemma": s.get("target_lemma"), "bucket": bucket, "reason": reason,
        })

    total = len(rows)
    print(f"total core sentences: {total}\n")
    print(f"{'bucket':<12} {'count':>6} {'pct':>7}   target")
    targets = {
        "я": 30, "ты": 18, "вы": 10, "он": 5, "она": 5, "мы": 8, "они": 4,
        "no_subject": 12, "mne_type": 8, "other": 0,
    }
    for b in BUCKETS:
        pct = 100.0 * counts[b] / total if total else 0
        tgt = targets.get(b, 0)
        flag = "" if b == "other" else (" <-- OK" if abs(pct - tgt) <= 3 else " <-- OFF")
        print(f"{b:<12} {counts[b]:>6} {pct:>6.1f}%   {tgt:>3}%{flag}")

    combined_on_ona = counts["он"] + counts["она"]
    print(f"\n(он+она combined: {combined_on_ona} = {100.0*combined_on_ona/total:.1f}% vs target 10%)")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\nwrote per-sentence classification to {args.json}")

    if args.show:
        print(f"\n=== bucket: {args.show} ===")
        for r in results:
            if r["bucket"] == args.show:
                print(f"{r['id']} ({r['file']}) [{r['reason']}] {r['ru']}")


if __name__ == "__main__":
    main()
