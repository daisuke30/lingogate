import DeviceActivity
import ManagedSettings
import Foundation

/// 解除タイマーの時間切れなどに反応して再シールドを掛けるためのフック。
/// Phase 1後半で、本体アプリが登録する DeviceActivitySchedule と連動させる。
/// 現時点は骨格（保存済み選択への再シールドの雛形）まで。
final class DeviceActivityMonitorExtension: DeviceActivityMonitor {

    private let store = ManagedSettingsStore(named: .lingoGate)

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // 解除ウィンドウ終了 → 再シールドし、App Group の解除状態をクリアする。
        // （本体アプリの UnlockController が張る tech.inoma.lingogate.unlock インターバルの終端）
        reshield()
        GateState.unlockedUntil = nil
    }

    override func eventDidReachThreshold(
        _ event: DeviceActivityEvent.Name,
        activity: DeviceActivityName
    ) {
        super.eventDidReachThreshold(event, activity: activity)
    }

    /// App Group に保存された選択内容で、シールドを再適用する。
    private func reshield() {
        let selection = AppSelectionStore.load()
        store.shield.applications =
            selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
        store.shield.applicationCategories =
            selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
        store.shield.webDomains =
            selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
    }
}
