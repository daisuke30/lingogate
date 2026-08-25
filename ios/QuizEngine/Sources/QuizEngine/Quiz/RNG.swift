import Foundation

/// A seedable, deterministic random number generator (SplitMix64).
///
/// Used everywhere the quiz needs randomness — distractor selection, option
/// shuffling, cloze-vs-choice mixing — so a fixed seed makes an entire gate
/// session reproducible in tests. Conforms to `RandomNumberGenerator`, so it
/// drops into `shuffled(using:)`, `randomElement(using:)`, etc.
public struct SeededRNG: RandomNumberGenerator {
    private var state: UInt64

    public init(seed: UInt64) {
        // Avoid the all-zero fixed point of SplitMix64.
        self.state = seed == 0 ? 0x9E3779B97F4A7C15 : seed
    }

    public mutating func next() -> UInt64 {
        state = state &+ 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}
