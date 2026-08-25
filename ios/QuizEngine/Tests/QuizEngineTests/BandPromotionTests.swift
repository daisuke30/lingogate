import XCTest
@testable import QuizEngine

final class BandPromotionTests: XCTestCase {
    let promo = BandPromotion()   // 0.9 coverage, 0.8 retention, minReviewCards 5

    // coverage = seen/coverable, retention = reps/(reps+lapses)

    func testPromotesWhenBothThresholdsMet() {
        // coverage 90/100 = 0.90, retention 8/(8+2) = 0.80, 6 review cards.
        let p = promo.evaluate(band: 1, seenWords: 90, totalWords: 200, coverableWords: 100,
                               reps: 8, lapses: 2, reviewCards: 6)
        XCTAssertEqual(p.coverage, 0.9, accuracy: 1e-9)
        XCTAssertEqual(p.retention, 0.8, accuracy: 1e-9)
        XCTAssertTrue(p.promoted)
    }

    func testCoverageJustBelowBlocks() {
        // 89/100 = 0.89 < 0.90
        let p = promo.evaluate(band: 1, seenWords: 89, totalWords: 200, coverableWords: 100,
                               reps: 9, lapses: 1, reviewCards: 8)
        XCTAssertFalse(p.promoted)
    }

    func testRetentionJustBelowBlocks() {
        // 79/(79+21) = 0.79 < 0.80
        let p = promo.evaluate(band: 1, seenWords: 95, totalWords: 100, coverableWords: 100,
                               reps: 79, lapses: 21, reviewCards: 10)
        XCTAssertFalse(p.promoted)
    }

    func testTooFewReviewCardsBlocksEvenAtPerfectRetention() {
        // 4 cards < minReviewCards 5, retention 1.0, coverage 1.0 → still blocked.
        let p = promo.evaluate(band: 1, seenWords: 100, totalWords: 100, coverableWords: 100,
                               reps: 4, lapses: 0, reviewCards: 4)
        XCTAssertFalse(p.promoted)
    }

    func testCoverageBasisAllBandWordsIsStricter() {
        let coverable = BandPromotion(coverageBasis: .coverableWords)
        let allWords = BandPromotion(coverageBasis: .allBandWords)
        // 90 seen, 100 coverable, but 1000 total band words.
        let a = coverable.evaluate(band: 1, seenWords: 90, totalWords: 1000, coverableWords: 100,
                                   reps: 8, lapses: 2, reviewCards: 6)
        let b = allWords.evaluate(band: 1, seenWords: 90, totalWords: 1000, coverableWords: 100,
                                  reps: 8, lapses: 2, reviewCards: 6)
        XCTAssertTrue(a.promoted)                 // 90/100 reachable
        XCTAssertFalse(b.promoted)                // 90/1000 = 0.09
        XCTAssertEqual(b.coverage, 0.09, accuracy: 1e-9)
    }

    func testZeroDataIsSafe() {
        let p = promo.evaluate(band: 1, seenWords: 0, totalWords: 0, coverableWords: 0,
                               reps: 0, lapses: 0, reviewCards: 0)
        XCTAssertEqual(p.coverage, 0)
        XCTAssertEqual(p.retention, 0)
        XCTAssertFalse(p.promoted)
    }

    func testBand1FromRealDBDoesNotPromoteFresh() throws {
        let (store, path) = try TestSupport.openWritableCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let deck = try XCTUnwrap(try store.deck(code: TestSupport.deckCode))
        // No reviews yet → coverage 0, no promotion.
        let p = try promo.evaluate(store: store, deckId: deck.id, band: 1,
                                   direction: TestSupport.direction)
        XCTAssertEqual(p.seenWords, 0)
        XCTAssertFalse(p.promoted)
        XCTAssertGreaterThan(p.coverageDenominator, 0)   // band has coverable words
    }
}
