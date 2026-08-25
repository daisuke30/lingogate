import XCTest
@testable import QuizEngine

/// LINGO-007: flashcard flow (direct self-assessed FSRS rating, buffered
/// commit, single-level undo). Mirrors the fixture style of
/// `GateSessionRunnerTests` in GateSessionTests.swift but exercises
/// `submitRating` / `undoLastRating` / `commitPendingRatingUpserts` instead of
/// the choice-based `submit(choiceIndex:...)` path, which is untouched.
final class RatingFlowTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_700_000_000)
    let fsrs = FSRS()

    /// Synthetic N-card plan. Content doesn't matter for the rating path (no
    /// options are read), only `sentence.id` identity and count.
    private func makePlan(_ n: Int) -> GateSessionPlan {
        let cards = (0..<n).map { i -> PlannedCard in
            let id = "s\(i)"
            let s = Sentence(id: id, deckId: 1, ru: "ru\(i)", en: "en\(i)", ja: "ja\(i)",
                             band: 1, difficulty: 1, source: "generated")
            let q = Question(id: id, sentenceId: id, type: .sentenceChoice,
                             prompt: "en\(i)", subPrompt: nil,
                             options: ["ru\(i)", "x", "y", "z"], correctIndex: 0, difficulty: 1)
            return PlannedCard(sentence: s, reviewState: .new(sentenceId: id, direction: .en2ru),
                               question: q, isReview: false)
        }
        return GateSessionPlan(cards: cards, deckId: 1, band: 1, direction: .en2ru)
    }

    // MARK: - Rating flows straight to FSRS

    func testGoodRatingGradesThroughFSRSAndAdvances() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)
        XCTAssertEqual(runner.currentSentence?.id, "s0")

        let r = try runner.submitRating(.good, now: t0)
        XCTAssertEqual(r.rating, .good)
        XCTAssertFalse(r.requeued)
        XCTAssertFalse(r.sessionComplete)
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s1")   // advanced
        XCTAssertEqual(runner.firstTryCorrect, 1)

        // Not written yet — buffered, per the LINGO-007 "commit once" design.
        XCTAssertEqual(writer.upserts.count, 0)
        XCTAssertEqual(runner.pendingRatingUpsertCount, 1)
    }

    func testAgainRatingRequeuesToEndAndSessionOnlyCompletesNonAgain() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)

        // s0 → Again: requeued to the back; queue becomes [s1, s2, s0].
        let r0 = try runner.submitRating(.again, now: t0)
        XCTAssertTrue(r0.requeued)
        XCTAssertFalse(r0.sessionComplete)
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s1")

        XCTAssertFalse(try runner.submitRating(.good, now: t0).requeued) // s1
        XCTAssertFalse(try runner.submitRating(.hard, now: t0).requeued) // s2
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s0")         // re-shown

        let done = try runner.submitRating(.good, now: t0)               // s0 now Good
        XCTAssertTrue(done.sessionComplete)
        XCTAssertTrue(runner.isComplete)

        // s0 counts as one failure: not first-try, graded exactly once (Again).
        XCTAssertEqual(runner.firstTryCorrect, 2)
        XCTAssertEqual(runner.pendingRatingUpsertCount, 3) // one buffered grade per card
    }

    func testRepeatedAgainOnReshowDoesNotDoubleGrade() throws {
        // Single-card plan: any non-Again rating on the (already graded) reshow
        // immediately empties the queue, so keep rating Again to stay in the
        // "no re-grade" reshow branch, matching the choice-path analogue
        // (`testRepeatedWrongDoesNotDoubleGrade`) which keeps submitting wrong.
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(1), fsrs: fsrs, writer: writer)
        _ = try runner.submitRating(.again, now: t0)   // graded once (Again)
        _ = try runner.submitRating(.again, now: t0)   // re-shown, still Again: no re-grade
        _ = try runner.submitRating(.again, now: t0)   // re-shown, still Again: no re-grade
        XCTAssertFalse(runner.isComplete)
        let done = try runner.submitRating(.good, now: t0) // finally passes
        XCTAssertTrue(done.sessionComplete)
        XCTAssertEqual(runner.pendingRatingUpsertCount, 1) // graded exactly once total
        XCTAssertEqual(runner.firstTryCorrect, 0)
    }

    func testHardRatingAppliesHardPenaltyDistinctFromGood() throws {
        let writer = FakeWriter()
        let runnerHard = GateSessionRunner(plan: makePlan(1), fsrs: fsrs, writer: writer)
        _ = try runnerHard.submitRating(.hard, now: t0)
        try runnerHard.commitPendingRatingUpserts()
        let hardState = try XCTUnwrap(writer.last(for: "s0"))

        let writer2 = FakeWriter()
        let runnerGood = GateSessionRunner(plan: makePlan(1), fsrs: fsrs, writer: writer2)
        _ = try runnerGood.submitRating(.good, now: t0)
        try runnerGood.commitPendingRatingUpserts()
        let goodState = try XCTUnwrap(writer2.last(for: "s0"))

        // First-ever review seeds stability directly from the grade (S0 = w[g-1]);
        // Hard (g=2) and Good (g=3) must diverge.
        XCTAssertEqual(hardState.stability!, FSRSParameters.defaultV45.w[1], accuracy: 1e-9)
        XCTAssertEqual(goodState.stability!, FSRSParameters.defaultV45.w[2], accuracy: 1e-9)
        XCTAssertNotEqual(hardState.stability!, goodState.stability!)
        XCTAssertEqual(hardState.state, .review)   // Hard still passes (not Again)
        XCTAssertEqual(goodState.state, .review)
    }

    // MARK: - Buffered commit ("commit once, at the end")

    func testWriterOnlyReceivesUpsertsAfterExplicitCommit() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)
        while let _ = runner.currentQuestion {
            _ = try runner.submitRating(.good, now: t0)
        }
        XCTAssertTrue(runner.isComplete)
        XCTAssertEqual(runner.pendingRatingUpsertCount, 3)
        XCTAssertEqual(writer.upserts.count, 0, "must not write until commit")

        try runner.commitPendingRatingUpserts()
        XCTAssertEqual(writer.upserts.count, 3)
        XCTAssertEqual(runner.pendingRatingUpsertCount, 0, "buffer drained after commit")
    }

    func testGateControllerFinishCommitsBufferedRatings() throws {
        let (store, path) = try TestSupport.openWritableCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let deck = try XCTUnwrap(try store.deck(code: TestSupport.deckCode))
        let qb = QuestionBuilder(store: store, deckId: deck.id)
        let sessionBuilder = GateSessionBuilder(store: store, builder: qb, direction: .en2ru, size: 10)
        var rng = SeededRNG(seed: 99)
        let plan = try sessionBuilder.build(deckId: deck.id, band: 1, now: t0, rng: &rng)

        let controller = try GateController(store: store, plan: plan, fsrs: fsrs,
                                            appBundleID: nil, now: t0)
        var now = t0
        while let _ = controller.runner.currentQuestion {
            now = now.addingTimeInterval(2)
            _ = try controller.runner.submitRating(.good, now: now)
        }
        XCTAssertTrue(controller.runner.isComplete)

        // Nothing persisted yet — only `finish` commits the buffer.
        let before = try store.db.prepare("SELECT COUNT(*) FROM ReviewState WHERE direction = 'en2ru'")
        XCTAssertTrue(try before.step())
        XCTAssertEqual(before.int(0), 0)

        try controller.finish(now: now, unlocked: true)

        let after = try store.db.prepare("SELECT COUNT(*) FROM ReviewState WHERE direction = 'en2ru'")
        XCTAssertTrue(try after.step())
        XCTAssertEqual(after.int(0), 10)
    }

    // MARK: - Undo (single level)

    func testUndoRevertsQueueGradeCountersAndBuffer() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)
        XCTAssertFalse(runner.canUndo)

        _ = try runner.submitRating(.good, now: t0)     // s0 → Good, advances to s1
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s1")
        XCTAssertEqual(runner.firstTryCorrect, 1)
        XCTAssertEqual(runner.pendingRatingUpsertCount, 1)
        XCTAssertTrue(runner.canUndo)

        let undone = runner.undoLastRating()
        XCTAssertTrue(undone)
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s0", "card restored to the front")
        XCTAssertEqual(runner.firstTryCorrect, 0, "counter reverted")
        XCTAssertEqual(runner.pendingRatingUpsertCount, 0, "buffered write reverted")
        XCTAssertFalse(runner.canUndo, "single-level: nothing left to undo")

        // A second undo is a no-op.
        XCTAssertFalse(runner.undoLastRating())
    }

    func testUndoAfterAgainRestoresPreRequeueOrder() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)
        _ = try runner.submitRating(.again, now: t0)    // s0 requeued: [s1, s2, s0]
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s1")

        XCTAssertTrue(runner.undoLastRating())
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s0", "back at the front, un-requeued")
        XCTAssertEqual(runner.pendingRatingUpsertCount, 0)
    }

    func testOnlyTheImmediatelyPrecedingRatingCanBeUndone() throws {
        let writer = FakeWriter()
        let runner = GateSessionRunner(plan: makePlan(3), fsrs: fsrs, writer: writer)
        _ = try runner.submitRating(.good, now: t0)   // s0
        _ = try runner.submitRating(.good, now: t0)   // s1 — this is now "the last one"
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s2")

        XCTAssertTrue(runner.undoLastRating())
        XCTAssertEqual(runner.currentQuestion?.sentenceId, "s1", "only s1 comes back, not s0 too")
        XCTAssertFalse(runner.canUndo)
    }
}
