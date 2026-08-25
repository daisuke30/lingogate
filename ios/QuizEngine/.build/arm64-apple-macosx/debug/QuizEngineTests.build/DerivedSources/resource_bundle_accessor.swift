import Foundation

extension Foundation.Bundle {
    static nonisolated let module: Bundle = {
        let mainPath = Bundle.main.bundleURL.appendingPathComponent("QuizEngine_QuizEngineTests.bundle").path
        let buildPath = "/Users/Daisuke/inoma/workspace/apps/lingogate/ios/QuizEngine/.build/arm64-apple-macosx/debug/QuizEngine_QuizEngineTests.bundle"

        let preferredBundle = Bundle(path: mainPath)

        guard let bundle = preferredBundle ?? Bundle(path: buildPath) else {
            // Users can write a function called fatalError themselves, we should be resilient against that.
            Swift.fatalError("could not load resource bundle: from \(mainPath) or \(buildPath)")
        }

        return bundle
    }()
}