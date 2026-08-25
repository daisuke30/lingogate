import Foundation

/// Persistence seam for review updates. `ContentStore` conforms; tests use an
/// in-memory fake to exercise the runner without a database.
public protocol ReviewWriter: AnyObject {
    func upsert(_ r: ReviewState) throws
}

extension ContentStore: ReviewWriter {}

/// One selected card in a gate session: the sentence, its current review state
/// (a fresh `.new` state if never studied), the rendered question, and whether
/// it was pulled as a due review or a new card.
public struct PlannedCard: Sendable {
    public let sentence: Sentence
    public var reviewState: ReviewState
    public let question: Question
    public let isReview: Bool
}

/// The assembled 10-question gate, in presentation order (due reviews first,
/// then new-card fill).
public struct GateSessionPlan: Sendable {
    public let cards: [PlannedCard]
    public let deckId: Int
    public let band: Int
    public let direction: StudyDirection
    public var count: Int { cards.count }
}

/// Assembles a gate session per design §5.3:
///  1. due reviews first (most overdue first),
///  2. fill the rest with current-band new cards (frequency-priority order),
///  3. if still short, top up with the soonest upcoming reviews.
public struct GateSessionBuilder {
    public let store: ContentStore
    public let builder: QuestionBuilder
    public let direction: StudyDirection
    public var size: Int

    public init(
        store: ContentStore,
        builder: QuestionBuilder,
        direction: StudyDirection = .en2ru,
        size: Int = 10
    ) {
        self.store = store
        self.builder = builder
        self.direction = direction
        self.size = size
    }

    public func build(deckId: Int, band: Int, now: Date, rng: inout SeededRNG) throws -> GateSessionPlan {
        var cards: [PlannedCard] = []
        var used: Set<String> = []

        func append(_ sentence: Sentence, state: ReviewState, isReview: Bool) throws {
            let q = try builder.build(for: sentence, rng: &rng)
            cards.append(PlannedCard(sentence: sentence, reviewState: state,
                                     question: q, isReview: isReview))
            used.insert(sentence.id)
        }

        // 1. Due reviews (already ordered by due asc).
        for (state, sentence) in try store.dueReviews(
            deckId: deckId, band: band, direction: direction, now: now, limit: size
        ) {
            if cards.count >= size { break }
            try append(sentence, state: state, isReview: true)
        }

        // 2. New-card fill (frequency priority).
        if cards.count < size {
            let need = size - cards.count
            for sentence in try store.newSentences(
                deckId: deckId, band: band, direction: direction, excluding: used, limit: need
            ) {
                if cards.count >= size { break }
                let fresh = ReviewState.new(sentenceId: sentence.id, direction: direction)
                try append(sentence, state: fresh, isReview: false)
            }
        }

        // 3. Top up with upcoming (not-yet-due) reviews if the deck is small.
        if cards.count < size {
            for (state, sentence) in try store.upcomingReviews(
                deckId: deckId, band: band, direction: direction, now: now,
                excluding: used, limit: size - cards.count
            ) {
                if cards.count >= size { break }
                try append(sentence, state: state, isReview: true)
            }
        }

        return GateSessionPlan(cards: cards, deckId: deckId, band: band, direction: direction)
    }
}

// MARK: - Runner

public struct SubmitResult: Sendable, Equatable {
    public let correct: Bool
    /// True if the card was wrong and pushed to the back of the queue.
    public let requeued: Bool
    /// True once every card has been finally answered correctly.
    public let sessionComplete: Bool
}

/// Drives a gate session at runtime: presents the head question, grades answers
/// through FSRS exactly once per card (on first resolution), re-queues wrong
/// cards to the end, and completes only when all cards are finally correct.
///
/// FSRS grading rule: a card is graded once. Correct-on-first-try → `.good`
/// (or `.easy` if the mapper promotes a fast answer). First wrong → `.again`
/// (lapse recorded immediately); the card is then re-shown until correct but is
/// NOT graded again, so a re-tried card counts as exactly one failure.
public final class GateSessionRunner {
    private final class RuntimeCard {
        let sentenceId: String
        let sentence: Sentence
        let question: Question
        var reviewState: ReviewState
        var graded = false
        var everWrong = false
        init(sentenceId: String, sentence: Sentence, question: Question, reviewState: ReviewState) {
            self.sentenceId = sentenceId
            self.sentence = sentence
            self.question = question
            self.reviewState = reviewState
        }
    }

    /// Snapshot needed to undo exactly one `submitRating` call (LINGO-007).
    /// Single-slot by design: the flashcard UI only ever offers to undo the
    /// immediately preceding card, never a deeper history.
    private struct RatingUndoRecord {
        let queueSnapshot: [RuntimeCard]
        let card: RuntimeCard
        let priorGraded: Bool
        let priorEverWrong: Bool
        let priorReviewState: ReviewState
        let priorFirstTryCorrect: Int
        let priorTotalAnswers: Int
        /// Whether this submitRating call appended to `pendingRatingUpserts`
        /// (true only on a card's first-ever grading), so undo knows whether
        /// to pop the buffer.
        let pendingAppended: Bool
    }

    private var queue: [RuntimeCard]
    public let totalCards: Int
    private let fsrs: FSRS
    private let writer: ReviewWriter
    private let mapper: RatingMapper

    public private(set) var firstTryCorrect = 0
    public private(set) var totalAnswers = 0

    /// FSRS-graded states from the flashcard (rating) path, buffered in memory
    /// and written to `writer` only via `commitPendingRatingUpserts()` — called
    /// by `GateController.finish` at session completion. This is what makes
    /// undo cheap (a pure in-memory revert, no compensating DB write) and is
    /// the "buffer during the session, commit once at the end" design from
    /// LINGO-007. The choice-based `submit(choiceIndex:...)` path is untouched
    /// and keeps writing immediately (existing, tested behaviour).
    private var pendingRatingUpserts: [ReviewState] = []
    private var lastRatingUndo: RatingUndoRecord?

    public init(plan: GateSessionPlan, fsrs: FSRS, writer: ReviewWriter,
                mapper: RatingMapper = RatingMapper()) {
        self.queue = plan.cards.map {
            RuntimeCard(sentenceId: $0.sentence.id, sentence: $0.sentence,
                        question: $0.question, reviewState: $0.reviewState)
        }
        self.totalCards = plan.cards.count
        self.fsrs = fsrs
        self.writer = writer
        self.mapper = mapper
    }

    /// The question currently facing the learner, or nil when the session is done.
    public var currentQuestion: Question? { queue.first?.question }

    /// The sentence behind the current card (EN/RU/JA), for the flashcard UI's
    /// front/back rendering. Same head card as `currentQuestion`.
    public var currentSentence: Sentence? { queue.first?.sentence }

    public var isComplete: Bool { queue.isEmpty }

    /// Number of cards finally resolved.
    public var resolvedCount: Int { totalCards - remainingDistinct }

    private var remainingDistinct: Int { Set(queue.map(\.sentenceId)).count }

    /// Submit an answer for the current (head) question.
    @discardableResult
    public func submit(choiceIndex: Int, now: Date, responseTime: TimeInterval? = nil) throws -> SubmitResult {
        guard let card = queue.first else {
            return SubmitResult(correct: false, requeued: false, sessionComplete: true)
        }
        totalAnswers += 1
        let correct = (choiceIndex == card.question.correctIndex)

        if !card.graded {
            // First resolution of this card: grade it once through FSRS.
            let rating = mapper.rating(correct: correct, responseTime: responseTime)
            card.reviewState = fsrs.review(card.reviewState, rating: rating, now: now)
            try writer.upsert(card.reviewState)
            card.graded = true
            if correct {
                firstTryCorrect += 1
                queue.removeFirst()
            } else {
                card.everWrong = true
                requeue(card)
            }
        } else {
            // Re-shown after an earlier miss: no re-grading.
            if correct {
                queue.removeFirst()
            } else {
                requeue(card)
            }
        }

        return SubmitResult(correct: correct, requeued: !correct, sessionComplete: queue.isEmpty)
    }

    private func requeue(_ card: RuntimeCard) {
        queue.removeFirst()
        queue.append(card)
    }

    // MARK: - Rating path (flashcard UI, LINGO-007)

    public struct RatingSubmitResult: Sendable, Equatable {
        public let rating: Rating
        /// True if the card was graded Again and pushed to the back of the queue.
        public let requeued: Bool
        /// True once every card has been finally rated non-Again.
        public let sessionComplete: Bool
    }

    /// Submit a direct self-assessed FSRS rating for the current (head) card —
    /// the flashcard flip-and-flick UI's counterpart to `submit(choiceIndex:...)`.
    /// No `RatingMapper` involved: the learner's Again/Hard/Good/Easy judgement
    /// goes straight to FSRS, which is the whole point of the flashcard format
    /// (more signal than a 2-valued correct/incorrect).
    ///
    /// Same "graded exactly once" rule as the choice path: a card's first
    /// resolution grades it through FSRS (buffered, not written yet); `.again`
    /// re-queues it to the end for another look, anything else finalises it.
    /// A re-shown card (already graded) is never re-graded — only `.again`
    /// vs. not decides whether it goes around again.
    @discardableResult
    public func submitRating(_ rating: Rating, now: Date) throws -> RatingSubmitResult {
        guard let card = queue.first else {
            return RatingSubmitResult(rating: rating, requeued: false, sessionComplete: true)
        }

        // Snapshot everything this call might mutate, for single-level undo.
        let priorQueue = queue
        let priorGraded = card.graded
        let priorEverWrong = card.everWrong
        let priorReviewState = card.reviewState
        let priorFirstTryCorrect = firstTryCorrect
        let priorTotalAnswers = totalAnswers
        var pendingAppended = false

        totalAnswers += 1
        let isAgain = (rating == .again)

        if !card.graded {
            let graded = fsrs.review(card.reviewState, rating: rating, now: now)
            card.reviewState = graded
            pendingRatingUpserts.append(graded)
            pendingAppended = true
            card.graded = true
            if isAgain {
                card.everWrong = true
                requeue(card)
            } else {
                firstTryCorrect += 1
                queue.removeFirst()
            }
        } else {
            if isAgain {
                requeue(card)
            } else {
                queue.removeFirst()
            }
        }

        lastRatingUndo = RatingUndoRecord(
            queueSnapshot: priorQueue, card: card,
            priorGraded: priorGraded, priorEverWrong: priorEverWrong,
            priorReviewState: priorReviewState,
            priorFirstTryCorrect: priorFirstTryCorrect, priorTotalAnswers: priorTotalAnswers,
            pendingAppended: pendingAppended
        )

        return RatingSubmitResult(rating: rating, requeued: isAgain, sessionComplete: queue.isEmpty)
    }

    /// Whether the immediately preceding `submitRating` call can be undone.
    public var canUndo: Bool { lastRatingUndo != nil }

    /// Revert the immediately preceding `submitRating` call: restores queue
    /// order, the card's grade/reviewState, the running counters, and drops
    /// its buffered write if one was made. Only one level deep (by design —
    /// see `RatingUndoRecord`). Returns false if there is nothing to undo.
    @discardableResult
    public func undoLastRating() -> Bool {
        guard let u = lastRatingUndo else { return false }
        queue = u.queueSnapshot
        u.card.graded = u.priorGraded
        u.card.everWrong = u.priorEverWrong
        u.card.reviewState = u.priorReviewState
        firstTryCorrect = u.priorFirstTryCorrect
        totalAnswers = u.priorTotalAnswers
        if u.pendingAppended, !pendingRatingUpserts.isEmpty {
            pendingRatingUpserts.removeLast()
        }
        lastRatingUndo = nil
        return true
    }

    /// Number of buffered-but-not-yet-committed rating grades. Exposed mainly
    /// for tests asserting the "buffer during the session, commit once" rule.
    public var pendingRatingUpsertCount: Int { pendingRatingUpserts.count }

    /// Write every buffered rating-path grade to `writer`, then clear the
    /// buffer. Called once by `GateController.finish` at session completion.
    /// A no-op for sessions driven entirely through `submit(choiceIndex:...)`,
    /// which still writes immediately and never populates this buffer.
    public func commitPendingRatingUpserts() throws {
        for state in pendingRatingUpserts {
            try writer.upsert(state)
        }
        pendingRatingUpserts.removeAll()
    }
}

// MARK: - Controller (ties in the GateSession record)

/// Convenience orchestrator: builds a plan, writes the GateSession start row,
/// exposes a runner, and finalises the row on completion. UI code (LINGO-005)
/// drives `runner.submit(...)` and calls `finish(...)` when the gate opens.
public final class GateController {
    public let store: ContentStore
    public let runner: GateSessionRunner
    public let plan: GateSessionPlan
    private let sessionRowID: Int64
    private let startedAt: Date

    public init(
        store: ContentStore,
        plan: GateSessionPlan,
        fsrs: FSRS,
        mapper: RatingMapper = RatingMapper(),
        appBundleID: String?,
        now: Date
    ) throws {
        self.store = store
        self.plan = plan
        self.startedAt = now
        self.sessionRowID = try store.startGateSession(startedAt: now, appBundleID: appBundleID)
        self.runner = GateSessionRunner(plan: plan, fsrs: fsrs, writer: store, mapper: mapper)
    }

    public var gateSessionID: Int64 { sessionRowID }

    /// Finalise the GateSession row. `unlocked` should be true when the gate was
    /// completed (all questions correct) and the target app is being unblocked.
    ///
    /// Commits any buffered flashcard-path (rating) grades first — a no-op for
    /// a choice-based (strict/4択) session, which already wrote as it went.
    public func finish(now: Date, unlocked: Bool) throws {
        try runner.commitPendingRatingUpserts()
        let durationMs = Int(max(0, now.timeIntervalSince(startedAt)) * 1000)
        try store.finishGateSession(
            id: sessionRowID, endedAt: now,
            questions: plan.count, correct: runner.firstTryCorrect,
            durationMs: durationMs, unlocked: unlocked
        )
    }
}
