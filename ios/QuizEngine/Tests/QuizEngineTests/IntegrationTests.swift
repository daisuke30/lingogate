import XCTest
@testable import QuizEngine

/// End-to-end: build a 10-question gate from the real lingogate.db, run it to
/// completion (with one deliberate miss + re-queue), and verify the FSRS state
/// and GateSession record persisted correctly.
final class IntegrationTests: XCTestCase {
    func testFullTenQuestionGateSessionAgainstRealDB() throws {
        let (store, path) = try TestSupport.openWritableCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }

        let deck = try XCTUnwrap(try store.deck(code: TestSupport.deckCode))
        let fsrs = FSRS()
        let qb = QuestionBuilder(store: store, deckId: deck.id)
        let sessionBuilder = GateSessionBuilder(store: store, builder: qb, direction: .en2ru, size: 10)

        var rng = SeededRNG(seed: 4242)
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        let plan = try sessionBuilder.build(deckId: deck.id, band: 1, now: now, rng: &rng)
        XCTAssertEqual(plan.count, 10)

        let controller = try GateController(
            store: store, plan: plan, fsrs: fsrs, appBundleID: "com.zhiliaoapp.musically",
            now: now
        )

        // Deliberately miss the first card once (to exercise re-queue), then
        // answer everything correctly until the gate opens.
        let target = plan.cards.first!.sentence.id
        var missed = false
        var guardCounter = 0
        while let q = controller.runner.currentQuestion {
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100, "session should terminate")
            now = now.addingTimeInterval(6) // 6s per answer → non-zero duration
            if q.sentenceId == target && !missed {
                missed = true
                _ = try controller.runner.submit(choiceIndex: (q.correctIndex + 1) % 4, now: now)
            } else {
                _ = try controller.runner.submit(choiceIndex: q.correctIndex, now: now)
            }
        }
        XCTAssertTrue(controller.runner.isComplete)
        XCTAssertEqual(controller.runner.firstTryCorrect, 9) // one missed

        try controller.finish(now: now, unlocked: true)

        // --- Verify GateSession row ---
        let gs = try store.db.prepare("""
            SELECT questions, correct, unlocked, duration_ms, app_bundle_id, ended_at
            FROM GateSession WHERE id = ?1
            """)
        gs.bind(1, Int(controller.gateSessionID))
        XCTAssertTrue(try gs.step())
        XCTAssertEqual(gs.int(0), 10)                 // questions
        XCTAssertEqual(gs.int(1), 9)                  // correct (first-try)
        XCTAssertEqual(gs.int(2), 1)                  // unlocked
        XCTAssertGreaterThan(gs.int(3), 0)            // duration_ms
        XCTAssertEqual(gs.string(4), "com.zhiliaoapp.musically")
        XCTAssertFalse(gs.isNull(5))                  // ended_at set

        // --- Verify ReviewState persisted for all 10 cards ---
        let count = try store.db.prepare("SELECT COUNT(*) FROM ReviewState WHERE direction = 'en2ru'")
        XCTAssertTrue(try count.step())
        XCTAssertEqual(count.int(0), 10)

        // Re-open the DB from disk and confirm the missed card round-trips with a
        // scheduled due date.
        let reopened = try ContentStore(path: path, readonly: true)
        let rs = try XCTUnwrap(try reopened.reviewState(sentenceId: target, direction: .en2ru))
        XCTAssertNotNil(rs.due)
        XCTAssertNotNil(rs.stability)
        XCTAssertGreaterThan(rs.due!, Date(timeIntervalSince1970: 1_700_000_000))
    }

    func testDBOpenInstallIfNeededIsIdempotent() throws {
        // DBOpen copy helper: copies once, no-ops on second call, opens R/W.
        let src = try TestSupport.bundledDBURL()
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("dbopen-\(UUID().uuidString).db")
        defer { try? FileManager.default.removeItem(at: dest) }

        let first = try DBOpen.installIfNeeded(bundledAt: src, to: dest)
        XCTAssertTrue(first)                              // performed copy
        let second = try DBOpen.installIfNeeded(bundledAt: src, to: dest)
        XCTAssertFalse(second)                            // already present

        let db = try Database(path: dest.path, readonly: false)
        let st = try db.prepare("SELECT COUNT(*) FROM Sentence")
        XCTAssertTrue(try st.step())
        XCTAssertGreaterThan(st.int(0), 0)
    }
}
