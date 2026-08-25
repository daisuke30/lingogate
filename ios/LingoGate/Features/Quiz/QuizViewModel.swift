import Foundation
import QuizEngine

/// 1回のゲートセッション（10問）を駆動する。QuizEngine の GateController を接続。
/// LINGO-007: 出題UIは2モード。`quizMode`（起動時に GateState から固定で読む）で分岐:
/// - flashcard（既定）: `rate(_:)` でRatingを直接送る。フィードバック画面なし（裏面を見ること自体がフィードバック）。
/// - strict（4択・厳格モード）: 従来どおり `select(_:)` → `.feedback` フェーズ → `next()`。
@MainActor
final class QuizViewModel: ObservableObject {

    enum Phase: Equatable {
        case loading
        case question
        case feedback          // strict モードのみ: 回答直後の即時フィードバック表示中
        case complete
        case error(String)
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var question: Question?
    /// flashcard モードの表示対象（EN/RU/JA）。question と同じ head カードを指す。
    @Published private(set) var sentence: Sentence?
    /// 直前の回答で選んだ選択肢（strict モードのフィードバック表示に使う）。
    @Published private(set) var selectedIndex: Int?
    @Published private(set) var lastResult: SubmitResult?
    /// 何問（distinct）解き終わったか。プログレス n/10 用。
    @Published private(set) var resolvedCount = 0
    /// flashcard モード: 直前1枚を undo できるか。
    @Published private(set) var canUndo = false

    let totalCards: Int
    let quizMode: QuizMode
    private let services: AppServices
    private let context: GateContext
    private var controller: GateController?
    private var sessionStart = Date()
    private var questionShownAt = Date()

    /// セッション完了（全問非Again / 全問正答）の瞬間に1度だけ呼ばれる（coordinator に解除処理を委譲）。
    var onComplete: (() -> Void)?

    init(services: AppServices, context: GateContext) {
        self.services = services
        self.context = context
        self.totalCards = AppServices.sessionSize
        self.quizMode = GateState.quizMode
    }

    // MARK: - 派生値（完了画面）

    var firstTryCorrect: Int { controller?.runner.firstTryCorrect ?? 0 }
    var accuracy: Double {
        totalCards > 0 ? Double(firstTryCorrect) / Double(totalCards) : 0
    }
    var elapsed: TimeInterval { Date().timeIntervalSince(sessionStart) }
    /// automation モードの復帰先（あれば completion 画面にボタンを出す）。
    var returnAppKey: String? { context.returnAppKey }
    /// カードの安定識別子（Question.id はどちらのモードでも sentence.id と一致する）。
    /// View 側でフリップ/タイマー状態をキーする（`.onChange(of:)` / `.task(id:)`）。
    var currentCardID: String? { controller?.runner.currentQuestion?.id }

    // MARK: - ライフサイクル

    func start() {
        guard phase == .loading else { return }
        do {
            let now = Date()
            sessionStart = now
            let c = try services.makeGateController(appBundleID: context.returnAppKey, now: now)
            controller = c
            advanceToCurrent()
        } catch {
            phase = .error("クイズを準備できませんでした:\n\(String(reflecting: error))")
        }
    }

    // MARK: - 厳格モード（4択）

    /// 選択肢をタップ。回答を採点し、即時フィードバックへ。
    func select(_ index: Int) {
        guard quizMode == .strict, phase == .question, let controller else { return }
        let responseTime = Date().timeIntervalSince(questionShownAt)
        selectedIndex = index
        do {
            let result = try controller.runner.submit(
                choiceIndex: index, now: Date(), responseTime: responseTime
            )
            lastResult = result
            resolvedCount = controller.runner.resolvedCount
            phase = .feedback
        } catch {
            phase = .error("回答の記録に失敗しました:\n\(String(reflecting: error))")
        }
    }

    /// フィードバックの「次へ」。次問へ進む or 完了。
    func next() {
        guard phase == .feedback else { return }
        if lastResult?.sessionComplete == true {
            finishSession()
        } else {
            advanceToCurrent()
        }
    }

    // MARK: - フラッシュカードモード

    /// フリック確定時に呼ぶ。RatingをFSRSへ直接渡す（RatingMapper経由の正誤2値をやめる）。
    /// フィードバック画面は無し（裏返してRUを見ること自体がフィードバック）— 判定後は
    /// 即座に次カードへ進むか、完了処理に入る。
    func rate(_ rating: Rating) {
        guard quizMode == .flashcard, phase == .question, let controller else { return }
        do {
            let result = try controller.runner.submitRating(rating, now: Date())
            resolvedCount = controller.runner.resolvedCount
            canUndo = controller.runner.canUndo
            if result.sessionComplete {
                finishSession()
            } else {
                advanceToCurrent()
            }
        } catch {
            phase = .error("評価の記録に失敗しました:\n\(String(reflecting: error))")
        }
    }

    /// 「戻る」: 直前1枚の評価を取り消し、カードを表向き（未フリップ）で復元する。
    /// 誤フリック対策。セッション完了後（.complete）は呼べない —
    /// 完了時点で解除/抑制がすでに走っているため、取り消し対象外。
    func undo() {
        guard quizMode == .flashcard, phase == .question, let controller else { return }
        guard controller.runner.undoLastRating() else { return }
        resolvedCount = controller.runner.resolvedCount
        canUndo = controller.runner.canUndo
        advanceToCurrent()
    }

    // MARK: - 内部

    private func advanceToCurrent() {
        guard let controller else { return }
        selectedIndex = nil
        lastResult = nil
        if controller.runner.isComplete {
            phase = .complete
            return
        }
        question = controller.runner.currentQuestion
        sentence = controller.runner.currentSentence
        questionShownAt = Date()
        phase = .question
    }

    private func finishSession() {
        try? controller?.finish(now: Date(), unlocked: true)
        canUndo = false
        phase = .complete
        onComplete?()
    }
}
