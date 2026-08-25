import SwiftUI
#if !PHASE0
import FamilyControls
#endif
import QuizEngine

/// 通常起動時のホーム。今日の学習状況サマリ＋対象アプリ選択＋モード/解除時間設定＋
/// ガイド導線＋クイズ開始。SpikeView は設定の奥の「診断」へ移動。
///
/// Phase 0（`PHASE0`）ビルドは Family Controls entitlement を持たないため、対象アプリ選択
/// （FamilyActivityPicker）と「今すぐロック」を出さない。代わりにオートメーション設定
/// ガイドへの導線を主役にする（LINGO-003: 無料 Personal Team は Family Controls 非対応）。
struct HomeView: View {
    let services: AppServices
    @ObservedObject var coordinator: GateCoordinator

    #if !PHASE0
    @State private var selection = AppSelectionStore.load()
    @State private var showPicker = false
    @State private var authApproved = AuthorizationCenter.shared.authorizationStatus == .approved
    #endif
    /// GateState は UserDefaults 直参照なので、画面再描画のトリガー用に保持する。
    @State private var mode = GateState.mode
    @State private var refreshToken = UUID()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let error = services.openError {
                        errorCard(error)
                    }
                    todayCard
                    #if PHASE0
                    phase0GuideCard
                    #else
                    targetAppsCard
                    #endif
                    startCard
                    settingsLinks
                }
                .padding(20)
                .id(refreshToken)
            }
            .navigationTitle(homeTitle)
            #if !PHASE0
            .familyActivityPicker(
                isPresented: $showPicker,
                selection: Binding(
                    get: { selection },
                    set: { newValue in
                        selection = newValue
                        AppSelectionStore.save(newValue)
                    }
                )
            )
            #endif
            .onAppear {
                #if !PHASE0
                selection = AppSelectionStore.load()
                authApproved = AuthorizationCenter.shared.authorizationStatus == .approved
                #endif
                mode = GateState.mode
                refreshToken = UUID()
            }
        }
    }

    private var homeTitle: String {
        #if PHASE0
        return "LingoGate (Phase 0)"
        #else
        return "LingoGate"
        #endif
    }

    // MARK: - 今日のサマリ

    private var todayCard: some View {
        let stats = services.todayStats()
        let progress = services.bandProgress()
        return VStack(alignment: .leading, spacing: 14) {
            Text("今日の学習")
                .font(.headline)
            HStack(spacing: 24) {
                summaryStat(value: "\(stats.sessions)", label: "ゲート回数")
                summaryStat(value: "\(stats.unlocked)", label: "解除")
                summaryStat(
                    value: stats.accuracy.map { "\(Int(($0 * 100).rounded()))%" } ?? "—",
                    label: "正答率"
                )
            }
            if let p = progress {
                Divider()
                bandRow(title: "語彙カバー率（band \(p.band)）",
                        value: p.coverage, detail: "\(p.seenWords)/\(p.coverageDenominator)語")
                bandRow(title: "定着率", value: p.retention, detail: nil)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func summaryStat(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title2.bold().monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func bandRow(title: String, value: Double, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title).font(.subheadline)
                Spacer()
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                Text("\(Int((value * 100).rounded()))%")
                    .font(.subheadline.monospacedDigit())
            }
            ProgressView(value: min(max(value, 0), 1))
        }
    }

    // MARK: - Phase 0 導線（shield無し・オートメーションが生命線）

    #if PHASE0
    private var phase0GuideCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Phase 0（オートメーションのみ）で動作中", systemImage: "wand.and.stars")
                .font(.headline)
            Text("このビルドは Family Controls 非搭載（無料 Personal Team は非対応）。ショートカットのオートメーションが対象アプリ→LingoGate→対象アプリ復帰の生命線です。未設定ならまずガイドどおりに1つ作成してください。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            NavigationLink {
                AutomationGuideView()
            } label: {
                Label("オートメーション設定ガイドを開く", systemImage: "arrow.right.circle.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }
    #endif

    // MARK: - 対象アプリ（shield モードのみ）

    #if !PHASE0
    private var targetAppsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ブロック対象アプリ")
                .font(.headline)
            Text(selectionSummary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button {
                showPicker = true
            } label: {
                Label("対象アプリを選ぶ", systemImage: "apps.iphone")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.bordered)
            .disabled(!authApproved && mode == .shield)

            if mode == .shield {
                Button {
                    ShieldController().apply(AppSelectionStore.load())
                    GateState.unlockedUntil = nil
                    refreshToken = UUID()
                } label: {
                    Label("今すぐロックする", systemImage: "lock.fill")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(!authApproved || selectionSummary == "未選択")
                Text("ロック後に対象アプリを開くと遮断され、10問解くと解除できます。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !authApproved && mode == .shield {
                Text("※ シールドには Family Controls の許可が必要です（設定 → 診断で確認）。")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private var selectionSummary: String {
        let count = selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
        return count == 0 ? "未選択" : "\(count) 件を選択中"
    }
    #endif

    // MARK: - クイズ開始

    private var startCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                coordinator.startManualGate()
            } label: {
                Label("ロシア語10問を解く", systemImage: "text.book.closed")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!services.isReady)
            Text(mode == .shield
                 ? "解くと対象アプリを \(GateState.unlockMinutes) 分だけ解除します。"
                 : "オートメーション経由なら対象アプリを開いた時に自動で割り込みます。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - 設定導線

    private var settingsLinks: some View {
        VStack(spacing: 0) {
            NavigationLink {
                SettingsView(onChange: { mode = GateState.mode; refreshToken = UUID() })
            } label: {
                linkRow(icon: "gearshape", title: "モード・解除時間の設定",
                        subtitle: "\(mode.title) / \(GateState.unlockMinutes)分")
            }
            Divider()
            NavigationLink {
                AutomationGuideView()
            } label: {
                linkRow(icon: "wand.and.stars", title: "オートメーション設定ガイド",
                        subtitle: "ショートカットで摩擦をなくす")
            }
        }
        .padding(.vertical, 4)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func linkRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).foregroundStyle(.primary)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private func errorCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("コンテンツDBの読み込みに問題", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.bold())
                .foregroundStyle(.orange)
            Text(message)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
    }
}
