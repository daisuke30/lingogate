import Foundation

/// Policy controlling which question format is used and how strict distractor
/// selection is.
public struct QuestionPolicy: Sendable {
    /// Sentences at or above this difficulty may become cloze questions.
    public var clozeMinDifficulty: Int
    /// Probability (0…1) that an eligible sentence becomes cloze rather than
    /// sentence-choice. 0.5 = "mix" per the design.
    public var clozeMixProbability: Double
    /// Reject a whole-sentence distractor whose lemma set overlaps the answer's
    /// by more than this Jaccard ratio (guards against near-synonymous options
    /// that a learner couldn't fairly distinguish).
    public var maxLemmaOverlap: Double
    /// How many candidate sentences/words to pull when searching for distractors.
    public var poolSize: Int

    public init(
        clozeMinDifficulty: Int = 2,
        clozeMixProbability: Double = 0.5,
        maxLemmaOverlap: Double = 0.6,
        poolSize: Int = 40
    ) {
        self.clozeMinDifficulty = clozeMinDifficulty
        self.clozeMixProbability = clozeMixProbability
        self.maxLemmaOverlap = maxLemmaOverlap
        self.poolSize = poolSize
    }

    public static let `default` = QuestionPolicy()
}

public enum QuestionBuildError: Error {
    /// Not enough distractors exist in the deck to make a 4-choice question.
    case insufficientDistractors(sentenceId: String)
}

/// Builds a `Question` (4 choices) from a `Sentence`, drawing distractors from
/// the same band / same POS via a `ContentStore`. Randomness flows through an
/// injected `SeededRNG`, so a fixed seed yields identical questions.
public struct QuestionBuilder {
    public let store: ContentStore
    public let deckId: Int
    public let policy: QuestionPolicy

    public init(store: ContentStore, deckId: Int, policy: QuestionPolicy = .default) {
        self.store = store
        self.deckId = deckId
        self.policy = policy
    }

    /// Build a question for `sentence`. If `forcedType` is given it is honoured
    /// when buildable, otherwise the policy decides (difficulty ≥ threshold →
    /// possibly cloze, else sentence-choice). Cloze silently falls back to
    /// sentence-choice when the sentence has no blankable word with enough
    /// same-POS distractors.
    public func build(
        for sentence: Sentence,
        forcedType: QuestionType? = nil,
        rng: inout SeededRNG
    ) throws -> Question {
        let wantCloze: Bool
        if let forced = forcedType {
            wantCloze = (forced == .cloze)
        } else if sentence.difficulty >= policy.clozeMinDifficulty {
            wantCloze = Double.random(in: 0..<1, using: &rng) < policy.clozeMixProbability
        } else {
            wantCloze = false
        }

        if wantCloze, let q = try buildCloze(for: sentence, rng: &rng) {
            return q
        }
        return try buildSentenceChoice(for: sentence, rng: &rng)
    }

    // MARK: - Sentence-choice

    func buildSentenceChoice(for sentence: Sentence, rng: inout SeededRNG) throws -> Question {
        let correctLemmas = try store.wordIDs(forSentence: sentence.id)
        let pool = try store.sentenceDistractorPool(
            deckId: deckId, band: sentence.band, excluding: sentence.id,
            targetLength: sentence.ru.count, limit: policy.poolSize
        )

        var distractors: [Sentence] = []
        var deferred: [Sentence] = []   // over-overlap candidates kept as fallback
        var usedRU: Set<String> = [sentence.ru]

        for cand in pool {
            if usedRU.contains(cand.ru) { continue }
            let candLemmas = try store.wordIDs(forSentence: cand.id)
            let overlap = jaccard(correctLemmas, candLemmas)
            if overlap <= policy.maxLemmaOverlap {
                distractors.append(cand)
                usedRU.insert(cand.ru)
                if distractors.count == 3 { break }
            } else {
                deferred.append(cand)
            }
        }
        // Relax the overlap guard only if we couldn't find 3 clean distractors.
        var di = 0
        while distractors.count < 3 && di < deferred.count {
            let cand = deferred[di]; di += 1
            if usedRU.contains(cand.ru) { continue }
            distractors.append(cand)
            usedRU.insert(cand.ru)
        }
        guard distractors.count == 3 else {
            throw QuestionBuildError.insufficientDistractors(sentenceId: sentence.id)
        }

        var options = [sentence.ru] + distractors.map(\.ru)
        options.shuffle(using: &rng)
        let correctIndex = options.firstIndex(of: sentence.ru)!

        return Question(
            id: sentence.id, sentenceId: sentence.id, type: .sentenceChoice,
            prompt: sentence.en, subPrompt: nil,
            options: options, correctIndex: correctIndex, difficulty: sentence.difficulty
        )
    }

    // MARK: - Cloze

    /// Returns nil (caller falls back to sentence-choice) if no word in the
    /// sentence can be located in its surface AND backed by ≥3 same-POS
    /// distractors.
    func buildCloze(for sentence: Sentence, rng: inout SeededRNG) throws -> Question? {
        let contentPOS: Set<String> = ["noun", "verb", "adj", "adv"]
        let words = try store.words(forSentence: sentence.id)
            .filter { contentPOS.contains($0.pos) }

        // Build the list of viable (word, surfaceToken) targets.
        var candidates: [(word: Word, surface: String, distractors: [Word])] = []
        for w in words {
            guard let surface = locateSurface(of: w.lemma, in: sentence.ru) else { continue }
            let pool = try store.wordDistractorPool(
                deckId: deckId, band: w.band, pos: w.pos, excluding: w.id, limit: policy.poolSize
            )
            // Distinct lemmas, not equal to the answer.
            var seen: Set<String> = [w.lemma]
            var picks: [Word] = []
            for d in pool where !seen.contains(d.lemma) {
                picks.append(d); seen.insert(d.lemma)
                if picks.count == 3 { break }
            }
            if picks.count == 3 {
                candidates.append((w, surface, picks))
            }
        }
        guard !candidates.isEmpty else { return nil }

        let chosen = candidates.randomElement(using: &rng)!
        let blanked = replaceFirst(chosen.surface, with: "___", in: sentence.ru)

        var options = [chosen.word.lemma] + chosen.distractors.map(\.lemma)
        options.shuffle(using: &rng)
        let correctIndex = options.firstIndex(of: chosen.word.lemma)!

        return Question(
            id: sentence.id, sentenceId: sentence.id, type: .cloze,
            prompt: blanked, subPrompt: sentence.en,
            options: options, correctIndex: correctIndex, difficulty: sentence.difficulty
        )
    }

    // MARK: - Heuristics

    /// Jaccard overlap of two lemma-id sets. 0 when both empty.
    func jaccard(_ a: Set<Int>, _ b: Set<Int>) -> Double {
        if a.isEmpty && b.isEmpty { return 0 }
        let inter = a.intersection(b).count
        let union = a.union(b).count
        return union == 0 ? 0 : Double(inter) / Double(union)
    }

    /// Find the surface token in `text` for `lemma`. Russian inflects heavily, so
    /// we accept an exact (case-insensitive) match, or a token sharing a stem
    /// prefix with the lemma. Returns the original-cased token (with punctuation
    /// stripped) so it can be replaced, or nil if nothing matches.
    func locateSurface(of lemma: String, in text: String) -> String? {
        let lemmaLower = lemma.lowercased()
        let stemLen = max(3, lemmaLower.count - 2)
        let stem = String(lemmaLower.prefix(stemLen))

        let tokens = text.split { $0 == " " || $0 == "\n" }.map(String.init)
        for raw in tokens {
            let token = raw.trimmingCharacters(in: punctuation)
            guard !token.isEmpty else { continue }
            let lower = token.lowercased()
            if lower == lemmaLower { return token }
            if lower.count >= stemLen && lower.hasPrefix(stem) { return token }
        }
        return nil
    }

    private let punctuation = CharacterSet(charactersIn: ".,!?;:—-«»\"'()…")

    /// Replace the first whitespace-delimited occurrence of `surface` (matched on
    /// its punctuation-stripped core) with `replacement`, preserving trailing
    /// punctuation like the sentence-final period.
    func replaceFirst(_ surface: String, with replacement: String, in text: String) -> String {
        var parts = text.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        for i in parts.indices {
            let core = parts[i].trimmingCharacters(in: punctuation)
            if core.caseInsensitiveCompare(surface) == .orderedSame {
                // Keep any trailing punctuation attached to the token.
                let trailing = parts[i].hasSuffix(".") ? "."
                    : (parts[i].hasSuffix(",") ? "," : (parts[i].hasSuffix("?") ? "?" : ""))
                parts[i] = replacement + trailing
                return parts.joined(separator: " ")
            }
        }
        return text.replacingOccurrences(of: surface, with: replacement)
    }
}
