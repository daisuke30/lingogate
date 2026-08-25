import XCTest
@testable import QuizEngine

/// QA (LINGO-006) additions: edge cases the LINGO-004 suite did not cover —
/// review overflow priority, new-card exhaustion, and degraded/empty DBs.
final class RobustnessTests: XCTestCase {
    var store: ContentStore!
    var path: String!
    var deckId: Int!
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let day: TimeInterval = 86_400

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

    /// All band-1 sentence ids in the fixture, ordered by id.
    private func band1SentenceIDs() throws -> [String] {
        let st = try store.db.prepare(
            "SELECT id FROM Sentence WHERE deck_id = ?1 AND band = 1 ORDER BY id ASC")
        st.bind(1, deckId)
        var ids: [String] = []
        while try st.step() { ids.append(st.string(0)) }
        return ids
    }

    private func markReviewed(_ id: String, due: Date, reps: Int = 3, lapses: Int = 0) throws {
        try store.upsert(ReviewState(
            sentenceId: id, direction: .en2ru, stability: 5, difficulty: 5, due: due,
            reps: reps, lapses: lapses, lastReview: due.addingTimeInterval(-5 * day),
            state: .review))
    }

    // 1. More than 10 due reviews: the session must take the 10 MOST overdue
    // (due-asc), and must NOT dilute the session with new cards.
    func testManyDueReviewsCappedAtTenMostOverdue() throws {
        let ids = Array(try band1SentenceIDs().prefix(15))
        XCTAssertEqual(ids.count, 15, "fixture should have ≥15 band-1 sentences")
        // ids[0] most overdue (−15d) … ids[14] least overdue (−1d).
        for (i, id) in ids.enumerated() {
            try markReviewed(id, due: now.addingTimeInterval(-Double(15 - i) * day))
        }
        var rng = SeededRNG(seed: 1)
        let plan = try makeBuilder().build(deckId: deckId, band: 1, now: now, rng: &rng)

        XCTAssertEqual(plan.count, 10)
        XCTAssertTrue(plan.cards.allSatisfy { $0.isReview }, "no new cards should leak in while 15 are due")
        // The 10 most overdue, most-overdue first.
        XCTAssertEqual(plan.cards.map { $0.sentence.id }, Array(ids.prefix(10)))
        // Least-overdue 5 were correctly left out.
        let picked = Set(plan.cards.map { $0.sentence.id })
        XCTAssertTrue(ids.suffix(5).allSatisfy { !picked.contains($0) })
    }

    // 2. New-card exhaustion: every band-1 sentence already studied (none due).
    // Session must still assemble 10 distinct cards from upcoming reviews and
    // run to completion — never a short/empty gate that can't be opened.
    func testNewCardDepletionStillFillsAndCompletes() throws {
        let ids = try band1SentenceIDs()
        XCTAssertGreaterThan(ids.count, 10)
        for (i, id) in ids.enumerated() {
            // All due in the future → nothing is "due", no new cards remain.
            try markReviewed(id, due: now.addingTimeInterval(Double(i + 1) * day))
        }
        var rng = SeededRNG(seed: 7)
        let plan = try makeBuilder().build(deckId: deckId, band: 1, now: now, rng: &rng)

        XCTAssertEqual(plan.count, 10, "must top up to 10 from upcoming reviews when new cards are exhausted")
        XCTAssertEqual(Set(plan.cards.map { $0.sentence.id }).count, 10, "no duplicate cards")
        XCTAssertTrue(plan.cards.allSatisfy { $0.isReview })

        // The gate must actually be completable (all-correct opens it).
        let controller = try GateController(
            store: store, plan: plan, fsrs: FSRS(), appBundleID: nil, now: now)
        var guardCounter = 0
        while let q = controller.runner.currentQuestion {
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100)
            _ = try controller.runner.submit(choiceIndex: q.correctIndex, now: now)
        }
        XCTAssertTrue(controller.runner.isComplete)
        XCTAssertEqual(controller.runner.firstTryCorrect, 10)
    }

    // 3a. Empty content DB (schema present, no sentences): the builder must
    // return an empty plan and the controller must degrade gracefully — an
    // immediately-complete session, no crash, GateSession row still written.
    func testEmptyContentDBProducesEmptyPlanAndCompletesImmediately() throws {
        try store.db.execute("DELETE FROM sentence_words; DELETE FROM ReviewState; DELETE FROM Sentence;")
        var rng = SeededRNG(seed: 1)
        let plan = try makeBuilder().build(deckId: deckId, band: 1, now: now, rng: &rng)
        XCTAssertEqual(plan.count, 0)

        let controller = try GateController(
            store: store, plan: plan, fsrs: FSRS(), appBundleID: nil, now: now)
        XCTAssertNil(controller.runner.currentQuestion)
        XCTAssertTrue(controller.runner.isComplete)
        // Submitting into an empty session is safe and reports completion.
        let r = try controller.runner.submit(choiceIndex: 0, now: now)
        XCTAssertTrue(r.sessionComplete)
        // finish() must not crash; it should NOT report the gate as opened.
        try controller.finish(now: now, unlocked: false)

        let gs = try store.db.prepare("SELECT questions, unlocked FROM GateSession WHERE id = ?1")
        gs.bind(1, Int(controller.gateSessionID))
        XCTAssertTrue(try gs.step())
        XCTAssertEqual(gs.int(0), 0)
        XCTAssertEqual(gs.int(1), 0)
    }

    // 3b. Corrupt DB file: opening may lazily succeed, but the first query must
    // throw a Swift error (SQLiteError) rather than trap/crash the app.
    func testCorruptDBFileThrowsRatherThanCrashing() throws {
        let junk = FileManager.default.temporaryDirectory
            .appendingPathComponent("corrupt-\(UUID().uuidString).db")
        defer { try? FileManager.default.removeItem(at: junk) }
        // Valid SQLite header magic then garbage → passes open, fails on read.
        var bytes = Array("SQLite format 3\0".utf8)
        bytes.append(contentsOf: (0..<4096).map { _ in UInt8.random(in: 0...255) })
        try Data(bytes).write(to: junk)

        let corrupt = try ContentStore(path: junk.path, readonly: true)
        XCTAssertThrowsError(try corrupt.deck(code: TestSupport.deckCode)) { error in
            XCTAssertTrue(error is SQLiteError, "expected SQLiteError, got \(error)")
        }
    }
}
