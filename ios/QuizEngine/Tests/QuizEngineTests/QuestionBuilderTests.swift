import XCTest
@testable import QuizEngine

final class QuestionBuilderTests: XCTestCase {
    var store: ContentStore!
    var path: String!
    var deckId: Int!

    override func setUpWithError() throws {
        let opened = try TestSupport.openWritableCopy()
        store = opened.store
        path = opened.path
        deckId = try XCTUnwrap(try store.deck(code: TestSupport.deckCode)).id
    }

    override func tearDownWithError() throws {
        store = nil
        if let p = path { try? FileManager.default.removeItem(atPath: p) }
    }

    // Look up a word's (pos, band) by lemma directly, for integrity assertions.
    private func posBand(forLemma lemma: String) throws -> (pos: String, band: Int)? {
        let st = try store.db.prepare("SELECT pos, band FROM Word WHERE deck_id = ?1 AND lemma = ?2")
        st.bind(1, deckId).bind(2, lemma)
        guard try st.step() else { return nil }
        return (st.string(0), st.int(1))
    }

    private func band(forRU ru: String) throws -> Int? {
        let st = try store.db.prepare("SELECT band FROM Sentence WHERE deck_id = ?1 AND ru = ?2")
        st.bind(1, deckId).bind(2, ru)
        guard try st.step() else { return nil }
        return st.int(0)
    }

    func testSentenceChoiceStructure() throws {
        let builder = QuestionBuilder(store: store, deckId: deckId)
        let sentence = try XCTUnwrap(try store.sentence(id: "s001"))
        var rng = SeededRNG(seed: 123)
        let q = try builder.build(for: sentence, forcedType: .sentenceChoice, rng: &rng)

        XCTAssertEqual(q.type, .sentenceChoice)
        XCTAssertEqual(q.options.count, 4)
        XCTAssertEqual(Set(q.options).count, 4, "options must be distinct")
        XCTAssertEqual(q.prompt, sentence.en)
        XCTAssertEqual(q.correctOption, sentence.ru)
        XCTAssertTrue((0..<4).contains(q.correctIndex))
        // Every option is a real same-band sentence.
        for opt in q.options {
            XCTAssertEqual(try band(forRU: opt), sentence.band,
                           "distractor '\(opt)' not from same band")
        }
    }

    func testReproducibleWithSameSeed() throws {
        let builder = QuestionBuilder(store: store, deckId: deckId)
        let sentence = try XCTUnwrap(try store.sentence(id: "s010"))
        var a = SeededRNG(seed: 999)
        var b = SeededRNG(seed: 999)
        let qa = try builder.build(for: sentence, rng: &a)
        let qb = try builder.build(for: sentence, rng: &b)
        XCTAssertEqual(qa.options, qb.options)
        XCTAssertEqual(qa.type, qb.type)
        XCTAssertEqual(qa.correctIndex, qb.correctIndex)
    }

    func testEveryBand1SentenceYields4DistinctOptions() throws {
        let builder = QuestionBuilder(store: store, deckId: deckId)
        let sentences = try store.newSentences(
            deckId: deckId, band: 1, direction: .en2ru, excluding: [], limit: 300
        )
        XCTAssertGreaterThan(sentences.count, 50)
        var rng = SeededRNG(seed: 2024)
        for s in sentences {
            let q = try builder.build(for: s, rng: &rng)
            XCTAssertEqual(q.options.count, 4, "sentence \(s.id)")
            XCTAssertEqual(Set(q.options).count, 4, "sentence \(s.id) has duplicate options")
            XCTAssertTrue(q.options.contains(q.correctOption))
        }
    }

    func testClozeOptionsSharePOSAndBand() throws {
        let builder = QuestionBuilder(store: store, deckId: deckId)
        let sentences = try store.newSentences(
            deckId: deckId, band: 1, direction: .en2ru, excluding: [], limit: 300
        ).filter { $0.difficulty >= 2 }

        var built = 0
        var rng = SeededRNG(seed: 555)
        for s in sentences {
            guard let q = try builder.buildCloze(for: s, rng: &rng) else { continue }
            built += 1
            XCTAssertEqual(q.type, .cloze)
            XCTAssertEqual(q.options.count, 4)
            XCTAssertEqual(Set(q.options).count, 4)
            XCTAssertTrue(q.prompt.contains("___"), "cloze prompt should have a blank")
            XCTAssertEqual(q.subPrompt, s.en)

            // The correct option's POS/band define the expected pool; all four
            // options must share them.
            let correct = q.correctOption
            let cb = try XCTUnwrap(try posBand(forLemma: correct),
                                   "correct lemma '\(correct)' not in Word table")
            for opt in q.options {
                let ob = try XCTUnwrap(try posBand(forLemma: opt),
                                       "option '\(opt)' not a known lemma")
                XCTAssertEqual(ob.pos, cb.pos, "option '\(opt)' POS mismatch")
                XCTAssertEqual(ob.band, cb.band, "option '\(opt)' band mismatch")
            }
            if built >= 15 { break }
        }
        XCTAssertGreaterThan(built, 0, "expected at least one cloze-capable sentence")
    }

    func testJaccardHeuristic() {
        let builder = QuestionBuilder(store: store, deckId: deckId)
        XCTAssertEqual(builder.jaccard([1, 2, 3], [1, 2, 3]), 1.0, accuracy: 1e-9)
        XCTAssertEqual(builder.jaccard([1, 2], [3, 4]), 0.0, accuracy: 1e-9)
        XCTAssertEqual(builder.jaccard([1, 2, 3, 4], [3, 4]), 0.5, accuracy: 1e-9)
        XCTAssertEqual(builder.jaccard([], []), 0.0, accuracy: 1e-9)
    }
}
