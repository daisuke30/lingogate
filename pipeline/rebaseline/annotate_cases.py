#!/usr/bin/env python3
"""LINGO-033: annotate each core-sentence's noun/adjective/pronoun tokens with
their grammatical case (1-6, RU pedagogical numbering) + number, for the
card-back "文中の形: книгу（4格・対格）" display.

Scope (Katsuta 2026-09-07, literal): noun / adjective / pronoun only (matches
this repo's own Word.pos values "noun"/"adj"/"pron" — NOT "det", which is a
distinct pos in this schema even though determiners like твой/этот also
decline; see task log for why this is a deliberate, reported exclusion).
Verbs are out of scope entirely.

Design (quality gate is the whole point): pymorphy3's own per-token parse set
already resolves MOST tokens unambiguously once narrowed to (a) POS in
{NOUN,ADJF,NPRO} and (b) normal_form matching one of the sentence's declared
`lemmas` (so we're not wasting effort on words the deck doesn't even link).
Genuine ambiguity (declension syncretism: gen.sg==nom/acc.pl for feminine -а
nouns, dat==loc for many fem -а/-ь nouns, nom==acc for inanimate masc/neut,
etc.) is resolved by, in priority order:

  1. Preposition governance — a case-governing preposition immediately
     before the token deterministically narrows (or fully resolves) the
     candidate set. See PREP_CASES.
  2. Numeral governance — 2/3/4/половина/пара etc. force genitive singular;
     5+ force genitive plural (see NUM_GENITIVE / NUM_PLURAL_GENITIVE).
  3. Adjective/pronoun-modifier agreement — an ambiguous ADJF/NPRO token
     adjacent to an already-resolved noun of matching gender+number inherits
     that noun's case (adjectives/most determiner-like pronouns in this
     corpus's simple sentences sit immediately next to their noun).
  4. Subject/object position (nom vs acc only, for inanimate masc/neut nouns
     where nom==acc are literally the same form) — token before the finite
     verb with no governing preposition/numeral => nominative; token after a
     transitive verb => accusative. Weakest heuristic, used last.

Anything still ambiguous after all four is DROPPED (no case emitted) — never
guessed. Reports the ambiguity/hide rate; run --sample N to print a random
sample for manual precision auditing.
"""
import argparse
import glob
import json
import os
import random
import re
from collections import Counter

import pymorphy3

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
MORPH = pymorphy3.MorphAnalyzer()

TOKEN_RE = re.compile(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*")

CASE_MAP = {
    "nomn": 1, "gent": 2, "gen2": 2, "datv": 3,
    "accs": 4, "ablt": 5, "loct": 6, "loc2": 6,
}
CASE_LOCAL = {1: "им", 2: "род", 3: "дат", 4: "вин", 5: "тв", 6: "пред"}

# Prepositions that deterministically govern one case (or a small closed set
# we can disambiguate further via intersection with the token's own
# candidates). Multi-case prepositions list all cases they can govern; the
# resolver intersects with the token's actual candidate set.
PREP_CASES = {
    "без": {2}, "у": {2}, "до": {2}, "для": {2}, "из": {2}, "от": {2},
    "около": {2}, "вокруг": {2}, "кроме": {2}, "среди": {2}, "внутри": {2},
    "вместо": {2}, "против": {2}, "ради": {2}, "изо": {2}, "со": {2, 5},
    "после": {2}, "мимо": {2}, "вдоль": {2}, "возле": {2}, "вне": {2},
    "к": {3}, "ко": {3}, "по": {3, 4},
    "через": {4}, "про": {4}, "сквозь": {4}, "спустя": {4},
    "с": {2, 5}, "над": {5}, "под": {5, 4}, "перед": {5}, "между": {5},
    "о": {6}, "об": {6}, "обо": {6}, "при": {6},
    "в": {4, 6}, "во": {4, 6}, "на": {4, 6}, "за": {4, 5},
}

# Verbs of motion/direction => a following в/на/за/под token is accusative(4).
MOTION_VERBS = {
    "идти", "пойти", "ходить", "ехать", "поехать", "ездить", "прийти",
    "приходить", "уйти", "уходить", "войти", "входить", "выйти", "выходить",
    "приехать", "приезжать", "уехать", "уезжать", "лечь", "ложиться",
    "сесть", "садиться", "положить", "класть", "поставить", "ставить",
    "бросить", "бросать", "отправиться", "отправляться", "заходить",
    "зайти", "перейти", "переходить", "вернуться", "возвращаться",
    "полететь", "лететь", "побежать", "бежать",
}
# Verbs of state/location => a following в/на/за/под token is prepositional(6).
STATE_VERBS = {
    "быть", "находиться", "жить", "работать", "стоять", "лежать", "сидеть",
    "остаться", "оставаться", "родиться", "учиться", "висеть", "спать",
}

NUM_GENITIVE_SG = {"два", "две", "три", "четыре", "оба", "обе", "полтора", "пол"}
# 5+ and collective/indefinite quantity words govern genitive plural.
NUM_GENITIVE_PL = {
    "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать",
    "двенадцать", "много", "мало", "несколько", "сколько", "столько",
    "немного", "больше", "меньше",
}

# A bare time-unit noun immediately after ANY verb (even an intransitive one)
# with no governing preposition is, in this corpus, reliably the duration/
# frequency accusative ("живу здесь МЕСЯЦ" = "I've lived here a month",
# "ждал ЧАС" = "waited an hour") — a construction that works with fully
# intransitive verbs, unlike a normal direct object. See the dedicated check
# in resolve_sentence (found via the LINGO-033 manual audit).
TIME_UNIT_NOUNS = {
    "секунда", "минута", "час", "день", "ночь", "неделя", "месяц", "год",
    "утро", "вечер", "полдень", "полночь",
}


def norm(s):
    return s.lower().replace("ё", "е")


def load_lemma_pos():
    lemma_pos = {}
    for b in (1, 2, 3, 4):
        with open(os.path.join(DATA, f"words_band{b}.jsonl"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    w = json.loads(line)
                    lemma_pos[w["lemma"]] = w.get("pos")
    return lemma_pos


def load_sentences():
    rows = []
    for path in sorted(glob.glob(os.path.join(DATA, "sentences_band*_core.jsonl"))):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append((path, json.loads(line)))
    return rows


# Grammemes marking a parse as a proper-noun-initial/abbreviation homograph
# rather than a genuine common noun/adjective/pronoun reading — pymorphy's
# dictionary lists e.g. a single Cyrillic letter as a possible "name initial"
# noun inflecting through all 6 cases at near-zero score. A fixed score
# threshold (tried first) incorrectly ALSO killed genuine low-corpus-prior
# readings that matter here — e.g. "какой" modifying a masculine noun: its
# masc.nomn/accs readings score only 0.068/0.057 because pymorphy's training
# corpus has far more instances of "какой" in its feminine oblique-case
# readings (какой = the fem.gen/dat/instr/loc form too, a genuine three-way
# Russian homograph), so a blanket score cutoff discarded the CORRECT answer
# for exactly the sentences that needed it. Filtering by these specific
# noise-marker grammemes instead removes the junk (verified via direct
# pymorphy.parse() inspection of "Я"/"в") without touching legitimate
# low-score-but-real grammatical readings.
NOISE_GRAMMEMES = {"Init", "Abbr", "Patr", "Name", "Surn", "Arch", "Geox", "Orgn", "Trad"}


def candidate_parses(tok, declared_lemmas_norm):
    """pymorphy parses for `tok` restricted to POS noun/adj/pron whose
    normal_form matches a declared lemma of this sentence, excluding
    proper-noun/abbreviation noise parses (see NOISE_GRAMMEMES) and
    indeclinable words (Fixd — кофе, кино, etc.: the surface form never
    changes, so there is no case information worth teaching from it)."""
    out = []
    for p in MORPH.parse(tok):
        if p.tag.POS not in ("NOUN", "ADJF", "NPRO"):
            continue
        if p.tag.grammemes & NOISE_GRAMMEMES:
            continue
        if "Fixd" in p.tag.grammemes:
            continue
        if norm(p.normal_form) not in declared_lemmas_norm:
            continue
        c = p.tag.case
        if c not in CASE_MAP:
            continue
        out.append(p)
    return out


def find_governing_prep(lower_toks, toks, i):
    """Scan backwards from token i-1 through zero or more adjective/
    demonstrative modifiers (e.g. "в НОВОМ доме" / "в ЭТОМ доме" — the noun
    isn't directly adjacent to the preposition) looking for a preposition.

    Stops at (does NOT skip through) a personal pronoun (я/ты/он/меня/тебя/
    его/...) — pymorphy tags these NPRO same as demonstratives, but a
    personal pronoun immediately after a preposition IS that preposition's
    object and ends the phrase right there (e.g. "у ТЕБЯ удивлённое лицо" —
    "тебя" is "у"'s object; "лицо" is a separate, ungoverned noun phrase, NOT
    also inside "у"'s government — conflating the two was a real bug found by
    inspecting exactly this sentence's wrongly-dropped case). Demonstrative
    NPRO (этот/это/эта/эти — no 1per/2per/3per grammeme) are genuine modifiers
    and are skipped like adjectives.

    Returns the governing preposition's lowercased lemma, or None."""
    PERSON_GRAMMEMES = {"1per", "2per", "3per"}
    j = i - 1
    while j >= 0:
        if lower_toks[j] in PREP_CASES:
            return lower_toks[j]
        p0 = MORPH.parse(toks[j])[0]
        if p0.tag.POS == "ADJF":
            j -= 1
            continue
        if p0.tag.POS == "NPRO" and not (p0.tag.grammemes & PERSON_GRAMMEMES):
            j -= 1
            continue
        break
    return None


def resolve_sentence(ru_text, lemmas, lemma_pos):
    """Return list of {lemma, surface, case, number} for confidently-resolved
    tokens in this sentence, plus a debug list of (token, candidate_cases)
    for every ambiguous/dropped token (for stats)."""
    toks = TOKEN_RE.findall(ru_text)
    declared_norm = {norm(l) for l in lemmas}
    # First pass: gather per-token candidate parses + naive case sets.
    per_tok = []  # list of dict: idx, tok, parses, cases(set of ints), chosen_parse or None
    for i, tok in enumerate(toks):
        parses = candidate_parses(tok, declared_norm)
        if not parses:
            per_tok.append({"i": i, "tok": tok, "parses": [], "cases": set(), "resolved": None})
            continue
        cases = {CASE_MAP[p.tag.case] for p in parses}
        per_tok.append({"i": i, "tok": tok, "parses": parses, "cases": cases, "resolved": None})

    lower_toks = [norm(t) for t in toks]
    ambiguous_log = []

    # Pass 0: hard grammatical elimination, not a heuristic — prepositional
    # case (6/предложный) grammatically CANNOT occur without a governing
    # preposition (unlike every other case, it has no "bare" use in Russian).
    # Removing it up front resolves a large share of the corpus's remaining
    # ambiguity outright (мне/тебе "3,6" -> 3, etc.) and lets it feed cleanly
    # into the later passes for anything still multi-valued after removal.
    for entry in per_tok:
        if 6 not in entry["cases"]:
            continue
        if find_governing_prep(lower_toks, toks, entry["i"]) is None:
            entry["cases"] = entry["cases"] - {6}
            entry["parses"] = [p for p in entry["parses"] if CASE_MAP[p.tag.case] != 6]

    # Pass 1: unambiguous tokens (single candidate case) + preposition/numeral
    # governance for multi-candidate tokens.
    for entry in per_tok:
        if not entry["parses"]:
            continue
        cases = entry["cases"]
        if len(cases) == 1:
            entry["resolved"] = next(iter(cases))
            continue
        i = entry["i"]
        # Preposition governing this token (possibly through an adjective
        # modifier chain — see find_governing_prep)?
        gov = find_governing_prep(lower_toks, toks, i)
        if gov is not None:
            govset = PREP_CASES[gov]
            inter = cases & govset
            if len(inter) == 1:
                entry["resolved"] = next(iter(inter))
                continue
            if len(inter) == 2 and gov in ("в", "во", "на", "за", "под"):
                # motion vs state verb context, scanning backwards a few tokens
                # for the governing verb (skip the preposition + article-like gaps).
                verb_ctx = None
                for j in range(max(0, i - 4), i - 1):
                    lem_j = norm(MORPH.parse(toks[j])[0].normal_form)
                    if lem_j in MOTION_VERBS:
                        verb_ctx = "motion"
                    elif lem_j in STATE_VERBS:
                        verb_ctx = "state"
                if verb_ctx == "motion" and 4 in inter:
                    entry["resolved"] = 4
                    continue
                if verb_ctx == "state" and 6 in inter:
                    entry["resolved"] = 6
                    continue
                if verb_ctx == "motion" and 5 in inter:  # под/за + instr (static) excluded above
                    entry["resolved"] = 5
                    continue
                # unresolved by verb context — leave for later passes
                continue
        # Numeral immediately before?
        if i > 0 and lower_toks[i - 1] in NUM_GENITIVE_SG and 2 in cases:
            entry["resolved"] = 2
            continue
        if i > 0 and lower_toks[i - 1] in NUM_GENITIVE_PL and 2 in cases:
            entry["resolved"] = 2
            continue

    def agreement_pass():
        """Adjective/pronoun agreement with an adjacent RESOLVED noun of
        matching gender+number (only for still-ambiguous ADJF/NPRO tokens).
        Called once here (Pass 2) and again after Passes 3/4: those later
        passes can resolve a noun's case AFTER its modifying adjective was
        already looked at once (e.g. "Каждый день" — день's accusative is
        only settled by the duration-noun check in Pass 3, so a first-only
        agreement pass left "Каждый" stranded at its no-verb-default
        nominative, disagreeing in case with the noun it modifies — found by
        inspecting the actual output for exactly this sentence)."""
        for entry in per_tok:
            if entry["resolved"] is not None or not entry["parses"]:
                continue
            pos_set = {p.tag.POS for p in entry["parses"]}
            if not (pos_set & {"ADJF", "NPRO"}):
                continue
            i = entry["i"]
            for j in (i - 1, i + 1):
                if j < 0 or j >= len(per_tok):
                    continue
                other = per_tok[j]
                if other["resolved"] is None or not other["parses"]:
                    continue
                other_pos = {p.tag.POS for p in other["parses"]}
                if "NOUN" not in other_pos:
                    continue
                if other["resolved"] not in entry["cases"]:
                    continue
                # gender/number agreement check using the parse that produced
                # the resolved case on each side.
                my_p = next((p for p in entry["parses"] if CASE_MAP[p.tag.case] == other["resolved"]), None)
                their_p = next((p for p in other["parses"] if CASE_MAP[p.tag.case] == other["resolved"]), None)
                if my_p is None or their_p is None:
                    continue
                if my_p.tag.number != their_p.tag.number:
                    continue
                if my_p.tag.gender and their_p.tag.gender and my_p.tag.gender != their_p.tag.gender:
                    continue
                entry["resolved"] = other["resolved"]
                break

    # Pass 2: first agreement pass, right after Pass 1's unambiguous/
    # preposition/numeral resolutions.
    agreement_pass()

    # Pass 3: nominative-vs-accusative subject/object position heuristic,
    # only when exactly {1,4} remain as candidates (the classic inanimate
    # masc/neut syncretism where nom and acc are literally the same form).
    #
    # Only a CONFIRMED-transitive verb may anchor the "position after me =
    # accusative object" direction — "position before = nominative subject"
    # is safe regardless of the verb's transitivity (a word before any verb,
    # transitive or not, is essentially always its subject in this corpus's
    # plain sentences), but treating EVERY verb as capable of taking a direct
    # object is not: "У меня болит зуб" (my tooth hurts) has зуб AFTER
    # "болит", but болеть (in this sense) is intransitive — зуб is its
    # SUBJECT (Russian freely allows verb-subject order here), not an object.
    # Naively flipping it to accusative was a real error caught by the
    # LINGO-033 50-sample manual audit. Fix: a verb whose lemma is reflexive
    # (-ся/-сь — reflexive verbs essentially never take a direct accusative
    # object in Russian) or in NON_TRANSITIVE_VERBS (copulas + common
    # intransitive body/state/motion verbs) is excluded from "the anchor
    # verb" search entirely — exactly like быть's original exclusion (which
    # had the same real bug: comparing against the surface form instead of
    # the resolved lemma, so "было"/"был" were never actually excluded and
    # every был/было-copula sentence had its nominative predicate wrongly
    # flipped to accusative — "Это было ужасное убийство", "Это был обычный
    # день"). If a sentence's only verb(s) are all excluded, verb_idx stays
    # None and every {1,4} token in it correctly falls through to the
    # no-verb-default (nominative) below — safe, since an intransitive verb
    # never has a true accusative object to mis-classify as nominative.
    NON_TRANSITIVE_VERBS = {
        "быть", "стать", "становиться", "казаться", "оказаться", "являться",
        "значить", "болеть", "случиться", "случаться", "произойти",
        "происходить", "начаться", "начинаться", "закончиться",
        "заканчиваться", "кончиться", "кончаться", "получиться",
        "получаться", "остаться", "оставаться", "жить", "находиться",
        "работать", "стоять", "лежать", "сидеть", "спать", "идти", "ходить",
        "ехать", "ездить",
        # "стоит" (3rd sg present) is a homograph pymorphy's top parse
        # resolves to "стоить" (to cost) rather than "стоять" (to stand) —
        # found via the LINGO-033 audit ("У реки стоит маленький домик" was
        # wrongly flipping домик to accusative, treating "стоит" as
        # transitive "costs"). Neither reading takes a normal accusative
        # object (стоить's price complement is a different construction), so
        # both go in this exclusion list regardless of which one pymorphy
        # picks for a given sentence.
        "стоить",
        # Prefixed perfective motion verbs (same intransitive-motion
        # reasoning as идти/ходить/ехать/ездить above), added after a
        # systematic corpus-wide scan for verb-lemma homograph mismatches
        # turned up "спасть" (pymorphy's top parse of "спал", vs. the
        # sentence's declared "спать") and "прислать" (top parse of
        # "пришли", vs. declared "прийти") — neither actually caused a
        # visible error in this corpus (checked directly), but excluding
        # the whole motion-verb family here is cheap insurance against the
        # same class of homograph in a sentence not yet spot-checked.
        "спасть", "прийти", "уйти", "войти", "выйти", "приехать", "уехать",
        "вернуться", "зайти", "подойти", "отойти",
    }

    def is_anchor_verb(lemma_norm):
        if lemma_norm == "\x00not-a-verb":
            return False
        return lemma_norm not in NON_TRANSITIVE_VERBS and not lemma_norm.endswith(("ся", "сь"))

    # "есть" is a genuine homograph pymorphy resolves WRONG for our purposes
    # by default: its single most probable parse is the INFN "to eat"
    # (score ~0.89) with быть's existential "there is" 3rd-person-present
    # reading scoring only ~0.036 each (singular/plural) — but "У X ЕСТЬ Y"
    # ("X has Y" / "there is Y at X") is a very common construction in this
    # corpus (45 occurrences) and needs the быть reading (Y is its nominative
    # subject, not an accusative object of "eating"). The two readings are
    # syntactically distinguishable: bare finite "есть" meaning "to eat"
    # essentially never occurs in this corpus (the conjugated forms
    # ем/ешь/ест/едим/едите/едят would be used instead) — "есть" as "eat" only
    # legitimately appears as an INFN complement right after a modal/desire
    # verb ("хочу ЕСТЬ" = want to eat). So: treat bare "есть" as быть
    # (excluded) UNLESS it's immediately preceded by such a verb. Found via
    # the LINGO-033 audit ("У вас есть ордер?" was wrongly resolving ордер to
    # accusative, treating "есть" as transitive "to eat").
    MODAL_VERBS_TAKING_EST = {"хотеть", "любить", "мочь", "начать", "продолжать", "желать", "предпочитать"}

    def effective_verb_lemma(i, tok, p0):
        if norm(tok) == "есть":
            if i > 0 and norm(MORPH.parse(toks[i - 1])[0].normal_form) in MODAL_VERBS_TAKING_EST:
                return "есть"  # "хочу есть" — genuine infinitive "to eat"
            return "быть"  # existential/copula "there is"
        lemma = norm(p0.normal_form)
        # Genuine same-spelling noun/verb homographs ("пасть" = "mouth" NOUN
        # vs "to fall" VERB, both spelled and lemmatised identically) —
        # pymorphy's own tag can't disambiguate these by normal_form alone,
        # so consult OUR vocabulary's own pos field: if this exact lemma is
        # registered there as a non-verb, the sentence is using the non-verb
        # reading (this repo's words_band*.jsonl is curated per-lemma, so
        # it's authoritative), and this token must not anchor the verb-based
        # heuristics at all. Found via the LINGO-033 audit ("У него большая
        # пасть" was wrongly resolving пасть's OWN noun entry to accusative
        # because it was simultaneously being read as the sentence's anchor
        # verb via its "to fall" homograph).
        if lemma_pos.get(lemma) not in (None, "verb"):
            return "\x00not-a-verb"  # deliberately unmatchable, always excluded
        return lemma

    verb_idx = None
    for i, tok in enumerate(toks):
        p0 = MORPH.parse(tok)[0]
        if p0.tag.POS in ("VERB", "INFN") and is_anchor_verb(effective_verb_lemma(i, tok, p0)):
            verb_idx = i
            break
    # Pass 3a: special-case {1,4} resolutions that don't depend on generic
    # verb position — run BEFORE the generic heuristic (3b) so a noun's case
    # is already settled when agreement_pass() re-runs afterwards (letting
    # its adjective inherit it), instead of the adjective being greedily
    # locked into a mismatching default first.
    for entry in per_tok:
        if entry["resolved"] is not None or not entry["parses"]:
            continue
        if entry["cases"] != {1, 4}:
            continue
        i = entry["i"]
        if find_governing_prep(lower_toks, toks, i) is not None:
            continue
        # Immediately followed by a transitive infinitive ("это СДЕЛАТЬ",
        # "меня УВОЛИТЬ")? Then this token is that infinitive's object
        # (accusative) regardless of where the sentence's main verb_idx
        # falls — this specifically fixes "Мне удалось это сделать": the
        # impersonal "удалось" is correctly excluded as non-anchoring
        # (reflexive), so generic verb_idx skips ahead to "сделать" itself,
        # and plain before/after-verb_idx position logic would then call
        # "это" (which sits BEFORE "сделать") nominative — wrong, it's
        # "сделать"'s own object, an OV order inside the infinitive phrase,
        # not the subject of anything. Found via the LINGO-033 audit.
        if i + 1 < len(toks):
            next_p0 = MORPH.parse(toks[i + 1])[0]
            if next_p0.tag.POS == "INFN" and is_anchor_verb(norm(next_p0.normal_form)):
                entry["resolved"] = 4
                continue
        # Bare duration/frequency accusative ("живу здесь МЕСЯЦ" = "I've
        # lived here for a month", "ждал ЧАС" = "waited an hour") — this
        # construction works with even fully INTRANSITIVE verbs (жить,
        # ждать, работать...), unlike a normal direct object, so it must be
        # checked independently of is_anchor_verb/NON_TRANSITIVE_VERBS above:
        # a bare time-unit noun immediately after ANY verb with no governing
        # preposition is (in this simple-sentence corpus) reliably this
        # duration reading, not a VS-inverted nominative subject. Found via
        # the LINGO-033 audit ("Я живу здесь месяц" — "жить" is correctly
        # excluded as usually-intransitive for the plain subject/object
        # heuristic below, which was defaulting this to the wrong nominative).
        lemma_here = norm(entry["parses"][0].normal_form) if entry["parses"] else ""
        if lemma_here in TIME_UNIT_NOUNS:
            if i > 0:
                j = i - 1
                # Skip adverbs ("живу ЗДЕСЬ месяц") and adjective/quantifier
                # modifiers of the time noun itself ("спал ЦЕЛЫЙ день") while
                # scanning back for the governing verb — checking only POS
                # here (not is_anchor_verb/lemma) is deliberate and robust
                # against verb homograph mismatches (e.g. pymorphy's top
                # parse of "спал" is "спасть", not the declared "спать" —
                # found via the LINGO-033 audit — but POS=VERB either way).
                while j >= 0 and MORPH.parse(toks[j])[0].tag.POS in ("ADVB", "ADJF"):
                    j -= 1
                if j >= 0 and MORPH.parse(toks[j])[0].tag.POS in ("VERB", "INFN"):
                    entry["resolved"] = 4
                    continue
            # Sentence-INITIAL bare time-unit noun (optionally with a
            # preceding agreeing quantifier/adjective, "КАЖДЫЙ день") is a
            # fronted temporal-frequency accusative adverbial ("Каждый день
            # я учу русский" = "Every day I study Russian"), not a subject —
            # a genuine time-noun SUBJECT this simple corpus expresses would
            # need a verb ("настал день"), which this sentence-initial,
            # verb-less-so-far position never has. Found via the LINGO-033
            # audit.
            j = i - 1
            while j >= 0 and MORPH.parse(toks[j])[0].tag.POS == "ADJF":
                j -= 1
            if j < 0:
                entry["resolved"] = 4
                continue

    # Re-run agreement so an adjective whose noun was JUST resolved above
    # (e.g. "Каждый день" — день's accusative comes from the duration-noun
    # check just above) inherits it before Pass 3b's generic default gets a
    # chance to lock the adjective into a mismatching case on its own.
    agreement_pass()

    # Pass 3b: generic nominative-vs-accusative subject/object position
    # default for whatever {1,4} tokens are still unresolved. Nouns are
    # resolved in a first sub-pass, THEN agreement_pass() runs, THEN a second
    # sub-pass falls back to this same default for anything still unresolved
    # (adjectives with no adjacent resolved noun to agree with, etc.) — doing
    # nouns first (rather than plain left-to-right token order) matters
    # because this heuristic's own "is a subject already confirmed before
    # me" check can otherwise greedily lock an ADJECTIVE (e.g. "Каждый" in
    # "Каждый день я учу русский") into nominative purely because it's the
    # sentence's first {1,4} token, before its own noun ("день", which is
    # actually a duration accusative here) ever gets a chance to resolve and
    # be agreed with — found by inspecting exactly this sentence's output.
    def resolve_1_4(entry):
        i = entry["i"]
        if find_governing_prep(lower_toks, toks, i) is not None:
            return
        if verb_idx is None:
            # No finite verb at all — a copula-omitted nominal sentence
            # ("Это важный день.", "X — Y.") or a bare noun-phrase exclamation.
            # There is no way to form a direct object without a verb, so the
            # noun/adjective can only be the subject/predicate-nominative:
            # nominative. (Verified against the actual dropped-token sample —
            # every {1,4}-no-verb case in the corpus is this shape.)
            entry["resolved"] = 1
            return
        if i < verb_idx:
            # A clause has only one subject — if some EARLIER token before
            # the verb has already been confirmed nominative (a personal
            # pronoun like я/ты/он has a unique nominative-only surface form,
            # so it's already resolved by Pass 1 well before this runs), this
            # {1,4}-ambiguous token can't ALSO be the subject: it's a
            # fronted object instead ("Как ТЫ ЭТО называешь?" — ты is
            # already the confirmed subject, so это must be the object of
            # называешь despite sitting before it). Found via the LINGO-033
            # audit. Falls back to the plain "before verb = nominative"
            # default when no such earlier subject exists.
            has_subject_already = any(
                other["resolved"] == 1 for other in per_tok[:i] if other["i"] < verb_idx
            )
            entry["resolved"] = 4 if has_subject_already else 1
            return
        entry["resolved"] = 4

    def is_1_4_candidate(entry):
        return entry["resolved"] is None and entry["parses"] and entry["cases"] == {1, 4}

    for entry in per_tok:
        if is_1_4_candidate(entry) and "NOUN" in {p.tag.POS for p in entry["parses"]}:
            resolve_1_4(entry)
    agreement_pass()
    for entry in per_tok:
        if is_1_4_candidate(entry):
            resolve_1_4(entry)
    agreement_pass()

    # A small closed class of Russian verbs takes a GENITIVE complement, not
    # an accusative direct object (избегать/бояться/желать/etc.) — Pass 4's
    # default assumption below ("verb immediately before a {2,4}-ambiguous
    # pronoun/animate-noun = accusative object") is wrong for exactly these,
    # found via the LINGO-033 audit ("Я избегаю этого места" was wrongly
    # resolving "этого" to accusative — избегать governs genitive). Resolved
    # to genitive directly (deterministic lexical knowledge, not a guess).
    GENITIVE_GOVERNING_VERBS = {
        "избегать", "избежать", "бояться", "испугаться", "желать", "пожелать",
        "требовать", "потребовать", "достигать", "достигнуть", "добиваться",
        "добиться", "лишиться", "лишать", "лишить", "стесняться",
        "постесняться", "стыдиться", "устыдиться", "касаться", "коснуться",
        "жаждать", "чуждаться",
    }

    # Pass 4: genitive-vs-accusative for pronouns/animate nouns (меня/тебя/
    # его/её/нас/вас/их and animate nouns share their gen. and acc. singular
    # form). Only fires when no preposition governs it (Pass 1 already
    # handled that) and a verb directly precedes with no intervening negation
    # ("не") — genitive-of-negation is a genuine competing reading we do NOT
    # try to resolve, so a negated verb context is left ambiguous (dropped)
    # rather than guessed.
    for entry in per_tok:
        if entry["resolved"] is not None or not entry["parses"]:
            continue
        if entry["cases"] != {2, 4}:
            continue
        i = entry["i"]
        if find_governing_prep(lower_toks, toks, i) is not None:
            continue
        if i == 0:
            continue
        prev_tok = toks[i - 1]
        prev_p0 = MORPH.parse(prev_tok)[0]
        if prev_p0.tag.POS not in ("VERB", "INFN"):
            continue
        if norm(prev_p0.normal_form) in GENITIVE_GOVERNING_VERBS:
            entry["resolved"] = 2
            continue
        if i >= 2 and lower_toks[i - 2] == "не":
            continue  # genitive-of-negation is genuinely possible — don't guess
        entry["resolved"] = 4

    out = []
    for entry in per_tok:
        if entry["resolved"] is None:
            if entry["parses"] and len(entry["cases"]) > 1:
                ambiguous_log.append((entry["tok"], sorted(entry["cases"])))
            continue
        # pick the parse matching the resolved case for lemma/number
        p = next((pp for pp in entry["parses"] if CASE_MAP[pp.tag.case] == entry["resolved"]), None)
        if p is None:
            continue
        number = "pl" if p.tag.number == "plur" else "sg"
        out.append({
            "lemma": p.normal_form,
            "surface": entry["tok"],
            "case": entry["resolved"],
            "number": number,
        })
    return out, ambiguous_log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="print N random resolved forms for audit")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--write", action="store_true", help="write forms back into the sentence JSONL files")
    args = ap.parse_args()

    lemma_pos = load_lemma_pos()
    rows = load_sentences()

    total_candidate_tokens = 0
    total_resolved = 0
    total_ambiguous_dropped = 0
    by_path = {}
    sample_pool = []

    updated_by_path = {}

    for path, s in rows:
        forms, amb = resolve_sentence(s["ru"], s.get("lemmas", []), lemma_pos)
        n_cand = len(forms) + len(amb)
        total_candidate_tokens += n_cand
        total_resolved += len(forms)
        total_ambiguous_dropped += len(amb)
        by_path.setdefault(path, {"cand": 0, "resolved": 0, "dropped": 0})
        by_path[path]["cand"] += n_cand
        by_path[path]["resolved"] += len(forms)
        by_path[path]["dropped"] += len(amb)
        for f in forms:
            sample_pool.append((s["id"], s["ru"], f))
        updated_by_path.setdefault(path, []).append((s, forms))

    print(f"total candidate tokens (noun/adj/pron matching a declared lemma): {total_candidate_tokens}")
    print(f"resolved & shown: {total_resolved} ({100*total_resolved/total_candidate_tokens:.1f}%)")
    print(f"ambiguous & dropped: {total_ambiguous_dropped} ({100*total_ambiguous_dropped/total_candidate_tokens:.1f}%)")
    print()
    for path, stats in sorted(by_path.items()):
        print(f"  {os.path.basename(path)}: cand={stats['cand']} shown={stats['resolved']} "
              f"dropped={stats['dropped']} ({100*stats['dropped']/max(1,stats['cand']):.1f}%)")

    if args.sample:
        random.seed(args.seed)
        sample = random.sample(sample_pool, min(args.sample, len(sample_pool)))
        print(f"\n=== random sample of {len(sample)} resolved forms for manual audit ===")
        for sid, ru, f in sample:
            print(f"{sid}: {ru}\n   {f['surface']} -> {f['lemma']} [{f['case']}格/{CASE_LOCAL[f['case']]}, {f['number']}]")

    if args.write:
        for path, items in updated_by_path.items():
            with open(path, "w", encoding="utf-8") as fh:
                for s, forms in items:
                    if forms:
                        s["forms"] = forms
                    else:
                        s.pop("forms", None)
                    fh.write(json.dumps(s, ensure_ascii=False) + "\n")
        print(f"\nwrote forms into {len(updated_by_path)} files")


if __name__ == "__main__":
    main()
