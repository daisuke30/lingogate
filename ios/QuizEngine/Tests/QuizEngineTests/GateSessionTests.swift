import XCTest
@testable import QuizEngine

/// Records every upsert so tests can assert how many times / with what grade a
/// card was written.
final class FakeWriter: ReviewWriter {
    private(set) var upserts: [ReviewState] = []
    func upsert(_ r: ReviewState) throws { upserts.append(r) }
    func count(for id: String) -> Int { upserts.filter { $0.sentenceId == id }.count }
    func last(for id: String) -> ReviewState? { upserts.last { $0.sentenceId == id } }
}

final class GateSessionRunnerTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_700_000_000)
    let fsrs = FSRS()

    /// Fabricate a plan of N cards. correctIndex is always 0; a "wrong" submit
    /// uses index 1.
    private func makePlan(_ n: Int) -> GateSessionPlan {
        let cards = (0..<n).map { i -> PlannedCard in
            let id = "s\(i)"
            let s = Sentence(id: id, deckId: 1, ru: "ru\(i)", en: "en\(i)", ja: nil,
                             band: 1, difficulty: 1, source: "generated")
            let q = Question(id: id, sentenceId: id, type: .sentenceChoice,
                             prompt: "en\(i)", subPrompt: nil,
                             options: ["ru\(i)", "x", "y", "z"], correctIndex: 0, difficulty: 1)
            return PlannedCard(sentence: s, reviewState: .new(sentenceId: id, direction: .en2ru),
                               question: q, isReview: false)
        }
        return GateSessionPlan(cards: cards, deckId: 1, band: 1, direction: .en2ru)
    }

    func testAllCorrectCompletesWithGradesPerCard() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)
        var steps = 0
        while let _ = runner.currentQuestion {
            let r = try runner.submit(choiceIndex: 0, now: t0)
            XCTAssertTrue(r.correct)
            steps += 1
        }
        XCTAssertTrue(runner.isComplete)
        XCTAssertEqual(steps, 3)
        XCTAssertEqual(runner.firstTryCorrect, 3)
        XCTAssertEqual(writer.upserts.count, 3)           // one grade per card
        for u in writer.upserts {
            XCTAssertEqual(u.state, .review)              // new + good → review
            XCTAssertEqual(u.reps, 1)
        }
    }

    func testWrongCardIsRequeuedAndGradedExactlyOnce() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)

        // s0 wrong → requeued to the back; queue becomes [s1, s2, s0].
        let r0 = try runner.submit(choiceIndex: 1, now: t0)
        XCTAssertFalse(r0.correct)
        XCTAssertTrue(r0.requeued)
        XCTAssertFalse(r0.sessionComplete)
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s1")

        XCTAssertTrue(try runner.submit(choiceIndex: 0, now: t0).correct) // s1
        XCTAssertTrue(try runner.submit(choiceIndex: 0, now: t0).correct) // s2
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s0")          // re-shown

        let done = try runner.submit(choiceIndex: 0, now: t0)             // s0 correct now
        XCTAssertTrue(done.sessionComplete)
        XCTAssertTrue(runner.isComplete)

        // s0 counts as one failure: not first-try correct, graded exactly once.
        XCTAssertEqual(runner.firstTryCorrect, 2)
        XCTAssertEqual(writer.count(for: "s0"), 1)
        XCTAssertEqual(writer.last(for: "s0")?.state, .learning)         // new + again
    }

    func testRepeatedWrongDoesNotDoubleGrade() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(1), fsrs: fsrs, writer: writer)
        _ = try runner.submit(choiceIndex: 1, now: t0)   // wrong (graded once)
        _ = try runner.submit(choiceIndex: 1, now: t0)   // wrong again (no grade)
        _ = try runner.submit(choiceIndex: 1, now: t0)   // wrong again (no grade)
        XCTAssertFalse(runner.isComplete)
        let done = try runner.submit(choiceIndex: 0, now: t0) // finally correct
        XCTAssertTrue(done.sessionComplete)
        XCTAssertEqual(writer.count(for: "s0"), 1)        // graded exactly once
        XCTAssertEqual(runner.firstTryCorrect, 0)
    }

    func testEasyMapperFlowsThroughToFSRS() throws {
        let writer = FakeWriter()
        let mapper = RatingMapper(enableEasyPromotion: true, fastThreshold: 3.0)
        let runner = GateSessionRunner(plan: makePlan(1), fsrs: fsrs, writer: writer, mapper: mapper)
        _ = try runner.submit(choiceIndex: 0, now: t0, responseTime: 1.0) // fast correct → easy
        let s = try XCTUnwrap(writer.last(for: "s0"))
        // Easy initial stability is w[3], larger than Good's w[2].
        XCTAssertEqual(s.stability!, FSRSParameters.defaultV45.w[3], accuracy: 1e-9)
    }
}

final class GateSessionBuilderTests: XCTestCase {
    var store: ContentStore!
    var path: String!
    var deckId: Int!
    let now = Date(timeIntervalSince1970: 1_700_000_000)

    override func setUpWithError() throws {
        let opened = try TestSupport.openWritableCopy()
        store = opened.store; path = opened.path
        deckId = try XCTUnwrap(try store.deck(code: TestSupport.deckCode)).id
    }
    override func tearDownWithError() throws {
        store = nil
        if let p = path { try? FileManager.default.removeItem(atPath: p) }
    }

    private func makeBuilder() -> GateSessionBuilder {
        let qb = QuestionBuilder(store: store, deckId: deckId)
        return GateSessionBuilder(store: store, builder: qb, direction: .en2ru, size: 10)
    }

    func testFreshDeckFillsTenNewDistinctCards() throws {
        var rng = SeededRNG(seed: 1)
        let plan = try makeBuilder().build(deckId: deckId, band: 1, now: now, rng: &rng)
        XCTAssertEqual(plan.count, 10)
        XCTAssertEqual(Set(plan.cards.map { $0.sentence.id }).count, 10)
        XCTAssertTrue(plan.cards.allSatisfy { !$0.isReview })  // nothing due yet
    }

    func testDueReviewsComeFirstInDueOrder() throws {
        // Seed three past-due review cards with distinct due times.
        let due = ["s050": now.addingTimeInterval(-3 * 86400),
                   "s020": now.addingTimeInterval(-1 * 86400),
                   "s030": now.addingTimeInterval(-2 * 86400)]
        for (id, d) in due {
            try store.upsert(ReviewState(sentenceId: id, direction: .en2ru,
                                         stability: 5, difficulty: 5, due: d,
                                         reps: 3, lapses: 0,
                                         lastReview: d.addingTimeInterval(-5 * 86400),
                                         state: .review))
        }
        var rng = SeededRNG(seed: 1)
        let plan = try makeBuilder().build(deckId: deckId, band: 1, now: now, rng: &rng)
        XCTAssertEqual(plan.count, 10)
        // First three are the due cards, most overdue first: s050, s030, s020.
        XCTAssertEqual(Array(plan.cards.prefix(3)).map { $0.sentence.id }, ["s050", "s030", "s020"])
        XCTAssertTrue(plan.cards.prefix(3).allSatisfy { $0.isReview })
        XCTAssertTrue(plan.cards.suffix(7).allSatisfy { !$0.isReview })
    }

    func testReproducibleWithSameSeed() throws {
        var a = SeededRNG(seed: 77); var b = SeededRNG(seed: 77)
        let pa = try makeBuilder().build(deckId: deckId, band: 1, now: now, rng: &a)
        let pb = try makeBuilder().build(deckId: deckId, band: 1, now: now, rng: &b)
        XCTAssertEqual(pa.cards.map { $0.sentence.id }, pb.cards.map { $0.sentence.id })
        XCTAssertEqual(pa.cards.map { $0.question.options }, pb.cards.map { $0.question.options })
    }
}
