import Foundation

/// Date <-> SQLite text conversion. The LINGO-001 schema writes timestamps with
/// SQLite's `datetime('now')`, i.e. "YYYY-MM-DD HH:MM:SS" in UTC. We store our
/// own due/last_review columns in that same shape for consistency, but parse
/// leniently (also accepting ISO-8601 with a "T" separator and/or fractional
/// seconds) so hand-written or upstream values still load.
enum SQLDate {
    static let utc = TimeZone(identifier: "UTC")!

    private static let writer: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    private static func makeReader(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc
        f.dateFormat = format
        return f
    }

    private static let readers: [DateFormatter] = [
        makeReader("yyyy-MM-dd HH:mm:ss"),
        makeReader("yyyy-MM-dd'T'HH:mm:ss"),
        makeReader("yyyy-MM-dd HH:mm:ss.SSS"),
        makeReader("yyyy-MM-dd'T'HH:mm:ss.SSS"),
        makeReader("yyyy-MM-dd'T'HH:mm:ssZ")
    ]

    static func string(from date: Date) -> String {
        writer.string(from: date)
    }

    static func date(from string: String?) -> Date? {
        guard let s = string, !s.isEmpty else { return nil }
        for r in readers {
            if let d = r.date(from: s) { return d }
        }
        return nil
    }
}
