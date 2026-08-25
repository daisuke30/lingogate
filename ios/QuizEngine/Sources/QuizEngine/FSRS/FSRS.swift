import Foundation

// MARK: - Rating

/// The four-valued FSRS grade. LingoGate's 4-choice UI maps to just Again
/// (wrong) / Good (right) today; Hard/Easy are wired through so a future
/// response-time heuristic can promote a fast, first-try answer to `.easy`
/// without touching the scheduler. See `RatingMapper`.
public enum Rating: Int, Sendable, Equatable, CaseIterable {
    case again = 1
    case hard = 2
    case good = 3
    case easy = 4
}

/// Maps a quiz outcome to an FSRS rating.
///
/// MVP policy: correct → .good, wrong → .again. The `elapsed`/`fast` inputs are
/// accepted now so the Easy-promotion rule can be enabled later as pure config,
/// with no call-site changes.
public struct RatingMapper: Sendable {
    /// If true, a correct answer faster than `fastThreshold` is graded `.easy`.
    public var enableEasyPromotion: Bool
    public var fastThreshold: TimeInterval

    public init(enableEasyPromotion: Bool = false, fastThreshold: TimeInterval = 3.0) {
        self.enableEasyPromotion = enableEasyPromotion
        self.fastThreshold = fastThreshold
    }

    public func rating(correct: Bool, responseTime: TimeInterval?) -> Rating {
        guard correct else { return .again }
        if enableEasyPromotion, let t = responseTime, t <= fastThreshold {
            return .easy
        }
        return .good
    }
}

// MARK: - Parameters

/// FSRS-4.5 model parameters. `w` holds the 17 weights w[0]…w[16].
public struct FSRSParameters: Sendable, Equatable {
    public var w: [Double]
    /// Desired retention at scheduling time (the "request retention"). 0.9 is
    /// the FSRS default and the design's target.
    public var requestRetention: Double
    /// Hard cap on an interval, in days (~100 years).
    public var maximumInterval: Double
    /// Floor for stability, in days. FSRS clamps S to this minimum.
    public var minimumStability: Double

    public init(
        w: [Double],
        requestRetention: Double = 0.9,
        maximumInterval: Double = 36500,
        minimumStability: Double = 0.1
    ) {
        precondition(w.count == 17, "FSRS-4.5 requires exactly 17 weights")
        self.w = w
        self.requestRetention = requestRetention
        self.maximumInterval = maximumInterval
        self.minimumStability = minimumStability
    }

    /// Default FSRS-4.5 weights.
    ///
    /// Source: the open-spaced-repetition FSRS-4.5 default parameter set (the
    /// same 17-weight vector shipped by FSRS4Anki v4.5 / early py-fsrs "4.5").
    /// Held here as data and injectable so a personally-optimised vector can be
    /// swapped in later without code changes.
    public static let defaultV45 = FSRSParameters(w: [
        0.4197, 1.1869, 3.0412, 15.2441, 7.1434, 0.6477, 1.0007, 0.0674,
        1.6597, 0.1712, 1.1178, 2.0225, 0.0904, 0.3025, 2.1214, 0.2498, 2.9466
    ])
}

// MARK: - FSRS scheduler

/// Pure FSRS-4.5 scheduler. No I/O, no DB, no clock of its own — every call
/// takes an explicit `now`, so it is fully deterministic and unit-testable.
///
/// Formula set (FSRS-4.5):
///   R(t,S)  = (1 + FACTOR · t/S)^DECAY                        (forgetting curve)
///   I(S)    = (S / FACTOR) · (requestRetention^(1/DECAY) − 1) (next interval)
///   S₀(g)   = w[g-1]                                          (initial stability)
///   D₀(g)   = w[4] − e^(w[5]·(g-1)) + 1                       (initial difficulty)
///   D'      = w[7]·D₀(Easy) + (1−w[7])·(D − w[6]·(g-3))       (difficulty w/ mean reversion)
///   S_recall= S·(1 + e^(w[8])·(11−D)·S^(−w[9])·(e^((1−R)·w[10])−1)·hard·easy)
///   S_forget= w[11]·D^(−w[12])·((S+1)^w[13] − 1)·e^((1−R)·w[14])
/// with DECAY = −0.5 and FACTOR = 19/81 (so at requestRetention 0.9, I(S) == S).
public struct FSRS: Sendable {
    public let params: FSRSParameters

    static let decay: Double = -0.5
    static let factor: Double = 19.0 / 81.0

    public init(params: FSRSParameters = .defaultV45) {
        self.params = params
    }

    // MARK: Building blocks (exposed for testing)

    /// Retrievability after `elapsedDays` at the given stability.
    public func forgettingCurve(elapsedDays: Double, stability: Double) -> Double {
        pow(1.0 + Self.factor * elapsedDays / stability, Self.decay)
    }

    /// Next interval (in days) that schedules a card at `requestRetention`.
    public func interval(forStability stability: Double) -> Double {
        let raw = (stability / Self.factor)
            * (pow(params.requestRetention, 1.0 / Self.decay) - 1.0)
        return min(max(raw, params.minimumStability), params.maximumInterval)
    }

    /// Initial stability S₀ for a first-ever review with grade `g`.
    public func initialStability(_ g: Rating) -> Double {
        max(params.w[g.rawValue - 1], params.minimumStability)
    }

    /// Initial difficulty D₀ for a first-ever review with grade `g`.
    public func initialDifficulty(_ g: Rating) -> Double {
        clampDifficulty(params.w[4] - exp(params.w[5] * Double(g.rawValue - 1)) + 1.0)
    }

    /// Difficulty after a subsequent review, with mean reversion toward D₀(Easy).
    public func nextDifficulty(_ d: Double, _ g: Rating) -> Double {
        let deltaApplied = d - params.w[6] * Double(g.rawValue - 3)
        let reverted = params.w[7] * initialDifficulty(.easy)
            + (1.0 - params.w[7]) * deltaApplied
        return clampDifficulty(reverted)
    }

    /// Stability after a successful recall (grade ≥ Hard).
    public func nextRecallStability(d: Double, s: Double, r: Double, g: Rating) -> Double {
        let hardPenalty = (g == .hard) ? params.w[15] : 1.0
        let easyBonus = (g == .easy) ? params.w[16] : 1.0
        let increase = exp(params.w[8])
            * (11.0 - d)
            * pow(s, -params.w[9])
            * (exp((1.0 - r) * params.w[10]) - 1.0)
            * hardPenalty
            * easyBonus
        return max(s * (1.0 + increase), params.minimumStability)
    }

    /// Stability after a lapse (grade == Again).
    public func nextForgetStability(d: Double, s: Double, r: Double) -> Double {
        let sf = params.w[11]
            * pow(d, -params.w[12])
            * (pow(s + 1.0, params.w[13]) - 1.0)
            * exp((1.0 - r) * params.w[14])
        return max(sf, params.minimumStability)
    }

    private func clampDifficulty(_ d: Double) -> Double {
        min(max(d, 1.0), 10.0)
    }

    // MARK: Review

    /// Retrievability of `card` evaluated at `now` (1.0 if never reviewed).
    public func retrievability(_ card: ReviewState, now: Date) -> Double {
        guard let s = card.stability, let last = card.lastReview else { return 1.0 }
        let elapsed = max(0, now.timeIntervalSince(last)) / 86_400.0
        return forgettingCurve(elapsedDays: elapsed, stability: s)
    }

    /// Apply a review of `card` at time `now` with the given grade and return
    /// the updated state (stability, difficulty, due, reps/lapses, state).
    public func review(_ card: ReviewState, rating: Rating, now: Date) -> ReviewState {
        var next = card

        if card.state == .new || card.stability == nil || card.difficulty == nil {
            // First-ever review: seed S and D from the grade.
            next.stability = initialStability(rating)
            next.difficulty = initialDifficulty(rating)
            if rating == .again {
                next.state = .learning
            } else {
                next.state = .review
                next.reps += 1
            }
        } else {
            let s = card.stability!
            let d = card.difficulty!
            let r = retrievability(card, now: now)
            if rating == .again {
                next.stability = nextForgetStability(d: d, s: s, r: r)
                next.difficulty = nextDifficulty(d, rating)
                next.lapses += 1
                next.state = .relearning
            } else {
                next.stability = nextRecallStability(d: d, s: s, r: r, g: rating)
                next.difficulty = nextDifficulty(d, rating)
                next.reps += 1
                next.state = .review
            }
        }

        let s = max(next.stability!, params.minimumStability)
        next.stability = s
        let ivlDays = interval(forStability: s)
        next.lastReview = now
        next.due = now.addingTimeInterval(ivlDays * 86_400.0)
        return next
    }
}
