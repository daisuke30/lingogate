import XCTest
@testable import QuizEngine

final class FSRSTests: XCTestCase {
    let fsrs = FSRS()                     // default FSRS-4.5 parameters
    let t0 = Date(timeIntervalSince1970: 1_700_000_000)
    let day: TimeInterval = 86_400

    // MARK: Building blocks / known anchors

    func testInitialStabilityEqualsWeights() {
        let w = FSRSParameters.defaultV45.w
        XCTAssertEqual(fsrs.initialStability(.again), w[0], accuracy: 1e-9)
        XCTAssertEqual(fsrs.initialStability(.hard),  w[1], accuracy: 1e-9)
        XCTAssertEqual(fsrs.initialStability(.good),  w[2], accuracy: 1e-9) // == 3.0412
        XCTAssertEqual(fsrs.initialStability(.easy),  w[3], accuracy: 1e-9)
    }

    func testInitialStabilityMonotonicInRating() {
        XCTAssertLessThan(fsrs.initialStability(.again), fsrs.initialStability(.hard))
        XCTAssertLessThan(fsrs.initialStability(.hard),  fsrs.initialStability(.good))
        XCTAssertLessThan(fsrs.initialStability(.good),  fsrs.initialStability(.easy))
    }

    func testInitialDifficultyKnownValues() {
        XCTAssertEqual(fsrs.initialDifficulty(.good), 4.490943335, accuracy: 1e-6)
        XCTAssertEqual(fsrs.initialDifficulty(.easy), 1.163043430, accuracy: 1e-6)
        // Difficulty is always clamped to [1,10].
        for g in Rating.allCases {
            let d = fsrs.initialDifficulty(g)
            XCTAssertGreaterThanOrEqual(d, 1.0)
            XCTAssertLessThanOrEqual(d, 10.0)
        }
    }

    func testIntervalEqualsStabilityAt90Percent() {
        // With DECAY=-0.5 and requestRetention 0.9, next interval == stability.
        for s in [0.5, 3.0412, 13.216, 100.0] {
            XCTAssertEqual(fsrs.interval(forStability: s), s, accuracy: 1e-6)
        }
    }

    func testRetrievabilityIsMonotonicAndHalfLifeProperty() {
        let s = 10.0
        // At elapsed == stability, retrievability is exactly the design target 0.9.
        XCTAssertEqual(fsrs.forgettingCurve(elapsedDays: s, stability: s), 0.9, accuracy: 1e-9)
        // Strictly decreasing in elapsed time.
        var prev = 1.0
        for t in stride(from: 0.0, through: 40.0, by: 2.0) {
            let r = fsrs.forgettingCurve(elapsedDays: t, stability: s)
            XCTAssertLessThanOrEqual(r, prev)
            prev = r
        }
    }

    // MARK: review() wiring & state machine

    func testFirstGoodReviewSeedsStateAndSchedules() {
        let card = ReviewState.new(sentenceId: "s001", direction: .en2ru)
        let out = fsrs.review(card, rating: .good, now: t0)
        XCTAssertEqual(out.stability!, 3.0412, accuracy: 1e-9)          // == w[2]
        XCTAssertEqual(out.difficulty!, 4.490943335, accuracy: 1e-6)
        XCTAssertEqual(out.state, .review)
        XCTAssertEqual(out.reps, 1)
        XCTAssertEqual(out.lapses, 0)
        XCTAssertEqual(out.lastReview, t0)
        // due == now + interval(S) == now + S days.
        XCTAssertEqual(out.due!.timeIntervalSince(t0), 3.0412 * day, accuracy: 1.0)
    }

    func testFirstAgainGoesToLearning() {
        let card = ReviewState.new(sentenceId: "s001", direction: .en2ru)
        let out = fsrs.review(card, rating: .again, now: t0)
        XCTAssertEqual(out.state, .learning)
        XCTAssertEqual(out.reps, 0)
        XCTAssertEqual(out.stability!, fsrs.initialStability(.again), accuracy: 1e-9)
    }

    func testSecondGoodGrowsStabilityToKnownValue() {
        let card = ReviewState.new(sentenceId: "s001", direction: .en2ru)
        let r1 = fsrs.review(card, rating: .good, now: t0)
        // Review again exactly when due (elapsed == stability → R == 0.9).
        let r2 = fsrs.review(r1, rating: .good, now: r1.due!)
        XCTAssertEqual(r2.stability!, 13.2160305565, accuracy: 1e-6)
        XCTAssertEqual(r2.difficulty!, 4.2666428817, accuracy: 1e-6)
        XCTAssertEqual(r2.reps, 2)
        XCTAssertEqual(r2.state, .review)
        XCTAssertGreaterThan(r2.stability!, r1.stability!)
    }

    func testRepeatedGoodIntervalsAreStrictlyIncreasing() {
        var card = fsrs.review(ReviewState.new(sentenceId: "s001", direction: .en2ru),
                               rating: .good, now: t0)
        var lastInterval = card.due!.timeIntervalSince(card.lastReview!)
        for _ in 0..<5 {
            let next = fsrs.review(card, rating: .good, now: card.due!)
            let interval = next.due!.timeIntervalSince(next.lastReview!)
            XCTAssertGreaterThan(interval, lastInterval)
            lastInterval = interval
            card = next
        }
    }

    func testAgainAfterReviewIncrementsLapsesAndDecaysStability() {
        // Build a well-learned card first.
        var card = fsrs.review(ReviewState.new(sentenceId: "s001", direction: .en2ru),
                               rating: .good, now: t0)
        card = fsrs.review(card, rating: .good, now: card.due!)
        let sBefore = card.stability!
        let lapsesBefore = card.lapses

        let lapsed = fsrs.review(card, rating: .again, now: card.due!)
        XCTAssertEqual(lapsed.lapses, lapsesBefore + 1)
        XCTAssertEqual(lapsed.state, .relearning)
        XCTAssertLessThan(lapsed.stability!, sBefore)                    // decayed
        XCTAssertEqual(lapsed.stability!, 2.7021483251, accuracy: 1e-6)  // known value
    }

    func testStabilityNeverBelowMinimum() {
        // Immediate Again on a fresh card, then Again again — stays >= min.
        var card = fsrs.review(ReviewState.new(sentenceId: "s001", direction: .en2ru),
                               rating: .again, now: t0)
        for i in 1...5 {
            card = fsrs.review(card, rating: .again, now: t0.addingTimeInterval(Double(i) * day))
            XCTAssertGreaterThanOrEqual(card.stability!, FSRSParameters.defaultV45.minimumStability)
        }
    }

    func testEasyPromotionMapperIsOptInAndTimeGated() {
        let off = RatingMapper()
        XCTAssertEqual(off.rating(correct: true, responseTime: 1.0), .good)
        XCTAssertEqual(off.rating(correct: false, responseTime: 1.0), .again)

        let on = RatingMapper(enableEasyPromotion: true, fastThreshold: 3.0)
        XCTAssertEqual(on.rating(correct: true, responseTime: 1.0), .easy)   // fast → easy
        XCTAssertEqual(on.rating(correct: true, responseTime: 9.0), .good)   // slow → good
        XCTAssertEqual(on.rating(correct: false, responseTime: 1.0), .again) // wrong → again
    }
}
