import Foundation

/// Read/write access to the LINGO-001 content DB. Owns all SQL; the rest of
/// QuizEngine works with plain Swift models. Reads Deck/Word/Sentence, reads and
/// writes ReviewState and GateSession.
public final class ContentStore {
    public let db: Database

    public init(db: Database) {
        self.db = db
    }

    public convenience init(path: String, readonly: Bool = false) throws {
        try self.init(db: Database(path: path, readonly: readonly))
    }

    // MARK: - Deck / Sentence / Word reads

    public func deck(code: String) throws -> Deck? {
        let st = try db.prepare(
            "SELECT id, code, name, target_lang, source_lang FROM Deck WHERE code = ?1"
        )
        st.bind(1, code)
        guard try st.step() else { return nil }
        return Deck(id: st.int(0), code: st.string(1), name: st.string(2),
                    targetLang: st.string(3), sourceLang: st.string(4))
    }

    private func sentence(from st: Statement) -> Sentence {
        Sentence(id: st.string(0), deckId: st.int(1), ru: st.string(2), en: st.string(3),
                 ja: st.stringOptional(4), band: st.int(5), difficulty: st.int(6),
                 source: st.string(7))
    }

    private static let sentenceCols =
        "id, deck_id, ru, en, ja, band, difficulty, source"

    public func sentence(id: String) throws -> Sentence? {
        let st = try db.prepare(
            "SELECT \(Self.sentenceCols) FROM Sentence WHERE id = ?1"
        )
        st.bind(1, id)
        guard try st.step() else { return nil }
        return sentence(from: st)
    }

    /// Band-vocab words covered by a sentence (via sentence_words).
    public func words(forSentence sentenceId: String) throws -> [Word] {
        let st = try db.prepare("""
            SELECT w.id, w.lemma, w.rank, w.band, w.pos, w.en_gloss, w.ja_gloss
            FROM sentence_words sw
            JOIN Word w ON w.id = sw.word_id
            WHERE sw.sentence_id = ?1
            ORDER BY w.rank
            """)
        st.bind(1, sentenceId)
        var out: [Word] = []
        while try st.step() {
            out.append(Word(id: st.int(0), lemma: st.string(1), rank: st.intOptional(2),
                            band: st.int(3), pos: st.string(4),
                            enGloss: st.stringOptional(5), jaGloss: st.stringOptional(6)))
        }
        return out
    }

    /// The set of Word ids a sentence covers (for lemma-overlap heuristics).
    public func wordIDs(forSentence sentenceId: String) throws -> Set<Int> {
        let st = try db.prepare(
            "SELECT word_id FROM sentence_words WHERE sentence_id = ?1"
        )
        st.bind(1, sentenceId)
        var out: Set<Int> = []
        while try st.step() { out.insert(st.int(0)) }
        return out
    }

    // MARK: - ReviewState

    private static let reviewCols =
        "sentence_id, direction, stability, difficulty, due_at, reps, lapses, last_review, state"

    private func reviewState(from st: Statement) -> ReviewState {
        ReviewState(
            sentenceId: st.string(0),
            direction: StudyDirection(rawValue: st.string(1)),
            stability: st.doubleOptional(2),
            difficulty: st.doubleOptional(3),
            due: SQLDate.date(from: st.stringOptional(4)),
            reps: st.int(5),
            lapses: st.int(6),
            lastReview: SQLDate.date(from: st.stringOptional(7)),
            state: CardState(rawValue: st.int(8)) ?? .new
        )
    }

    public func reviewState(sentenceId: String, direction: StudyDirection) throws -> ReviewState? {
        let st = try db.prepare(
            "SELECT \(Self.reviewCols) FROM ReviewState WHERE sentence_id = ?1 AND direction = ?2"
        )
        st.bind(1, sentenceId).bind(2, direction.rawValue)
        guard try st.step() else { return nil }
        return reviewState(from: st)
    }

    /// Insert or update the ReviewState row for a (sentence, direction).
    public func upsert(_ r: ReviewState) throws {
        let st = try db.prepare("""
            INSERT INTO ReviewState
                (sentence_id, direction, stability, difficulty, due_at, reps, lapses, last_review, state)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(sentence_id, direction) DO UPDATE SET
                stability   = excluded.stability,
                difficulty  = excluded.difficulty,
                due_at      = excluded.due_at,
                reps        = excluded.reps,
                lapses      = excluded.lapses,
                last_review = excluded.last_review,
                state       = excluded.state
            """)
        st.bind(1, r.sentenceId)
          .bind(2, r.direction.rawValue)
          .bind(3, r.stability)
          .bind(4, r.difficulty)
          .bind(5, r.due.map(SQLDate.string(from:)))
          .bind(6, r.reps)
          .bind(7, r.lapses)
          .bind(8, r.lastReview.map(SQLDate.string(from:)))
          .bind(9, r.state.rawValue)
        _ = try st.step()
    }

    /// Due review cards for a deck+band+direction: state != new and due_at <= now,
    /// ordered by due_at ascending (most overdue first). Returns (state, sentence).
    public func dueReviews(
        deckId: Int, band: Int, direction: StudyDirection, now: Date, limit: Int
    ) throws -> [(ReviewState, Sentence)] {
        let st = try db.prepare("""
            SELECT \(Self.reviewCols.split(separator: ",").map { "r.\($0.trimmingCharacters(in: .whitespaces))" }.joined(separator: ", ")),
                   \(Self.sentenceCols.split(separator: ",").map { "s.\($0.trimmingCharacters(in: .whitespaces))" }.joined(separator: ", "))
            FROM ReviewState r
            JOIN Sentence s ON s.id = r.sentence_id
            WHERE r.direction = ?1 AND s.deck_id = ?2 AND s.band = ?3
              AND r.state != 0 AND r.due_at IS NOT NULL AND r.due_at <= ?4
            ORDER BY r.due_at ASC
            LIMIT ?5
            """)
        st.bind(1, direction.rawValue).bind(2, deckId).bind(3, band)
          .bind(4, SQLDate.string(from: now)).bind(5, limit)
        return try collectReviewSentence(st)
    }

    /// Not-yet-due review cards, earliest due first — used only to top up a
    /// session when there aren't enough due cards + new cards to reach 10.
    public func upcomingReviews(
        deckId: Int, band: Int, direction: StudyDirection, now: Date,
        excluding: Set<String>, limit: Int
    ) throws -> [(ReviewState, Sentence)] {
        let st = try db.prepare("""
            SELECT \(Self.reviewCols.split(separator: ",").map { "r.\($0.trimmingCharacters(in: .whitespaces))" }.joined(separator: ", ")),
                   \(Self.sentenceCols.split(separator: ",").map { "s.\($0.trimmingCharacters(in: .whitespaces))" }.joined(separator: ", "))
            FROM ReviewState r
            JOIN Sentence s ON s.id = r.sentence_id
            WHERE r.direction = ?1 AND s.deck_id = ?2 AND s.band = ?3 AND r.state != 0
            ORDER BY (r.due_at IS NULL), r.due_at ASC
            LIMIT ?4
            """)
        st.bind(1, direction.rawValue).bind(2, deckId).bind(3, band).bind(4, limit + excluding.count)
        return try collectReviewSentence(st).filter { !excluding.contains($0.1.id) }
    }

    private func collectReviewSentence(_ st: Statement) throws -> [(ReviewState, Sentence)] {
        var out: [(ReviewState, Sentence)] = []
        while try st.step() {
            let r = reviewState(from: st)
            let s = Sentence(
                id: st.string(9), deckId: st.int(10), ru: st.string(11), en: st.string(12),
                ja: st.stringOptional(13), band: st.int(14), difficulty: st.int(15),
                source: st.string(16)
            )
            out.append((r, s))
        }
        return out
    }

    /// New (never-studied) sentences for a band, ordered so the sentence teaching
    /// the most frequent not-yet-covered word comes first (min covered rank asc).
    /// Sentences already selected this session can be excluded.
    public func newSentences(
        deckId: Int, band: Int, direction: StudyDirection, excluding: Set<String>, limit: Int
    ) throws -> [Sentence] {
        let st = try db.prepare("""
            SELECT \(Self.sentenceCols.split(separator: ",").map { "s.\($0.trimmingCharacters(in: .whitespaces))" }.joined(separator: ", ")),
                   MIN(w.rank) AS min_rank
            FROM Sentence s
            LEFT JOIN ReviewState r
                   ON r.sentence_id = s.id AND r.direction = ?1
            LEFT JOIN sentence_words sw ON sw.sentence_id = s.id
            LEFT JOIN Word w ON w.id = sw.word_id
            WHERE s.deck_id = ?2 AND s.band = ?3 AND r.sentence_id IS NULL
            GROUP BY s.id
            ORDER BY (min_rank IS NULL), min_rank ASC, s.id ASC
            LIMIT ?4
            """)
        st.bind(1, direction.rawValue).bind(2, deckId).bind(3, band).bind(4, limit + excluding.count)
        var out: [Sentence] = []
        while try st.step() {
            let s = sentence(from: st)
            if !excluding.contains(s.id) { out.append(s) }
            if out.count >= limit { break }
        }
        return out
    }

    // MARK: - Distractor pools

    /// Candidate sentences from the same band (excluding one id) for building
    /// whole-sentence distractors. Ordered by closeness in RU length to the
    /// target, so distractors look plausibly similar.
    public func sentenceDistractorPool(
        deckId: Int, band: Int, excluding sentenceId: String, targetLength: Int, limit: Int
    ) throws -> [Sentence] {
        let st = try db.prepare("""
            SELECT \(Self.sentenceCols) , ABS(LENGTH(ru) - ?1) AS d
            FROM Sentence
            WHERE deck_id = ?2 AND band = ?3 AND id != ?4
            ORDER BY d ASC, id ASC
            LIMIT ?5
            """)
        st.bind(1, targetLength).bind(2, deckId).bind(3, band).bind(4, sentenceId).bind(5, limit)
        var out: [Sentence] = []
        while try st.step() { out.append(sentence(from: st)) }
        return out
    }

    /// Candidate words from the same band + same POS (excluding one word id) for
    /// building cloze distractors.
    public func wordDistractorPool(
        deckId: Int, band: Int, pos: String, excluding wordId: Int, limit: Int
    ) throws -> [Word] {
        let st = try db.prepare("""
            SELECT id, lemma, rank, band, pos, en_gloss, ja_gloss
            FROM Word
            WHERE deck_id = ?1 AND band = ?2 AND pos = ?3 AND id != ?4
            ORDER BY rank ASC
            LIMIT ?5
            """)
        st.bind(1, deckId).bind(2, band).bind(3, pos).bind(4, wordId).bind(5, limit)
        var out: [Word] = []
        while try st.step() {
            out.append(Word(id: st.int(0), lemma: st.string(1), rank: st.intOptional(2),
                            band: st.int(3), pos: st.string(4),
                            enGloss: st.stringOptional(5), jaGloss: st.stringOptional(6)))
        }
        return out
    }

    // MARK: - Band promotion stats

    /// Total band words, coverable band words (appear in ≥1 band sentence), and
    /// studied band words (covered by a sentence that has a ReviewState).
    public func bandVocabStats(
        deckId: Int, band: Int, direction: StudyDirection
    ) throws -> (total: Int, coverable: Int, studied: Int) {
        let total: Int = try scalar(
            "SELECT COUNT(*) FROM Word WHERE deck_id = ?1 AND band = ?2",
            binds: { $0.bind(1, deckId).bind(2, band) })

        let coverable: Int = try scalar("""
            SELECT COUNT(DISTINCT w.id)
            FROM Word w
            JOIN sentence_words sw ON sw.word_id = w.id
            JOIN Sentence s ON s.id = sw.sentence_id AND s.band = ?2 AND s.deck_id = ?1
            WHERE w.deck_id = ?1 AND w.band = ?2
            """, binds: { $0.bind(1, deckId).bind(2, band) })

        let studied: Int = try scalar("""
            SELECT COUNT(DISTINCT w.id)
            FROM Word w
            JOIN sentence_words sw ON sw.word_id = w.id
            JOIN Sentence s ON s.id = sw.sentence_id AND s.band = ?2 AND s.deck_id = ?1
            JOIN ReviewState r ON r.sentence_id = s.id AND r.direction = ?3
            WHERE w.deck_id = ?1 AND w.band = ?2
            """, binds: { $0.bind(1, deckId).bind(2, band).bind(3, direction.rawValue) })

        return (total, coverable, studied)
    }

    /// Aggregate reps/lapses over band cards currently in the Review state, plus
    /// the number of such cards. Used as the retention proxy for promotion.
    public func bandReviewAggregate(
        deckId: Int, band: Int, direction: StudyDirection
    ) throws -> (reps: Int, lapses: Int, reviewCards: Int) {
        let st = try db.prepare("""
            SELECT COALESCE(SUM(r.reps),0), COALESCE(SUM(r.lapses),0), COUNT(*)
            FROM ReviewState r
            JOIN Sentence s ON s.id = r.sentence_id AND s.band = ?2 AND s.deck_id = ?1
            WHERE r.direction = ?3 AND r.state = 2
            """)
        st.bind(1, deckId).bind(2, band).bind(3, direction.rawValue)
        _ = try st.step()
        return (st.int(0), st.int(1), st.int(2))
    }

    private func scalar(_ sql: String, binds: (Statement) -> Void) throws -> Int {
        let st = try db.prepare(sql)
        binds(st)
        guard try st.step() else { return 0 }
        return st.int(0)
    }

    // MARK: - GateSession

    /// Insert a GateSession row at session start; returns its rowid.
    @discardableResult
    public func startGateSession(startedAt: Date, appBundleID: String?) throws -> Int64 {
        let st = try db.prepare("""
            INSERT INTO GateSession (started_at, app_bundle_id, questions, correct, unlocked)
            VALUES (?1, ?2, 0, 0, 0)
            """)
        st.bind(1, SQLDate.string(from: startedAt)).bind(2, appBundleID)
        _ = try st.step()
        return db.lastInsertRowID
    }

    /// Finalise a GateSession row when the gate completes (or is abandoned).
    public func finishGateSession(
        id: Int64, endedAt: Date, questions: Int, correct: Int, durationMs: Int, unlocked: Bool
    ) throws {
        let st = try db.prepare("""
            UPDATE GateSession
            SET ended_at = ?2, questions = ?3, correct = ?4, duration_ms = ?5, unlocked = ?6
            WHERE id = ?1
            """)
        st.bind(1, Int(id)).bind(2, SQLDate.string(from: endedAt))
          .bind(3, questions).bind(4, correct).bind(5, durationMs)
          .bind(6, unlocked ? 1 : 0)
        _ = try st.step()
    }
}
