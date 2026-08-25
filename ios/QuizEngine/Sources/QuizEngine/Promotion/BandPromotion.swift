import Foundation

/// Result of a band-promotion check, with the raw components exposed for UI
/// (progress bars) and tests.
public struct BandProgress: Sendable, Equatable {
    public let band: Int
    public let coverage: Double       // 0…1
    public let retention: Double      // 0…1
    public let seenWords: Int
    public let coverageDenominator: Int
    public let reviewCards: Int
    public let promoted: Bool

    public init(band: Int, coverage: Double, retention: Double, seenWords: Int,
                coverageDenominator: Int, reviewCards: Int, promoted: Bool) {
        self.band = band
        self.coverage = coverage
        self.retention = retention
        self.seenWords = seenWords
        self.coverageDenominator = coverageDenominator
        self.reviewCards = reviewCards
        self.promoted = promoted
    }
}

/// Decides when the next band unlocks: vocab coverage ≥ 90% AND retention ≥ 80%
/// (design §5.1). Coverage and retention are computed from `ContentStore` stats,
/// but the pure threshold logic is separated out so the boundary behaviour is
/// unit-testable without a database.
public struct BandPromotion {
    public var coverageThreshold: Double
    public var retentionThreshold: Double
    /// Ignore retention until at least this many cards are in the Review state,
    /// so a lucky 1/1 doesn't trip an 80% gate on a nearly-empty band.
    public var minReviewCards: Int

    /// Denominator for the coverage ratio.
    public enum CoverageBasis: Sendable {
        /// All words in the band. Faithful to the design's "出題済み語彙 / band語彙",
        /// but a band whose sentences don't cover every lemma can never hit 90%.
        case allBandWords
        /// Only band words that appear in ≥1 sentence (the learnable vocab).
        /// Default — makes the ratio reachable for a real, finite deck.
        case coverableWords
    }
    public var coverageBasis: CoverageBasis

    public init(
        coverageThreshold: Double = 0.9,
        retentionThreshold: Double = 0.8,
        minReviewCards: Int = 5,
        coverageBasis: CoverageBasis = .coverableWords
    ) {
        self.coverageThreshold = coverageThreshold
        self.retentionThreshold = retentionThreshold
        self.minReviewCards = minReviewCards
        self.coverageBasis = coverageBasis
    }

    /// Pure threshold evaluation from already-computed components.
    public func evaluate(
        band: Int, seenWords: Int, totalWords: Int, coverableWords: Int,
        reps: Int, lapses: Int, reviewCards: Int
    ) -> BandProgress {
        let denom = (coverageBasis == .allBandWords) ? totalWords : coverableWords
        let coverage = denom > 0 ? Double(seenWords) / Double(denom) : 0
        let attempts = reps + lapses
        let retention = attempts > 0 ? Double(reps) / Double(attempts) : 0

        let coverageOK = coverage >= coverageThreshold
        let retentionOK = reviewCards >= minReviewCards && retention >= retentionThreshold
        return BandProgress(
            band: band, coverage: coverage, retention: retention,
            seenWords: seenWords, coverageDenominator: denom,
            reviewCards: reviewCards, promoted: coverageOK && retentionOK
        )
    }

    /// Evaluate straight from the DB.
    public func evaluate(
        store: ContentStore, deckId: Int, band: Int, direction: StudyDirection
    ) throws -> BandProgress {
        let vocab = try store.bandVocabStats(deckId: deckId, band: band, direction: direction)
        let agg = try store.bandReviewAggregate(deckId: deckId, band: band, direction: direction)
        return evaluate(
            band: band, seenWords: vocab.studied, totalWords: vocab.total,
            coverableWords: vocab.coverable, reps: agg.reps, lapses: agg.lapses,
            reviewCards: agg.reviewCards
        )
    }
}
