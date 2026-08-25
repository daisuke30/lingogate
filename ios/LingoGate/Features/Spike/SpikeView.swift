import SwiftUI
import FamilyControls

/// LINGO-003 実機Spike用のデバッグ1画面。
/// デザインは Phase 1後半 (LINGO-005) で作り直す前提。ここでは計測できることが最優先。
struct SpikeView: View {
    @StateObject private var vm = SpikeViewModel()
    @State private var showPicker = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    authSection
                    Divider()
                    selectionSection
                    #if !PHASE0
                    Divider()
                    shieldSection
                    #endif
                }
                .padding(20)
            }
            .navigationTitle("LingoGate Spike")
            .navigationBarTitleDisplayMode(.inline)
            .familyActivityPicker(
                isPresented: $showPicker,
                selection: Binding(
                    get: { vm.selection },
                    set: { vm.saveSelection($0) }
                )
            )
            .onAppear { vm.refreshAuthStatus() }
        }
    }

    // MARK: - ① 権限（Spikeの計測点）

    private var authSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("① Family Controls 権限")
                .font(.headline)

            HStack(spacing: 8) {
                Circle()
                    .fill(authColor)
                    .frame(width: 16, height: 16)
                Text(vm.authState.label)
                    .font(.system(.title2, weight: .bold))
            }

            Button {
                vm.requestAuthorization()
            } label: {
                HStack {
                    if vm.isRequesting { ProgressView().padding(.trailing, 4) }
                    Text("権限をリクエスト（requestAuthorization）")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .disabled(vm.isRequesting)

            if let error = vm.lastError {
                Text("エラー内容（← これがSpikeの結果）")
                    .font(.subheadline.bold())
                    .foregroundStyle(.red)
                Text(error)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var authColor: Color {
        switch vm.authState {
        case .approved:      return .green
        case .denied:        return .red
        case .notDetermined: return .orange
        case .unknown:       return .gray
        }
    }

    // MARK: - ② 対象アプリ選択

    private var selectionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("② 対象アプリを選択")
                .font(.headline)
            Text("選択件数: \(vm.selectionCount)（App / カテゴリ / Webドメインの合計）")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button {
                showPicker = true
            } label: {
                Text("FamilyActivityPicker を開く")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.bordered)
            .disabled(vm.authState != .approved)
            if vm.authState != .approved {
                Text("※ 権限が approved になると開けます")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - ③ シールド適用/解除

    private var shieldSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("③ シールド（遮断）")
                .font(.headline)
            Text("状態: \(vm.shieldStateText)")
                .font(.system(.title3, weight: .semibold))
            HStack(spacing: 12) {
                Button("シールド適用") { vm.applyShield() }
                    .buttonStyle(.borderedProminent)
                Button("シールド解除") { vm.clearShield() }
                    .buttonStyle(.bordered)
            }
            .disabled(vm.authState != .approved)
            Text("適用後、選択したアプリを開くと遮断画面「🔒 ロシア語10問で解除」が出れば成功。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

#Preview {
    SpikeView()
}
