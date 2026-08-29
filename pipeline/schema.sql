-- LingoGate content schema (SQLite, platform-independent)
-- Design ref: ai-org/Ideas/20260703-quiz-gate-app-design.md §5.1
--
-- Tables:
--   Deck           language pair + level system (e.g. RU-from-EN)
--   Word           lemma, frequency rank, band, part of speech, glosses
--   Sentence       ru / en / ja, band, source (generated | imported)
--   sentence_words many-to-many join between Sentence and Word
--   ReviewState    FSRS scheduling state, one row per (sentence, direction)
--   GateSession    a gate unlock event: which app, #questions, accuracy, duration
--
-- All CREATEs use IF NOT EXISTS so import.py can run repeatedly (idempotent).

PRAGMA foreign_keys = ON;

-- A Deck is one language pair + level ladder. sentences/words belong to a deck.
CREATE TABLE IF NOT EXISTS Deck (
    id           INTEGER PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,      -- e.g. "RU-from-EN"
    name         TEXT NOT NULL,
    target_lang  TEXT NOT NULL,             -- language being learned, e.g. "ru"
    source_lang  TEXT NOT NULL,             -- prompt language, e.g. "en"
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per lemma. Natural key = (deck_id, lemma).
CREATE TABLE IF NOT EXISTS Word (
    id        INTEGER PRIMARY KEY,
    deck_id   INTEGER NOT NULL REFERENCES Deck(id) ON DELETE CASCADE,
    lemma     TEXT NOT NULL,                -- dictionary form, e.g. "делать"
    rank      INTEGER,                      -- frequency rank (1 = most frequent)
    band      INTEGER NOT NULL,             -- 1 = ranks 1-1000, 2 = 1001-2000, ...
    pos       TEXT NOT NULL,                -- part of speech (see README for tagset)
    en_gloss  TEXT,
    ja_gloss  TEXT,
    -- LINGO-012 (card-back word breakdown). Verb aspect; NULL for non-verbs and
    -- for verbs without a true telic partner (быть, мочь, ...). aspect_pair is
    -- free text (the paired lemma need not itself be a Word row). Also added
    -- via idempotent ALTER in import.py:ensure_migrations.
    aspect      TEXT,                       -- 'pf' | 'impf' | NULL
    aspect_pair TEXT,                       -- paired verb's lemma, or NULL
    -- LINGO-022 (card-back word breakdown). Grammatical gender for nouns:
    -- 'm'|'f'|'n' singular genders, 'pl' pluralia tantum (деньги/ножницы),
    -- 'mf' common gender (коллега/судья). NULL for non-nouns. Also added via
    -- idempotent ALTER in import.py:ensure_migrations.
    gender      TEXT,                       -- 'm'|'f'|'n'|'pl'|'mf' | NULL
    UNIQUE (deck_id, lemma)
);

CREATE INDEX IF NOT EXISTS idx_word_band ON Word(deck_id, band);
CREATE INDEX IF NOT EXISTS idx_word_pos  ON Word(deck_id, band, pos);

-- One example sentence. `id` is a stable string key supplied by the JSONL
-- (e.g. "s0001") so ReviewState survives re-imports.
CREATE TABLE IF NOT EXISTS Sentence (
    id          TEXT PRIMARY KEY,
    deck_id     INTEGER NOT NULL REFERENCES Deck(id) ON DELETE CASCADE,
    ru          TEXT NOT NULL,
    en          TEXT NOT NULL,
    ja          TEXT,
    band        INTEGER NOT NULL,
    difficulty  INTEGER NOT NULL DEFAULT 1, -- 1 easy .. 3 harder (word count / grammar)
    source      TEXT NOT NULL DEFAULT 'generated', -- generated | imported
    -- LINGO-009 (handwritten-note import). Also added via idempotent ALTER in
    -- import.py:ensure_migrations for DBs created before this column existed.
    kind        TEXT NOT NULL DEFAULT 'sentence', -- 'sentence' | 'word' (vocab flashcard)
    kana        TEXT,                       -- katakana pronunciation, best-effort, may be NULL
    note        TEXT,                       -- etymology / grammar note the author wrote
    -- LINGO-011 (target-word-driven sentences). The single band-vocab lemma this
    -- sentence is built to teach; the quiz picks it via target_lemma. NULL for
    -- pre-LINGO-011 rows. Also added via idempotent ALTER in ensure_migrations.
    target_lemma TEXT
);

CREATE INDEX IF NOT EXISTS idx_sentence_band ON Sentence(deck_id, band);

-- Many-to-many: which band-vocab lemmas a sentence covers.
CREATE TABLE IF NOT EXISTS sentence_words (
    sentence_id TEXT    NOT NULL REFERENCES Sentence(id) ON DELETE CASCADE,
    word_id     INTEGER NOT NULL REFERENCES Word(id)     ON DELETE CASCADE,
    PRIMARY KEY (sentence_id, word_id)
);

CREATE INDEX IF NOT EXISTS idx_sw_word ON sentence_words(word_id);

-- FSRS scheduling state. One row per sentence per study direction.
-- direction e.g. "en2ru". FSRS fields per the FSRS-4.5/5 model.
CREATE TABLE IF NOT EXISTS ReviewState (
    id          INTEGER PRIMARY KEY,
    sentence_id TEXT NOT NULL REFERENCES Sentence(id) ON DELETE CASCADE,
    direction   TEXT NOT NULL DEFAULT 'en2ru',
    stability   REAL,                       -- FSRS S (days)
    difficulty  REAL,                       -- FSRS D (1..10)
    due_at      TEXT,                        -- ISO datetime the card is next due
    reps        INTEGER NOT NULL DEFAULT 0,  -- total successful reviews
    lapses      INTEGER NOT NULL DEFAULT 0,  -- times forgotten
    last_review TEXT,                        -- ISO datetime of last review
    state       INTEGER NOT NULL DEFAULT 0,  -- 0 New,1 Learning,2 Review,3 Relearning
    UNIQUE (sentence_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_review_due ON ReviewState(direction, due_at);

-- A single gate unlock event, for stats and the "forcing function" record.
CREATE TABLE IF NOT EXISTS GateSession (
    id             INTEGER PRIMARY KEY,
    started_at     TEXT NOT NULL,
    ended_at       TEXT,
    app_bundle_id  TEXT,                      -- which app was being unblocked
    questions      INTEGER NOT NULL DEFAULT 0,
    correct        INTEGER NOT NULL DEFAULT 0,
    duration_ms    INTEGER,                   -- time spent answering
    unlocked       INTEGER NOT NULL DEFAULT 0  -- 0/1 did the gate open
);
