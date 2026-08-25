import Foundation

/// Helper for the "ship a read-only content DB in the app bundle, copy it once
/// into a writable location on first launch, then read/write there" pattern.
///
/// Kept in QuizEngine (not the iOS app) so LINGO-005's UI layer and any tests
/// can share exactly one copy-and-open code path. Pure Foundation — no iOS-only
/// API — so it also runs under `swift test` on macOS.
public enum DBOpen {
    public enum DBOpenError: Error, CustomStringConvertible {
        case bundledDBMissing(URL)
        public var description: String {
            switch self {
            case .bundledDBMissing(let url): return "Bundled DB not found at \(url.path)"
            }
        }
    }

    /// The writable destination URL for the content DB, e.g.
    /// `<Application Support>/LingoGate/lingogate.db`. Creates the directory.
    public static func writableURL(
        filename: String = "lingogate.db",
        subdirectory: String = "LingoGate",
        in directory: FileManager.SearchPathDirectory = .applicationSupportDirectory,
        fileManager: FileManager = .default
    ) throws -> URL {
        let base = try fileManager.url(
            for: directory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let dir = base.appendingPathComponent(subdirectory, isDirectory: true)
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(filename)
    }

    /// Copy the bundled DB to `destination` if no writable copy exists yet.
    /// Idempotent: does nothing when the destination is already present (so a
    /// learner's FSRS state is never clobbered by a re-launch).
    /// - Parameter overwrite: force-replace the destination (e.g. on a content
    ///   upgrade that must reset). Defaults to false.
    /// - Returns: true if a copy was performed.
    @discardableResult
    public static func installIfNeeded(
        bundledAt bundleURL: URL,
        to destination: URL,
        overwrite: Bool = false,
        fileManager: FileManager = .default
    ) throws -> Bool {
        guard fileManager.fileExists(atPath: bundleURL.path) else {
            throw DBOpenError.bundledDBMissing(bundleURL)
        }
        if fileManager.fileExists(atPath: destination.path) {
            if !overwrite { return false }
            try fileManager.removeItem(at: destination)
        }
        try fileManager.copyItem(at: bundleURL, to: destination)
        return true
    }

    /// One-call convenience: ensure a writable copy of the bundled DB exists and
    /// open it read-write. This is the entry point LINGO-005 should call at
    /// launch.
    public static func openWritable(
        bundledAt bundleURL: URL,
        filename: String = "lingogate.db",
        subdirectory: String = "LingoGate",
        overwrite: Bool = false,
        fileManager: FileManager = .default
    ) throws -> Database {
        let dest = try writableURL(
            filename: filename, subdirectory: subdirectory, fileManager: fileManager
        )
        try installIfNeeded(
            bundledAt: bundleURL, to: dest, overwrite: overwrite, fileManager: fileManager
        )
        return try Database(path: dest.path, readonly: false)
    }
}
