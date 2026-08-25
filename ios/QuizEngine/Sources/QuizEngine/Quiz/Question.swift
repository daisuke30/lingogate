import Foundation

/// The two supported question formats.
public enum QuestionType: String, Sendable, Equatable {
    /// Show the EN prompt, pick the correct whole RU sentence out of 4.
    /// Low cognitive load, the default format (design §5.3).
    case sentenceChoice
    /// Show the RU sentence with one band word blanked ("___"), pick the word
    /// that belongs from 4 same-POS / same-band lemmas. Used to add difficulty
    /// on harder sentences (difficulty ≥ 2).
    case cloze
}

/// One 4-choice quiz question, fully resolved and ready to render. UI-agnostic:
/// it carries only strings + indices, no view state.
public struct Question: Sendable, Equatable, Identifiable {
    public let id: String              // stable per (sentence, type) — the sentence id
    public let sentenceId: String
    public let type: QuestionType
    /// What the learner reads. For sentenceChoice this is the EN sentence; for
    /// cloze it is the RU sentence with the target word replaced by "___".
    public let prompt: String
    /// A secondary line (EN translation for cloze; empty for sentenceChoice).
    public let subPrompt: String?
    /// The 4 answer options, already shuffled.
    public let options: [String]
    /// Index into `options` of the correct answer.
    public let correctIndex: Int
    /// The sentence's difficulty (1..3), carried for stats/telemetry.
    public let difficulty: Int

    public init(
        id: String,
        sentenceId: String,
        type: QuestionType,
        prompt: String,
        subPrompt: String?,
        options: [String],
        correctIndex: Int,
        difficulty: Int
    ) {
        self.id = id
        self.sentenceId = sentenceId
        self.type = type
        self.prompt = prompt
        self.subPrompt = subPrompt
        self.options = options
        self.correctIndex = correctIndex
        self.difficulty = difficulty
    }

    public var correctOption: String { options[correctIndex] }
}
