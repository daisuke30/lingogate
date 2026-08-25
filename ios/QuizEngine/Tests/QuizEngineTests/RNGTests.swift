import XCTest
@testable import QuizEngine

final class RNGTests: XCTestCase {
    func testSameSeedIsReproducible() {
        var a = SeededRNG(seed: 42)
        var b = SeededRNG(seed: 42)
        let seqA = (0..<20).map { _ in a.next() }
        let seqB = (0..<20).map { _ in b.next() }
        XCTAssertEqual(seqA, seqB)
    }

    func testDifferentSeedsDiverge() {
        var a = SeededRNG(seed: 1)
        var b = SeededRNG(seed: 2)
        XCTAssertNotEqual(a.next(), b.next())
    }

    func testShuffleReproducibleWithSeed() {
        let arr = Array(0..<50)
        var a = SeededRNG(seed: 7)
        var b = SeededRNG(seed: 7)
        XCTAssertEqual(arr.shuffled(using: &a), arr.shuffled(using: &b))
    }

    func testZeroSeedDoesNotStick() {
        var g = SeededRNG(seed: 0)
        XCTAssertNotEqual(g.next(), 0)
    }
}
