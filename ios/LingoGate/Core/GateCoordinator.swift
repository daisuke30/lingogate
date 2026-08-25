import Foundation
import SwiftUI
import UIKit

/// 進行中のゲート1件のコンテキスト。fullScreenCover(item:) 用に Identifiable。
struct GateContext: Identifiable {
    enum Trigger { case manual, automation }
    let id = UUID()
    /// automationOnly 復帰先の appKey（例: "tiktok"）。手動起動・復帰先不明時は nil。
    let returnAppKey: String?
    let trigger: Trigger
}

/// 画面遷移とゲートのライフサイクルを統括する。
/// - `lingogate://gate?return=<appKey>` の受信 → クイズ起動（または抑制中なら即復帰）
/// - ホームからの手動起動
/// - クイズ完了時のモード別解除処理（shield: 一時解除 / automation: 抑制＋対象アプリ復帰）
@MainActor
final class GateCoordinator: ObservableObject {
    @Published var activeGate: GateContext?

    private let unlock = UnlockController()

    // MARK: - 起動

    /// URL スキームからのゲート起動。`lingogate://gate?return=tiktok`。
    func handleURL(_ url: URL) {
        guard url.scheme == "lingogate", url.host == "gate" else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let returnKey = comps?.queryItems?
            .first(where: { $0.name == "return" })?.value?
            .lowercased()

        // automationOnly の抑制ウィンドウ内なら、クイズを飛ばして即復帰。
        if GateState.mode == .automationOnly,
           let key = returnKey,
           GateState.isAutomationSuppressed(appKey: key) {
            openReturnApp(key)
            return
        }
        activeGate = GateContext(returnAppKey: returnKey, trigger: .automation)
    }

    /// ホーム画面の「10問解いて解除」ボタン等からの手動起動。
    func startManualGate() {
        activeGate = GateContext(returnAppKey: nil, trigger: .manual)
    }

    // MARK: - 完了

    /// クイズ全問正答時に呼ぶ。モードに応じて解除する。
    /// - shield: 対象アプリを一時解除し、自動再シールドを仕込む。
    /// - automationOnly: 復帰先の再トリガー抑制ウィンドウを張る（復帰は completion 画面のボタン）。
    func completeGate(_ context: GateContext, unlockMinutes: Int, now: Date = Date()) {
        switch GateState.mode {
        case .shield:
            unlock.unlock(minutes: unlockMinutes, now: now)
        case .automationOnly:
            if let key = context.returnAppKey {
                GateState.setAutomationSuppress(
                    appKey: key,
                    until: now.addingTimeInterval(TimeInterval(unlockMinutes * 60))
                )
            }
        }
    }

    func dismissGate() { activeGate = nil }

    // MARK: - 対象アプリ復帰

    /// appKey の候補スキームを順に試して対象アプリを開く。
    func openReturnApp(_ key: String) {
        let candidates = ReturnAppMap.urls(forKey: key)
        for url in candidates where UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
            return
        }
        if let first = candidates.first {
            UIApplication.shared.open(first)   // canOpenURL が false でも一応試す
        }
    }

    // MARK: - shield 再シールド backstop

    /// フォアグラウンド復帰時に呼ぶ。shield モードで解除ウィンドウを過ぎていれば再シールド。
    func reshieldIfExpired() {
        guard GateState.mode == .shield else { return }
        unlock.reshieldIfExpired()
    }
}
