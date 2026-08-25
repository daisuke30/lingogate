import SwiftUI
import QuizEngine

/// Anki式フラッシュカード1枚。表=EN文のみ。タップで裏返すとRU文＋JA訳（小さく）。
/// 裏返した状態で3方向フリック（右=Good/左=Again/下=Hard）→ `onRate` でFSRSのRatingを直接返す。
///
/// ゲート突破対策（設計・タスク合意）:
///  ① 裏返すまで評価不可 — ドラッグ検出自体を `canEvaluate`（後述）でゲートするので、
///     未フリップ時はそもそもドラッグに反応しない。
///  ② 裏返してから約1.5秒はフリック判定無効 — `canEvaluate` が立つまでドラッグは
///     完全に無反応（連打即フリックによる「嘘の自己申告」を強制的に減速させる）。
///     見た目には「フリップしたばかりのカードがまだ反応しない」だけなので不自然にならない。
struct FlashcardCardView: View {
    let sentence: Sentence
    /// カードの安定識別子。変わるたびに表向き・タイマーへリセットする
    /// （`vm.undo()` で前のカードに戻った場合も、これが変わるので自動的に正しくリセットされる）。
    let cardID: String
    let onRate: (Rating) -> Void

    private enum FlickDirection { case left, right, down }

    @State private var isFlipped = false
    @State private var showBackFace = false
    @State private var canEvaluate = false
    @State private var dragOffset: CGSize = .zero
    @State private var activeDirection: FlickDirection?

    private let flickThreshold: CGFloat = 90
    private let evaluateDelay: TimeInterval = 1.5

    var body: some View {
        VStack(spacing: 22) {
            card
            hint
            legend
        }
        // カードが変わったら（次のカード進行 or undo での巻き戻し、どちらも cardID が変わる）
        // 表向き・タイマーを必ずリセットする。
        .task(id: cardID) {
            isFlipped = false
            showBackFace = false
            canEvaluate = false
            dragOffset = .zero
            activeDirection = nil
        }
        // isFlipped が true になった瞬間から、裏面表示の切替とcanEvaluateの解禁を
        // `.task(id:)` に任せる。カードが変われば自動的にキャンセルされるので
        // 古いカードのタイマーが新しいカードへ紛れ込むことはない。
        .task(id: isFlipped) {
            guard isFlipped else { return }
            try? await Task.sleep(nanoseconds: 160_000_000)   // だいたい水平になる頃に裏面へ
            showBackFace = true
            let remaining = max(0, evaluateDelay - 0.16)
            try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            canEvaluate = true
        }
    }

    // MARK: - カード本体

    private var card: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22)
                .fill(Color(.secondarySystemBackground))
                .shadow(color: .black.opacity(0.10), radius: 12, y: 6)

            faceContent
                .padding(28)
                .frame(maxWidth: .infinity)
                // 裏面のミラー打ち消し（標準的なSwiftUIフリップテクニック）。
                .rotation3DEffect(.degrees(showBackFace ? 180 : 0), axis: (x: 0, y: 1, z: 0))

            directionOverlay
        }
        .frame(minHeight: 260)
        .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .offset(dragOffset)
        .rotationEffect(.degrees(Double(dragOffset.width / 24)))
        .animation(.easeInOut(duration: 0.32), value: isFlipped)
        .gesture(dragGesture)
        .onTapGesture {
            guard !isFlipped else { return }   // ①裏返すまで評価不可（＝一度きりのタップ操作）
            isFlipped = true
        }
        .accessibilityLabel(showBackFace ? "ロシア語文" : "英語文")
        .accessibilityHint(isFlipped ? "右にフリックで覚えている、左で忘れた、下で曖昧" : "タップで裏返す")
    }

    @ViewBuilder
    private var faceContent: some View {
        if showBackFace {
            VStack(spacing: 12) {
                Text("RU")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                Text(sentence.ru)
                    .font(.system(.title2, weight: .semibold))
                    .multilineTextAlignment(.center)
                if let ja = sentence.ja, !ja.isEmpty {
                    Text(ja)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
        } else {
            VStack(spacing: 12) {
                Text("EN")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                Text(sentence.en)
                    .font(.system(.title2, weight: .semibold))
                    .multilineTextAlignment(.center)
            }
        }
    }

    @ViewBuilder
    private var directionOverlay: some View {
        if let dir = activeDirection {
            RoundedRectangle(cornerRadius: 22)
                .fill(color(for: dir).opacity(0.22))
                .overlay(
                    Image(systemName: icon(for: dir))
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(color(for: dir))
                )
        }
    }

    // MARK: - ヒント文

    @ViewBuilder
    private var hint: some View {
        if !isFlipped {
            Text("タップして裏返す")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else if !canEvaluate {
            Text("少しお待ちください…")
                .font(.caption)
                .foregroundStyle(.tertiary)
        } else {
            Text("フリックで自己評価")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - フリック方向の凡例（操作の自己説明）

    private var legend: some View {
        HStack(spacing: 10) {
            legendChip(.left, icon: "arrow.left", label: "忘れた", color: .red)
            legendChip(.down, icon: "arrow.down", label: "曖昧", color: .orange)
            legendChip(.right, icon: "arrow.right", label: "覚えている", color: .green)
        }
    }

    private func legendChip(_ dir: FlickDirection, icon: String, label: String, color: Color) -> some View {
        let highlighted = activeDirection == dir
        return VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
            Text(label).font(.caption2)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .foregroundStyle(highlighted ? color : .secondary)
        .background(
            highlighted ? color.opacity(0.15) : Color(.tertiarySystemBackground),
            in: RoundedRectangle(cornerRadius: 10)
        )
        .animation(.easeOut(duration: 0.12), value: highlighted)
    }

    // MARK: - ジェスチャ

    private var dragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                // ①②の両方をここでゲート: 裏返す前 or 1.5秒以内はドラッグに一切反応しない。
                guard canEvaluate else { return }
                dragOffset = value.translation
                activeDirection = direction(for: value.translation, requireThreshold: false)
            }
            .onEnded { value in
                guard canEvaluate else { return }
                let committed = direction(for: value.translation, requireThreshold: true)
                withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                    dragOffset = .zero
                }
                activeDirection = nil
                if let dir = committed {
                    onRate(rating(for: dir))
                }
            }
    }

    private func direction(for translation: CGSize, requireThreshold: Bool) -> FlickDirection? {
        let dx = translation.width, dy = translation.height
        let threshold: CGFloat = requireThreshold ? flickThreshold : 20
        if abs(dx) >= abs(dy) {
            if dx > threshold { return .right }
            if dx < -threshold { return .left }
        } else if dy > threshold {
            return .down
        }
        return nil
    }

    private func rating(for dir: FlickDirection) -> Rating {
        switch dir {
        case .right: return .good
        case .left:  return .again
        case .down:  return .hard
        }
    }

    private func color(for dir: FlickDirection) -> Color {
        switch dir {
        case .right: return .green
        case .left:  return .red
        case .down:  return .orange
        }
    }

    private func icon(for dir: FlickDirection) -> String {
        switch dir {
        case .right: return "checkmark"
        case .left:  return "xmark"
        case .down:  return "questionmark"
        }
    }
}
