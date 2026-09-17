#!/usr/bin/env python3
"""LINGO-051 step 3: turn rewrite_plan.json into Codex-ready batch files
(50/batch) with explicit per-row construction instructions so the rewritten
RU sentence is virtually guaranteed to re-classify into the intended bucket
(the instructions mirror classify_subjects.py's own detection rules exactly).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

BUCKET_INSTRUCTION = {
    "я": ("Start the sentence with the literal word \"Я\" as the grammatical "
          "subject (nominative \"I\"). Natural first-person statement about "
          "yourself — a preference, plan, feeling, or fact about you."),
    "ты": ("Include the literal word \"Ты\" (nominative \"you\", informal) as "
           "the grammatical subject — either a statement or a casual question "
           "to a friend/date."),
    "вы": ("Include the literal word \"Вы\" (nominative \"you\", formal/plural) "
           "as the grammatical subject — a polite question or statement, as "
           "you'd say to a waiter, stranger, or someone you just met."),
    "она": ("Include the literal word \"Она\" (nominative \"she\") as the "
            "grammatical subject — a statement about a specific woman (a "
            "friend, date, colleague, family member)."),
    "мы": ("Include the literal word \"Мы\" (nominative \"we\") as the "
           "grammatical subject — a shared plan, activity, or observation "
           "about you and someone else together."),
    "они": ("Include the literal word \"Они\" (nominative \"they\") as the "
            "grammatical subject — a statement about other people (not you, "
            "not the listener)."),
    "no_subject": ("Use ONE of: (a) an IMPERATIVE-mood verb with no subject "
                   "pronoun at all (a request/command, e.g. \"Подожди "
                   "минутку.\"), (b) \"Давай ...\" / \"Давайте ...\" as a "
                   "suggestion opener, or (c) a standalone modal with NO "
                   "dative pronoun attached (\"Можно ...?\", \"Нельзя ...\", "
                   "\"Надо ...\" used impersonally, not \"Мне надо\"). Do NOT "
                   "use я/ты/вы/он/она/мы/они anywhere in the sentence."),
}

EXAMPLES = {
    "я": '{"ru": "Я обычно заказываю капучино.", "en": "I usually order a cappuccino.", "ja": "私はいつもカプチーノを頼みます。"}',
    "ты": '{"ru": "Ты уже выбрал столик?", "en": "Have you already picked a table?", "ja": "もうテーブルは決めた？"}',
    "вы": '{"ru": "Вы не подскажете дорогу?", "en": "Could you point me to the way?", "ja": "道を教えていただけますか？"}',
    "она": '{"ru": "Она обожает итальянскую кухню.", "en": "She loves Italian food.", "ja": "彼女はイタリア料理が大好きです。"}',
    "мы": '{"ru": "Мы можем встретиться в субботу.", "en": "We can meet on Saturday.", "ja": "土曜日に会えます。"}',
    "они": '{"ru": "Они часто гуляют вечером.", "en": "They often go for walks in the evening.", "ja": "彼らはよく夕方に散歩します。"}',
    "no_subject": '{"ru": "Можно взять твой номер?", "en": "Can I get your number?", "ja": "連絡先を聞いてもいい？"}',
}

PROMPT_TEMPLATE = """You are a Russian conversation-content writer for a language-learning app (A1-B1 level, Russian for English/Japanese speakers). You are REWRITING existing flashcard example sentences — not creating new vocabulary items — to fix an unnatural, "textbook-smell" subject-person distribution. Katsuta (the product owner) derived the target distribution from simulating real dating/cafe/small-talk conversations: real spoken Russian leans я/ты-heavy with natural мы/они/no-subject/dative-experiencer constructions, NOT generic third-person textbook statements ("Это трудный курс.", "Ситуация очень плохая.").

CRITICAL RULES (every one is validated mechanically after generation — violations get rejected):
1. The new `ru` sentence MUST use the given `target_lemma` with its SAME part of speech and SAME core meaning as it's used in `old_ru` (word-family variation is fine, e.g. a different but grammatically valid inflected form — but do not swap in an unrelated sense of a polysemous word).
2. The new `ru` sentence MUST be 3 to 7 Cyrillic content-word tokens (count words, not letters).
3. Follow the `construction_instruction` for this row EXACTLY — this determines which subject-distribution bucket the sentence counts toward, and is checked automatically.
4. Register: natural, everyday SPOKEN Russian — the kind of thing you'd actually say to someone you're dating, ordering coffee with, or making plans with. NOT an encyclopedia fact, NOT a crime-drama plot line, NOT an abstract statement about "the situation" or "the course."
5. Wrap the target word with SIMPLE, common vocabulary (everyday nouns/verbs a beginner already knows) rather than other rare words.
5b. If `target_lemma` is inherently dark/violent/crime-related (steal, shoot, kidnap, prison, spy, criminal, blood, gun, explode, murder, etc.) — DO NOT write a sentence describing a real threat or crime in progress. Instead REFRAME it into a SAFE, everyday context that still naturally uses the word: a movie/TV-show/book/video-game topic ("Вы любите фильмы про шпионов?"), a hobby (an airsoft/shooting range, a heist board game), a playful idiom (украсть → "украсть поцелуй"/"украсть твоё сердце" = to steal a kiss/your heart), a news headline mentioned in passing, or someone's profession (a detective novelist, a security guard). The goal is a sentence a real person would comfortably say on a first date or at a cafe — never a first-person description of committing or threatening violence.
6. `lemmas`: the array of EVERY dictionary-form lemma a learner would need looked up for this sentence (include the target_lemma, all pronouns used, all content words — mirror the style of `old_lemmas` given for reference). Use modern standard spelling (ё where the word normally takes it, e.g. "всё" not "все" when it means "everything").
7. Provide `en` and `ja` translations that are natural short translations of your NEW `ru` (not the old one).
8. `id` in your output must exactly match the input `id` — you are replacing content for existing ids, not creating new ones.

OUTPUT: a JSON array, one object per input row, SAME ORDER, fields exactly:
  {"id": "...", "ru": "...", "en": "...", "ja": "...", "lemmas": ["...", ...]}
No markdown fences, no commentary before or after.

INPUT (JSON array of rows to rewrite):
__INPUT__
"""


def main():
    plan = json.load(open(os.path.join(HERE, "rewrite_plan.json"), encoding="utf-8"))
    batch_size = 50
    batches = [plan[i:i + batch_size] for i in range(0, len(plan), batch_size)]
    os.makedirs(os.path.join(HERE, "rewrite_batches"), exist_ok=True)
    for i, batch in enumerate(batches):
        rows = []
        for p in batch:
            rows.append({
                "id": p["id"],
                "target_lemma": p["target_lemma"],
                "old_ru": p["ru"],
                "old_lemmas_hint": None,  # not tracked in plan; Codex infers from old_ru
                "new_bucket": p["new_bucket"],
                "construction_instruction": BUCKET_INSTRUCTION[p["new_bucket"]],
                "example": EXAMPLES[p["new_bucket"]],
            })
        out_path = os.path.join(HERE, "rewrite_batches", f"batch_{i:03d}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"wrote {len(batches)} batches ({batch_size}/batch, last has {len(batches[-1]) if batches else 0}) to rewrite_batches/")

    with open(os.path.join(HERE, "rewrite_prompt_template.txt"), "w", encoding="utf-8") as f:
        f.write(PROMPT_TEMPLATE)
    print("wrote rewrite_prompt_template.txt")


if __name__ == "__main__":
    main()
