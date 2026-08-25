import Foundation
import ManagedSettings

/// 本体アプリと各Extensionが共有する定数・ストア識別子。
/// App Group を介して FamilyActivitySelection やシールド状態を跨いで参照する。
enum AppGroup {
    /// App Group 識別子。全ターゲットの entitlements と一致させること。
    static let identifier = "group.tech.inoma.lingogate"

    /// App Group 共有の UserDefaults。suite生成に失敗した場合は標準にフォールバック（開発時の保険）。
    ///
    /// Phase 0（`PHASE0`）ビルドは App Group entitlement を持たない（拡張を1つも埋め込まないため
    /// 共有の必要がない）。suite 生成を試みず最初から標準を使う。
    static var userDefaults: UserDefaults {
        #if PHASE0
        return .standard
        #else
        return UserDefaults(suiteName: identifier) ?? .standard
        #endif
    }
}

extension ManagedSettingsStore.Name {
    /// LingoGate が使う ManagedSettingsStore の名前。
    /// 本体アプリ・DeviceActivityMonitor 双方が同じ store を参照するために名前付きで固定する。
    static let lingoGate = Self("LingoGateShield")
}
