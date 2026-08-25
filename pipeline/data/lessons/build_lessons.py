#!/usr/bin/env python3
"""Build sentences_imported_lessons.jsonl from Katsuta's Google-Sheet lessons.

Source CSVs (fetch.sh) are hand-transcribed here into clean, quality-checked
entries rather than parsed mechanically, because the sheets mix:
  - RU/EN sentence pairs (some EN cells actually hold a Japanese gloss),
  - vocabulary (single words / set phrases, sometimes with conjugation memos),
  - error-correction triples (wrong sentence / correct Russian / grammar rule).

Design decisions (see Tasks/LINGO-009 comment):
  - Sentence pairs   -> kind='sentence'
  - Vocabulary       -> kind='word'  (memos/conjugations go to `note`)
  - Error corrections-> kind='sentence', ru = the CORRECT Russian, and
      note = "よくある間違い: ❌<wrong>｜<rule summary>"  (Katsuta's own mistakes
      are the highest-value study material).
  - EN補訳: where a source row had no English (or Japanese only), a natural
    English translation is supplied here; original Japanese goes to `ja`.
  - Obvious RU typos in the source are corrected (quality first), e.g.
    вседга→всегда, Дрквнегреческий→Древнегреческий, крнкурс→конкурс, сдет→сядет.
  - Rows too ambiguous/incomplete to import (e.g. a bare "чистить" with no
    gloss) are SKIPPED and listed in SKIPPED below, not silently dropped.

Output: ../sentences_imported_lessons.jsonl  (source=imported, band1, id=L####).
Idempotent: stable ids by insertion order; de-dupes against the existing DB
sources (sentences_band1.jsonl + sentences_imported.jsonl) and within itself,
using normalized ru (casefold, ё→е, punctuation stripped, whitespace collapsed).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.dirname(HERE)  # pipeline/data
OUT = os.path.join(DATA, "sentences_imported_lessons.jsonl")

# ---------------------------------------------------------------- lemma helper
def band1_lemmas():
    s = set()
    p = os.path.join(DATA, "words_band1.jsonl")
    for line in open(p, encoding="utf-8"):
        line = line.strip()
        if line:
            s.add(json.loads(line)["lemma"])
    return s

BAND1 = band1_lemmas()

def auto_lemmas(ru):
    """Best-effort: keep surface tokens that are themselves a band1 lemma
    (exact form). Conservative — no stemming — so it never emits an unmatched
    lemma warning. Enough for coverage of function words / uninflected forms."""
    toks = re.findall(r"[а-яёА-ЯЁ-]+", ru.lower())
    out, seen = [], set()
    for t in toks:
        if t in BAND1 and t not in seen:
            out.append(t)
            seen.add(t)
    return out

# ---------------------------------------------------------------- entries
# Each entry: (kind, ru, en, ja_or_None, note_or_None)
S, W = "sentence", "word"

def corr(wrong, rule):
    return f"よくある間違い: ❌{wrong}｜{rule}"

ENTRIES = []
def add(kind, ru, en, ja=None, note=None):
    ENTRIES.append({"kind": kind, "ru": ru, "en": en, "ja": ja, "note": note})

# ===== SHEET 1 — УРОК lessons (RU/EN pairs) =====
# -- 11.08.2026
add(S, "На каких выступлениях ты был в Москве?", "Which performances have you been to in Moscow?")
add(W, "с удовольствием", "with pleasure")
add(S, "Я делаю приложения с удовольствием", "I enjoy making apps.")
add(S, "Что ты обязательно делаешь каждый день?", "What do you definitely do every day?")
add(S, "Порядок слов и перевод странные", "The word order and translation are strange.")
add(W, "выучить наизусть", "to memorize / learn by heart", ja="暗記する、覚える")
add(S, "Я пока не учу русские стихи", "I'm not learning Russian poems yet.", note="пока = yet")
add(S, "Люди всегда должны думать о других", "People should always think about others.",
    note="source typo вседга → всегда")
add(S, "Ты учишь их наизусть? — Я учу русские правила наизусть",
    "Do you learn them by heart? — I learn the Russian rules by heart.", note="правила = rules")
add(W, "собор", "cathedral")
add(W, "монастырь", "monastery", note="м.р. (masculine); пример: Я был в монастыре")
add(W, "экскурсовод", "tour guide")
add(S, "Твои друзья когда-нибудь рассказывали тебе об истории Москвы?",
    "Have your friends ever told you about the history of Moscow?")
add(W, "древнегреческий", "Ancient Greek", note="source typo Дрквнегреческий → древнегреческий")
add(W, "однажды", "once")
add(S, "Ты знаешь других древнегреческих философов?", "Do you know other Ancient Greek philosophers?")
add(S, "Тебя интересует философия?", "Are you interested in philosophy?")
add(S, "На этом трудно фокусироваться, потому что это скучно",
    "It's hard to focus on this because it's boring.")
add(W, "скрипка", "violin")
add(W, "учёный-физиолог", "physiologist (research scientist)")
add(S, "Я не болею", "I'm not sick.")
add(W, "болеть", "to be sick")
add(S, "Я болею за Роналдо", "I root for Ronaldo.", note="болеть за = to root for / support (a team, player)")
add(S, "Я болею за одну баскетбольную команду", "I root for a basketball team.")
# -- 13.08.2026
add(W, "научная фантастика", "science fiction")
add(S, "Я не умею играть на музыкальных инструментах", "I can't play musical instruments.")
add(S, "Я знаю много японских команд", "I know many Japanese teams.")
add(W, "вундеркинды", "prodigies", note="sg. вундеркинд")
add(W, "выступать в цирке", "to perform in the circus")
add(W, "международный конкурс", "international competition", note="source typo крнкурс → конкурс")
add(W, "сказка", "fairy tale")
add(W, "газета", "newspaper")
add(W, "юная и талантливая художница", "a young and talented artist (f.)")
add(W, "сосед", "neighbour")
add(W, "удивительный", "amazing")
add(S, "У них в цирке есть лев, медведь, слон.", "They have a lion, a bear, and an elephant in their circus.")
add(S, "Кстати, я вспомнил, что я учился играть на пианино",
    "By the way, I remembered that I learned to play the piano.")
add(S, "Вместо газет мы читаем новости в телефоне", "Instead of newspapers, we read the news on our phones.")
# -- 20.08.2026
add(W, "выходной", "day off")
add(W, "праздник", "holiday / celebration")
add(S, "Я буду гулять по набережной", "I'll be walking along the embankment.",
    note="набережная = embankment (a promenade along a river, sea or any shore)")
add(S, "Это правда, что люди в Японии живут очень долго?", "Is it true that people in Japan live very long?")
add(S, "Сколько в среднем живут японцы?", "How long do Japanese people live on average?")
add(W, "сердце", "heart")
add(W, "сломать", "to break")
add(S, "Сломались", "They broke down.", note="formy: сломался (m.), сломалась (f.), сломались (pl.)")
add(W, "бытовая техника", "home appliances")
add(W, "стиральная машина", "washing machine")
add(W, "чайник", "kettle")
add(W, "продавец", "seller")
add(W, "миксер", "mixer")
add(W, "посудомойка", "dishwasher", note="ударение: посудомОйка")
add(W, "сушильная машина", "drying machine")
add(S, "У меня никогда не ломается бытовая техника", "My home appliances never break down.")
add(W, "ломаться — сломаться", "to break down (imperfective — perfective)",
    note="вид: ломаться (НСВ) — сломаться (СВ)")
# -- 25.08.2026
add(S, "Как часто? — Каждую неделю, каждые две недели",
    "How often? — Every week, every two weeks.")
add(S, "Бытовая техника у меня никогда не ломается", "My home appliances never break down.")
add(W, "снимать квартиру", "to rent an apartment")
add(W, "зарабатывать деньги", "to make money")
add(W, "сводить концы с концами", "to make ends meet",
    note="idiom: to barely make enough money to live")
add(W, "читатель", "reader")
add(W, "скоро", "soon")
add(W, "обратить внимание на…", "to pay attention to…")
add(W, "всё-таки", "still / after all / nevertheless")
add(S, "У него хватит денег", "He has enough money.")
add(S, "Хватает денег, времени, ресурсов", "There is enough money, time, and resources.")
add(W, "незнакомец — незнакомка", "stranger (m. / f.)")
add(W, "представлять", "to imagine")
add(S, "Он удивился", "He was surprised.")
add(W, "болтливый", "talkative")
add(W, "неприятный", "unpleasant")

# ===== SHEET 2 tab1 — First class 05/08 =====
# -- New vocabulary (verbs / adverbs / phrases)
add(W, "просыпаться", "to wake up", note="я просыпаюсь, он просыпается, они просыпаются")
add(W, "ложиться спать", "to go to bed")
add(W, "собираться", "to get ready")
add(W, "одеваться", "to get dressed")
add(W, "принимать душ", "to take a shower")
add(W, "чистить зубы", "to brush one's teeth")
add(W, "готовить завтрак", "to make breakfast")
add(W, "варить кофе", "to make / brew coffee")
add(W, "ехать на учёбу", "to go to university / school")
add(W, "добираться", "to get to")
add(W, "опаздывать", "to be late")
add(W, "успевать", "to have enough time / to manage")
add(W, "проводить время", "to spend time")
add(W, "делать домашнее задание", "to do homework")
add(W, "гулять", "to go for a walk")
add(W, "встречаться с друзьями", "to meet friends")
add(W, "заниматься спортом", "to do sports / exercise")
add(W, "отдыхать", "to relax")
add(W, "ложиться поздно", "to go to bed late")
add(W, "рано вставать", "to get up early")
add(W, "почти каждый день", "almost every day")
add(W, "обычно", "usually")
add(W, "иногда", "sometimes")
add(W, "редко", "rarely")
add(W, "в последнее время", "lately / recently")
add(W, "по дороге", "on the way")
add(W, "после занятий", "after classes")
add(W, "до занятий", "before classes")
# -- Sentences with the phrases (EN / RU)
add(S, "Я обычно просыпаюсь в семь часов.", "I usually wake up at seven.")
add(S, "Я одеваюсь очень быстро.", "I get dressed very quickly.")
add(S, "Я обычно принимаю душ перед завтраком.", "I usually take a shower before breakfast.")
add(S, "Я чищу зубы два раза в день.", "I brush my teeth twice a day.")
add(S, "Я каждое утро варю кофе.", "I make coffee every morning.")
add(S, "Я редко готовлю завтрак.", "I rarely cook breakfast.")
add(S, "Я обычно езжу в университет на метро.", "I usually go to university by metro.")
add(S, "Мне нужно тридцать минут, чтобы добраться до университета.",
    "It takes me thirty minutes to get to university.")
add(S, "Я иногда опаздываю на занятия.", "I am sometimes late for class.")
add(S, "Я провожу много времени, изучая русский язык.", "I spend a lot of time studying Russian.")
add(S, "Я каждый вечер делаю домашнее задание.", "I do my homework every evening.")
add(S, "Я часто гуляю после занятий.", "I often go for a walk after classes.",
    note=corr("Я часто гуляю после занятиях.", "после + genitive: после занятий"))
add(S, "Я обычно встречаюсь с друзьями по выходным.", "I usually meet my friends on weekends.")
add(S, "Я занимаюсь спортом три раза в неделю.", "I do sports three times a week.")
add(S, "Я люблю отдыхать дома.", "I like to relax at home.")
add(S, "Я часто поздно ложусь спать.", "I often go to bed late.")
add(S, "Завтра мне нужно рано встать.", "I have to get up early tomorrow.")
add(S, "Я пью кофе почти каждый день.", "I drink coffee almost every day.")
add(S, "В последнее время я был очень занят.", "Recently I have been very busy.")
add(S, "Я обычно слушаю музыку по дороге в университет.", "I usually listen to music on the way to university.")
add(S, "Мы часто ходим в кафе после занятий.", "We often go to a café after classes.")
add(S, "Я никогда не ем до занятий.", "I never eat before classes.")
add(S, "Иногда я не успеваю приготовить еду.", "Sometimes I don't have enough time to cook.")
add(S, "Я обычно провожу вечер с друзьями.", "I usually spend the evening with my friends.")
# -- Error corrections (ru = correct; note = the mistake + rule)
add(S, "Я закончил свою работу.", "I finished my work.",
    note=corr("Я закончил моя работа.", "所有は свой を使う（мой でなく）。закончить の後は対格: работа → работу"))
add(S, "Раньше я жил в Грузии один год.", "I lived in Georgia for one year.",
    note=corr("Я живу в Грузии раньше один год.", "完了した動作は過去形（жил/прожил）。раньщо は文頭に置く。alt: Я прожил в Грузии один год."))
add(S, "У меня было несколько друзей.", "I had a few friends.",
    note=corr("У меня было некоторый друзей.", "несколько の後は生格複数（друзей）。alt: У меня были некоторые друзья."))
add(S, "Я работал с русскими и белорусами.", "I worked with Russians and Belarusians.",
    note=corr("Я работал с русским, белорусом людей.", "前置詞 с の後は造格: русскими, белорусами"))
add(S, "Когда мне было 25–28 лет…", "When I was 25–28 years old…",
    note=corr("Когда мне 25–28…", "過去の年齢は было を使う"))
add(S, "Я остался на два месяца.", "I stayed for two months.",
    note=corr("Я остался два месяцев.", "остаться の期間は на + 対格。два の後は месяца（месяцев でなく）"))
add(S, "Я попробовал жить во многих странах.", "I tried living in many countries.",
    note=corr("Я попробовал жить в много странах.", "в（場所）の後は前置格: во многих странах"))
add(S, "Где я не могу говорить по-английски.", "Where I can't speak English.",
    note=corr("Где я не могу говорить по английский.", "говорить の後の言語は副詞: по-русски, по-английски"))
add(S, "Я учился в университете на архитектора.", "I studied architecture at university.",
    note=corr("Я учился в университете архитектор.", "учиться の後の職業は на + 対格"))
add(S, "Потом я начал учиться на инженера.", "Then I started studying to become an engineer.",
    note=corr("Потом я начал изучать инженер.", "изучать инженер は不可。учиться на инженера か изучать инженерное дело"))
add(S, "Это одна из причин быть инженером.", "This is one of the reasons to be an engineer.",
    note=corr("Это одна причина быть инженер.", "быть の後の職業は造格: инженером"))
add(S, "Я был в языковой школе.", "I was at a language school.",
    note=corr("Я был в язык школа.", "形容詞は名詞に一致: языковая школа → в языковой школе（前置格）"))
add(S, "Я был в Гватемале.", "I was in Guatemala.",
    note=corr("В Гватемала.", "в（場所）の後は前置格: в Гватемале"))
add(S, "Когда я путешествовал…", "When I was traveling…",
    note=corr("Когда я путешествовать…", "когда の後は定形動詞（不定詞でなく）"))
add(S, "Я не мог ходить в школу.", "I couldn't go to school.",
    note=corr("Я не мог ехать в школе.", "ходить в школу = 通学（習慣）。ехать は1回の移動。в школу は対格"))
add(S, "Я не мог встречаться с людьми.", "I couldn't meet with people.",
    note=corr("Я не могу встречи с люди.", "мочь の後は不定詞。с の後は造格: людьми"))
add(S, "Я не могу понимать, что говорят люди.", "I can't understand what people are saying.",
    note=corr("Я не могу слушать, как люди сказать.", "как/что の後は活用した動詞（不定詞でなく）"))
add(S, "Мне нужно время, чтобы подумать.", "I need time to think.",
    note=corr("Надо время думать.", "定型: Мне нужно время, чтобы…"))
add(S, "Я учусь только по-русски.", "I study only in Russian.",
    note=corr("Я изучаю только по русски.", "言語の副詞はハイフン付き: по-русски"))
add(S, "Я живу в Японии по пять-шесть месяцев в году.", "I live in Japan for five or six months a year.",
    note=corr("Я живу много месяцев Японии.", "жить の後は в + 前置格: в Японии"))
add(S, "Я переехал в Америку.", "I moved to America.",
    note=corr("Я начал переехать в Америке.", "начать の後は不完了体不定詞。移動先は в Америку（対格）。alt: Я начал переезжать в Америку."))
add(S, "Я путешествовал по многим странам.", "I traveled through many countries.",
    note=corr("Я путешествовал много странав.", "путешествовать は по + 与格"))
add(S, "Я жил во многих странах.", "I lived in many countries.",
    note=corr("Я живу много странов.", "во の後は前置格: во многих странах"))
add(S, "Моё хобби — танцевать…", "My hobby is dancing…",
    note=corr("Мои хобби танцевать…", "хобби は中性単数なので моё"))
add(S, "После того как я закончу изучать русский…", "After I finish studying Russian…",
    note=corr("После закончить изучать русский…", "после の後に不定詞は不可。名詞（окончания）か節（после того как…）"))
add(S, "Путешествовать по странам.", "To travel through countries.",
    note=corr("Путешествовать в страной.", "путешествовать は по + 与格。поехать は в + 対格"))
add(S, "Попробовать пожить несколько месяцев.", "To try living for a few months.",
    note=corr("Попробовать жить некоторый месяцев.", "несколько の後は生格複数: месяцев"))
add(S, "Где спокойная жизнь.", "Where life is peaceful.",
    note=corr("Где медленная жизнь.", "自然な連語は спокойная жизнь（медленная жизнь でなく）"))

# ===== SHEET 2 tab2 =====
# -- vocabulary (orientation flips per row; Cyrillic token is the RU)
add(W, "облако", "cloud")
add(W, "туча", "storm cloud / rain cloud")
add(W, "пот", "sweat")
add(W, "ветрено", "windy")
add(W, "горы", "mountains", note="sg. гора")
add(W, "в горах", "in the mountains")
add(W, "тёплая", "warm (f.)")
add(W, "младший брат", "younger brother")
add(W, "карта", "map")
add(W, "официальный", "official")
add(W, "недавно", "recently")
add(W, "работники", "employees", note="sg. работник")
add(W, "медсестра", "nurse")
add(W, "лучший друг / лучшая подруга", "best friend (m. / f.)")
add(W, "жар", "fever")
add(W, "болезнь", "illness")
add(W, "7 раз отмерь, 1 раз отрежь", "measure seven times, cut once",
    note="пословица (proverb): think carefully before acting")
add(W, "раньше", "earlier")
add(W, "перед / до", "before")
# -- sentences (EN / RU)
add(S, "Я не чувствую себя холодно", "I don't feel cold")
add(S, "Я не чувствую холод", "I don't feel the coldness")
add(S, "Ей нужно вылечить свою болезнь", "She needs to cure her illness")
# -- error corrections unique to tab2 (dups of tab1 are dropped by de-dup on ru)
add(S, "Когда мне было 25 лет, я жил в Грузии.", "When I was 25, I lived in Georgia.",
    note=corr("Когда мне 25 лет, я жил в Грузии.", "過去の年齢は было を使う"))

# ===== SHEET 2 tab3 =====
# -- vocabulary block 1
add(W, "настроение", "mood")
add(W, "в неделю", "per week")
add(W, "на неделю", "for a week")
add(W, "из-за", "because of")
add(W, "короткий", "short", note="人の身長には使わない (not used to describe a person's height)")
add(W, "завтракать", "to have breakfast")
# -- sentences block 1
add(S, "У меня хорошее настроение", "I am in a good mood.",
    note="ты: у тебя хорошее настроение")
add(S, "Я завтракаю дома.", "I am having breakfast at home.",
    note="спряжение: я завтракаю, ты завтракаешь, он завтракает, они завтракают")
# -- irregular verbs (kind=word, conjugation -> note)
add(W, "идти", "to go (on foot)", note="Я иду, ты идёшь, он/она идёт, мы идём, вы идёте, они идут")
add(W, "ехать", "to go (by transport)", note="я еду, ты едешь, он едет, мы едем, вы едете, они едут")
add(W, "есть", "to eat", note="я ем, ты ешь, он ест, мы едим, вы едите, они едят")
add(W, "мочь", "can / to be able to", note="я могу, ты можешь, он может, мы можем, вы можете, они могут")
add(W, "хотеть", "to want", note="я хочу, ты хочешь, он хочет, мы хотим, вы хотите, они хотят")
add(W, "дать", "to give", note="я дам, ты дашь, он даст, мы дадим, вы дадите, они дадут")
add(W, "бежать", "to run", note="я бегу, ты бежишь, он бежит, мы бежим, вы бежите, они бегут")
add(W, "сесть", "to sit down", note="я сяду, ты сядешь, он сядет, мы сядем, вы сядете, они сядут (source typo сдет → сядет)")
add(W, "лечь", "to lie down", note="я лягу, ты ляжешь, он ляжет, мы ляжем, вы ляжете, они лягут")
add(W, "взять", "to take", note="я возьму, ты возьмёшь, он возьмёт, мы возьмём, вы возьмёте, они возьмут")
add(W, "пить", "to drink", note="я пью, ты пьёшь, он пьёт, мы пьём, вы пьёте, они пьют")
add(W, "спать", "to sleep", note="я сплю, ты спишь, он спит, мы спим, вы спите, они спят")
# SKIPPED: tab3 last row "чистить" — no English gloss and no conjugation in the
# source (row was cut off). Not enough to import cleanly. Recorded, not dropped.
SKIPPED = [("чистить", "sheet2_tab3: no English gloss / cut-off row")]

# ---------------------------------------------------------------- de-dup + write
def norm(ru):
    s = ru.casefold().replace("ё", "е")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()

def existing_norms():
    seen = set()
    for fn in ("sentences_band1.jsonl", "sentences_imported.jsonl"):
        p = os.path.join(DATA, fn)
        if not os.path.exists(p):
            continue
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line:
                seen.add(norm(json.loads(line)["ru"]))
    return seen

def main():
    existing = existing_norms()
    out_lines = []
    seen_new = {}
    n = 0
    dup_db = []      # normalized ru already in DB
    dup_self = []    # duplicate within the lesson set
    counts = {"sentence": 0, "word": 0}
    for e in ENTRIES:
        key = norm(e["ru"])
        if key in existing:
            dup_db.append(e["ru"])
            continue
        if key in seen_new:
            dup_self.append(e["ru"])
            continue
        seen_new[key] = True
        n += 1
        sid = f"L{n:04d}"
        rec = {
            "id": sid,
            "ru": e["ru"],
            "en": e["en"],
            "kind": e["kind"],
            "source": "imported",
            "band": 1,
            "difficulty": 1,
            "lemmas": auto_lemmas(e["ru"]),
        }
        # ja: explicit source Japanese, else mirror the gloss for word cards
        if e["ja"] is not None:
            rec["ja"] = e["ja"]
        elif e["kind"] == "word":
            rec["ja"] = e["en"]
        if e["note"] is not None:
            rec["note"] = e["note"]
        # keep a readable, stable key order
        ordered = {k: rec[k] for k in
                   ("id", "ru", "en", "ja", "kana", "note", "kind", "source",
                    "band", "difficulty", "lemmas") if k in rec}
        out_lines.append(json.dumps(ordered, ensure_ascii=False))
        counts[e["kind"]] += 1

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines) + "\n")

    print(f"wrote {OUT}")
    print(f"  imported total : {n}  (sentence {counts['sentence']} / word {counts['word']})")
    print(f"  de-dup vs DB   : {len(dup_db)}")
    for r in dup_db:
        print(f"      - {r}")
    print(f"  de-dup in-set  : {len(dup_self)}")
    for r in dup_self:
        print(f"      - {r}")
    print(f"  skipped        : {len(SKIPPED)}")
    for w, why in SKIPPED:
        print(f"      - {w}  ({why})")

if __name__ == "__main__":
    main()
