import Foundation
import DeviceActivity
import ManagedSettings

/// shield モードの解除フローを担う。
///
/// 解除は「二重化」で確実性を担保する（設計 §4.3 / タスク指示）:
///  1. **App Group タイムスタンプ（`GateState.unlockedUntil`）が真実**。本体アプリが
///     フォアグラウンド復帰するたびに期限超過を判定して再シールドする（最も確実）。
///  2. **DeviceActivity のインターバル監視**を補助として張り、`intervalDidEnd` で
///     `DeviceActivityMonitorExt` が再シールドする（アプリを開かなくても効く）。
///
/// 割り切り: DeviceActivity のスケジュールは最小 15 分の粒度制約があり、5/10 分の
/// ちょうどの再シールドはインターバル監視だけでは保証されない。そのため上記1（タイムスタンプ＋
/// フォアグラウンド再チェック）を主、2を副とする。5/10 分でも「対象アプリを閉じて
/// LingoGate に戻る／別アプリに切り替える」時点で再シールドが確定する。
struct UnlockController {
    static let activityName = DeviceActivityName("tech.inoma.lingogate.unlock")

    private let center = DeviceActivityCenter()
    private let store = ManagedSettingsStore(named: .lingoGate)

    /// 対象アプリのシールドを解除し、`minutes` 後に自動再シールドを仕込む。
    func unlock(minutes: Int, now: Date = Date()) {
        // 1. 即時解除。
        clearShield()

        // 2. 解除ウィンドウを App Group に記録（フォアグラウンド再チェックの基準＝主系）。
        let until = now.addingTimeInterval(TimeInterval(minutes * 60))
        GateState.unlockedUntil = until

        // 3. DeviceActivity で [now, until] を監視（副系）。失敗しても主系が担保するので握りつぶす。
        center.stopMonitoring([Self.activityName])
        let cal = Calendar.current
        let start = cal.dateComponents([.hour, .minute, .second], from: now)
        let end = cal.dateComponents([.hour, .minute, .second], from: until)
        let schedule = DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false)
        try? center.startMonitoring(Self.activityName, during: schedule)
    }

    /// フォアグラウンド復帰時などの再チェック。解除ウィンドウを過ぎていれば再シールドする。
    /// - Returns: 再シールドしたら true。
    @discardableResult
    func reshieldIfExpired(now: Date = Date()) -> Bool {
        guard let until = GateState.unlockedUntil else { return false }
        guard now >= until else { return false }
        reshieldNow()
        return true
    }

    /// 保存済み選択に対して即時再シールドし、解除状態をクリアする。
    func reshieldNow() {
        applyShield()
        GateState.unlockedUntil = nil
        center.stopMonitoring([Self.activityName])
    }

    /// 解除中かどうか。
    var isUnlocked: Bool {
        guard let until = GateState.unlockedUntil else { return false }
        return Date() < until
    }

    // MARK: - シールド適用/解除（AppSelectionStore の選択を対象に）

    private func applyShield() {
        let selection = AppSelectionStore.load()
        store.shield.applications =
            selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
        store.shield.applicationCategories =
            selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
        store.shield.webDomains =
            selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
    }

    private func clearShield() {
        store.shield.applications = nil
        store.shield.applicationCategories = nil
        store.shield.webDomains = nil
    }
}
