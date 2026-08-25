import ManagedSettings
import UIKit

/// 遮断画面のボタン押下に応答する。
/// iOSの制約でシールドから自アプリを直接起動できないため、Phase 1では両ボタンとも .close。
/// 本体アプリへの自動遷移は「ショートカット・オートメーション」で補う（設計書 §4.3）。
final class ShieldActionExtension: ShieldActionDelegate {

    override func handle(
        action: ShieldAction,
        for application: ApplicationToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        switch action {
        case .primaryButtonPressed:
            // TODO(LINGO Phase1後半): オートメーション誘導の計測フックをここに足す。
            completionHandler(.close)
        case .secondaryButtonPressed:
            completionHandler(.close)
        @unknown default:
            completionHandler(.close)
        }
    }

    override func handle(
        action: ShieldAction,
        for webDomain: WebDomainToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        completionHandler(.close)
    }

    override func handle(
        action: ShieldAction,
        for category: ActivityCategoryToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        completionHandler(.close)
    }
}
