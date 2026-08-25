import Foundation
import SwiftUI
import FamilyControls

/// LINGO-003 実機Spikeの計測ロジック。
/// - Family Controls の権限リクエスト（成否とエラーを保持）
/// - 対象アプリ選択の保存
/// - シールドの適用/解除
@MainActor
final class SpikeViewModel: ObservableObject {

    enum AuthState {
        case notDetermined
        case approved
        case denied
        case unknown

        var label: String {
            switch self {
            case .notDetermined: return "notDetermined（未確認）"
            case .approved:      return "approved（許可済み）"
            case .denied:        return "denied（拒否）"
            case .unknown:       return "unknown"
            }
        }
    }

    @Published private(set) var authState: AuthState = .notDetermined
    /// requestAuthorization が失敗したときのエラー全文。Spikeの最重要計測点。
    @Published private(set) var lastError: String?
    @Published var selection = AppSelectionStore.load()
    @Published private(set) var shieldStateText = "未適用"
    @Published private(set) var isRequesting = false

    private let shield = ShieldController()

    init() {
        refreshAuthStatus()
    }

    /// 現在の権限状態を読み直す。
    func refreshAuthStatus() {
        let status = AuthorizationCenter.shared.authorizationStatus
        switch status {
        case .approved:      authState = .approved
        case .denied:        authState = .denied
        case .notDetermined: authState = .notDetermined
        @unknown default:
            // iOS 26.4 で追加された .approvedWithDataAccess など、将来の許可系ケースも
            // approved として扱う（弾かれ判定を誤らないため）。
            // deployment target が iOS 17 のため case を直接書けず、@unknown default 内で判定する。
            if #available(iOS 26.4, *), status == .approvedWithDataAccess {
                authState = .approved
            } else {
                authState = .unknown
            }
        }
    }

    /// Family Controls の権限をリクエストする。
    /// 無料 Personal Team で弾かれる場合、ここで捕捉したエラー内容がSpikeの結果になる。
    func requestAuthorization() {
        lastError = nil
        isRequesting = true
        Task {
            defer { isRequesting = false }
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            } catch {
                // localizedDescription だけでは情報が薄いため、生の error も残す。
                lastError = "requestAuthorization 失敗\n\(error.localizedDescription)\n\n---\n\(String(reflecting: error))"
            }
            refreshAuthStatus()
        }
    }

    /// Picker の選択結果を保存する（App Group の UserDefaults へ）。
    func saveSelection(_ newSelection: FamilyActivitySelection) {
        selection = newSelection
        AppSelectionStore.save(newSelection)
    }

    var selectionCount: Int {
        selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
    }

    func applyShield() {
        shield.apply(selection)
        shieldStateText = selectionCount == 0
            ? "適用（対象0件 — Pickerで選択してください）"
            : "適用中（対象 \(selectionCount) 件）"
    }

    func clearShield() {
        shield.clear()
        shieldStateText = "解除済み"
    }
}
