// swift-tools-version:5.9
import PackageDescription

// QuizEngine — UI/platform-independent core for LingoGate (LINGO-004).
//
// Contains: the FSRS (v4.5) spaced-repetition scheduler, the gate-session
// question builder (due-first + new-card fill, wrong-answer re-queue, 4-choice
// distractor generation), band-promotion logic, and a thin SQLite3 wrapper over
// the LINGO-001 content DB (lingogate.db).
//
// Deliberately depends on nothing but Foundation + the system SQLite3 module so
// it builds for macOS (fast `swift test`) as well as iOS, and can later be
// reused verbatim by an Android port's shared-logic layer. It must NOT import
// any iOS-only framework (Screen Time / FamilyControls / SwiftUI).
let package = Package(
    name: "QuizEngine",
    platforms: [
        .iOS(.v17),
        .macOS(.v13)
    ],
    products: [
        .library(name: "QuizEngine", targets: ["QuizEngine"])
    ],
    targets: [
        .target(
            name: "QuizEngine"
            // `import SQLite3` resolves against the SDK's system module map;
            // it links libsqlite3 automatically, so no linkerSettings needed.
        ),
        .testTarget(
            name: "QuizEngineTests",
            dependencies: ["QuizEngine"],
            resources: [
                // A copy of the real LINGO-001 content DB, used by the
                // end-to-end integration test. This is a fixture copy — the
                // pipeline's lingogate.db is never modified.
                .copy("Resources/lingogate.db")
            ]
        )
    ]
)
