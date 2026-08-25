import SwiftUI
import QuizEngine

/// ゲートのクイズ画面。fullScreenCover として提示される。LINGO-007で出題UIが2モード:
/// - flashcard（既定）: EN表→タップで裏返しRU/JA→3方向フリックで自己評価（Again/Hard/Good）。
/// - strict（4択・厳格モード）: 従来どおりEN文提示→RU 4択→即時フィードバック。
/// どちらも10問完了で解除。
struct QuizView: View {
    let context: GateContext
    let services: AppServices
    @ObservedObject var coordinator: GateCoordinator

    @StateObject private var vm: QuizViewModel

    init(context: GateContext, services: AppServices, coordinator: GateCoordinator) {
        self.context = context
        self.services = services
        self.coordinator = coordinator
        _vm = StateObject(wrappedValue: QuizViewModel(services: services, context: context))
    }

    var body: some View {
        NavigationStack {
            content
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("閉じる") { coordinator.dismissGate() }
                            .font(.subheadline)
                    }
                }
        }
        .onAppear {
            vm.onComplete = {
                coordinator.completeGate(context, unlockMinutes: GateState.unlockMinutes)
            }
            vm.start()
        }
        .interactiveDismissDisabled(vm.phase != .complete)
    }

    @ViewBuilder
    private var content: some View {
        switch vm.phase {
        case .loading:
            ProgressView("準備中…").frame(maxWidth: .infinity, minHeight: 300)
        case .error(let message):
            errorView(message)
        case .complete:
            completionView
        case .question, .feedback:
            if vm.quizMode == .flashcard {
                flashcardBody
            } else {
                quizBody
            }
        }
    }

    // MARK: - フラッシュカード本体（既定）

    private var flashcardBody: some View {
        VStack(alignment: .leading, spacing: 20) {
            progressHeader
            Spacer(minLength: 0)
            if let s = vm.sentence, let id = vm.currentCardID {
                FlashcardCardView(sentence: s, cardID: id) { rating in
                    vm.rate(rating)
                }
            }
            Spacer(minLength: 0)
            if vm.canUndo {
                Button {
                    vm.undo()
                } label: {
                    Label("戻る（直前の評価を取り消す）", systemImage: "arrow.uturn.backward")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: - 厳格モード（4択）本体

    private var quizBody: some View {
        VStack(alignment: .leading, spacing: 24) {
            progressHeader
            if let q = vm.question {
                promptCard(q)
                optionList(q)
            }
            Spacer(minLength: 0)
            if vm.phase == .feedback {
                feedbackFooter
            }
        }
    }

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("ロシア語ゲート")
                    .font(.headline)
                Spacer()
                Text("\(vm.resolvedCount) / \(vm.totalCards)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: Double(vm.resolvedCount), total: Double(vm.totalCards))
                .tint(.accentColor)
        }
    }

    private func promptCard(_ q: Question) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(q.type == .cloze ? "空欄に入る語を選ぶ" : "正しいロシア語を選ぶ")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(q.prompt)
                .font(.system(.title2, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            if let sub = q.subPrompt, !sub.isEmpty {
                Text(sub)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func optionList(_ q: Question) -> some View {
        VStack(spacing: 12) {
            ForEach(Array(q.options.enumerated()), id: \.offset) { index, option in
                Button {
                    vm.select(index)
                } label: {
                    HStack {
                        Text(option)
                            .font(.system(.body, weight: .medium))
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let symbol = optionSymbol(q, index) {
                            Image(systemName: symbol.name)
                                .foregroundStyle(symbol.color)
                        }
                    }
                    .padding(.vertical, 14)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
                    .background(optionBackground(q, index),
                                in: RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(optionBorder(q, index), lineWidth: 1.5)
                    )
                }
                .buttonStyle(.plain)
                .disabled(vm.phase == .feedback)
            }
        }
    }

    // MARK: - フィードバックの色計算

    private func isReveal(_ q: Question) -> Bool { vm.phase == .feedback }

    private func optionBackground(_ q: Question, _ index: Int) -> Color {
        guard isReveal(q) else { return Color(.tertiarySystemBackground) }
        if index == q.correctIndex { return .green.opacity(0.18) }
        if index == vm.selectedIndex { return .red.opacity(0.15) }
        return Color(.tertiarySystemBackground)
    }

    private func optionBorder(_ q: Question, _ index: Int) -> Color {
        guard isReveal(q) else { return Color(.separator) }
        if index == q.correctIndex { return .green }
        if index == vm.selectedIndex { return .red }
        return Color(.separator)
    }

    private func optionSymbol(_ q: Question, _ index: Int) -> (name: String, color: Color)? {
        guard isReveal(q) else { return nil }
        if index == q.correctIndex { return ("checkmark.circle.fill", .green) }
        if index == vm.selectedIndex { return ("xmark.circle.fill", .red) }
        return nil
    }

    private var feedbackFooter: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let result = vm.lastResult {
                if result.correct {
                    Label("正解", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.headline)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("不正解", systemImage: "xmark.circle.fill")
                            .foregroundStyle(.red)
                            .font(.headline)
                        Text("この問題はセッション内でもう一度出ます。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Button {
                vm.next()
            } label: {
                Text(vm.lastResult?.sessionComplete == true ? "解除する" : "次の問題へ")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(.top, 4)
    }

    // MARK: - 完了画面

    private var completionView: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "lock.open.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)
            Text("解除しました")
                .font(.largeTitle.bold())
            Text(unlockMessage)
                .font(.headline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 28) {
                stat(title: accuracyLabel, value: "\(Int((vm.accuracy * 100).rounded()))%")
                stat(title: "所要時間", value: formattedElapsed)
                stat(title: "問題数", value: "\(vm.totalCards)")
            }
            .padding(.vertical, 8)

            Spacer()

            VStack(spacing: 12) {
                if let key = vm.returnAppKey {
                    Button {
                        coordinator.openReturnApp(key)
                        coordinator.dismissGate()
                    } label: {
                        Label("\(ReturnAppMap.displayName(forKey: key)) に戻る",
                              systemImage: "arrow.uturn.backward")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                }
                Button("閉じる") { coordinator.dismissGate() }
                    .font(.body)
            }
        }
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
    }

    private var unlockMessage: String {
        let minutes = GateState.unlockMinutes
        switch GateState.mode {
        case .shield:
            return "\(minutes)分間、対象アプリを開けます。\n時間切れで自動的に再びロックされます。"
        case .automationOnly:
            return "\(minutes)分間はクイズなしで対象アプリを開けます。"
        }
    }

    private var accuracyLabel: String {
        vm.quizMode == .flashcard ? "既知率" : "正答率"
    }

    private func stat(title: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(.title3.bold().monospacedDigit())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var formattedElapsed: String {
        let total = Int(vm.elapsed.rounded())
        let m = total / 60, s = total % 60
        return m > 0 ? "\(m)分\(s)秒" : "\(s)秒"
    }

    // MARK: - エラー

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 44))
                .foregroundStyle(.orange)
            Text(message)
                .font(.system(.footnote, design: .monospaced))
                .textSelection(.enabled)
                .multilineTextAlignment(.leading)
            Button("閉じる") { coordinator.dismissGate() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, minHeight: 300)
    }
}
