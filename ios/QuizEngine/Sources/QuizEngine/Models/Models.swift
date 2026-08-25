import Foundation

// MARK: - Core content models (mirror the LINGO-001 SQLite schema)

/// A language pair + level ladder (e.g. "RU-from-EN").
public struct Deck: Sendable, Equatable {
    public let id: Int
    public let code: String
    public let name: String
    public let targetLang: String
    public let sourceLang: String

    public init(id: Int, code: String, name: String, targetLang: String, sourceLang: String) {
        self.id = id
        self.code = code
        self.name = name
        self.targetLang = targetLang
        self.sourceLang = sourceLang
    }
}

/// A vocabulary lemma with frequency rank, band, and part of speech.
public struct Word: Sendable, Equatable, Identifiable {
    public let id: Int
    public let lemma: String
    public let rank: Int?
    public let band: Int
    public let pos: String
    public let enGloss: String?
    public let jaGloss: String?

    public init(id: Int, lemma: String, rank: Int?, band: Int, pos: String, enGloss: String?, jaGloss: String?) {
        self.id = id
        self.lemma = lemma
        self.rank = rank
        self.band = band
        self.pos = pos
        self.enGloss = enGloss
        self.jaGloss = jaGloss
    }
}

/// An example sentence. `id` is a stable string key ("s001") so review state
/// survives content re-imports.
public struct Sentence: Sendable, Equatable, Identifiable {
    public let id: String
    public let deckId: Int
    public let ru: String
    public let en: String
    public let ja: String?
    public let band: Int
    public let difficulty: Int
    public let source: String

    public init(id: String, deckId: Int, ru: String, en: String, ja: String?, band: Int, difficulty: Int, source: String) {
        self.id = id
        self.deckId = deckId
        self.ru = ru
        self.en = en
        self.ja = ja
        self.band = band
        self.difficulty = difficulty
        self.source = source
    }
}

// MARK: - Study direction

/// Which way a card is studied. The dogfood deck is EN→RU.
public struct StudyDirection: Sendable, Equatable, RawRepresentable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let en2ru = StudyDirection(rawValue: "en2ru")
    public static let ru2en = StudyDirection(rawValue: "ru2en")
}

// MARK: - FSRS card state (mirrors ReviewState)

/// FSRS learning state. Values match the `ReviewState.state` integer column.
public enum CardState: Int, Sendable, Equatable {
    case new = 0
    case learning = 1
    case review = 2
    case relearning = 3
}

/// A learner's scheduling state for one (sentence, direction). Maps 1:1 to a
/// `ReviewState` row. `stability`/`difficulty`/`due`/`lastReview` are nil for a
/// never-reviewed (new) card.
public struct ReviewState: Sendable, Equatable {
    public var sentenceId: String
    public var direction: StudyDirection
    public var stability: Double?
    public var difficulty: Double?
    public var due: Date?
    public var reps: Int
    public var lapses: Int
    public var lastReview: Date?
    public var state: CardState

    public init(
        sentenceId: String,
        direction: StudyDirection,
        stability: Double? = nil,
        difficulty: Double? = nil,
        due: Date? = nil,
        reps: Int = 0,
        lapses: Int = 0,
        lastReview: Date? = nil,
        state: CardState = .new
    ) {
        self.sentenceId = sentenceId
        self.direction = direction
        self.stability = stability
        self.difficulty = difficulty
        self.due = due
        self.reps = reps
        self.lapses = lapses
        self.lastReview = lastReview
        self.state = state
    }

    /// A fresh, never-reviewed card for the given sentence.
    public static func new(sentenceId: String, direction: StudyDirection) -> ReviewState {
        ReviewState(sentenceId: sentenceId, direction: direction, state: .new)
    }
}
