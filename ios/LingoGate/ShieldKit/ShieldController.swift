import Foundation
import ManagedSettings
import FamilyControls

/// ManagedSettingsStore を薄くラップし、選択されたアプリ/カテゴリ/Webドメインに
/// シールド（遮断画面）を適用・解除する。
///
/// Phase 1 では本体アプリのデバッグUIから手動で呼ぶ。将来はクイズ完了/タイマー終了と連動させる。
struct ShieldController {
    private let store = ManagedSettingsStore(named: .lingoGate)

    /// 選択内容にシールドを適用する。空カテゴリ/空集合は nil にして「無制限」を明示する。
    func apply(_ selection: FamilyActivitySelection) {
        store.shield.applications =
            selection.applicationTokens.isEmpty ? nil : selection.applicationTokens

        store.shield.applicationCategories =
            selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)

        store.shield.webDomains =
            selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
    }

    /// すべてのシールドを解除する。
    func clear() {
        store.shield.applications = nil
        store.shield.applicationCategories = nil
        store.shield.webDomains = nil
    }
}
