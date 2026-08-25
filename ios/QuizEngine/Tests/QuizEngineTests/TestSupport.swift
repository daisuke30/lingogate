import Foundation
import XCTest
@testable import QuizEngine

/// Shared helpers for tests that need the real content DB.
enum TestSupport {
    /// URL of the bundled fixture copy of lingogate.db (a copy of LINGO-001's
    /// output; never the original).
    static func bundledDBURL() throws -> URL {
        guard let url = Bundle.module.url(forResource: "lingogate", withExtension: "db") else {
            throw XCTSkip("lingogate.db fixture not bundled")
        }
        return url
    }

    /// Copy the fixture DB into a unique temp file and open it read-write, so a
    /// test can mutate ReviewState/GateSession without touching the fixture.
    static func openWritableCopy() throws -> (store: ContentStore, path: String) {
        let src = try bundledDBURL()
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("lingogate-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: src, to: tmp)
        let store = try ContentStore(path: tmp.path, readonly: false)
        return (store, tmp.path)
    }

    static let deckCode = "RU-from-EN"
    static let direction = StudyDirection.en2ru
}
