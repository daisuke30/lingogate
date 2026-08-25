import Foundation

/// ゲートの遮断方式。設計書 §4.3 の二段構え。
/// - shield: FamilyControls のシールドで遮断（本命の強制力）。クイズ完了で一時解除→自動再シールド。
/// - automationOnly: シールドを使わず、ショートカット・オートメーションが lingogate:// を開く方式
///   （Phase 0 fallback。無料アカウントで Family Controls が弾かれた場合の退避先）。
public enum GateMode: String, Sendable, CaseIterable {
    case shield
    case automationOnly

    public var title: String {
        switch self {
        case .shield:          return "シールド（本命）"
        case .automationOnly:  return "オートメーションのみ（Phase 0）"
        }
    }

    public var detail: String {
        switch self {
        case .shield:
            return "対象アプリをシールドで遮断し、10問解くと一定時間だけ解除。時間切れで自動再シールド。"
        case .automationOnly:
            return "ショートカットのオートメーションで LingoGate を割り込ませ、10問解くと対象アプリへ戻る。無料アカウント・entitlement不要。"
        }
    }
}

/// 出題UI。LINGO-007（勝田のdogfoodフィードバック、2026-07-04）で追加。
/// - flashcard: Anki式フラッシュカード（表=EN、裏=RU+JA、3方向フリックで自己評価）。既定。
/// - strict: 従来の4択（sentenceChoice/cloze）。厳格モードとして温存。
public enum QuizMode: String, Sendable, CaseIterable {
    case flashcard
    case strict

    public var title: String {
        switch self {
        case .flashcard: return "フラッシュカード（既定）"
        case .strict:    return "厳格モード（4択）"
        }
    }

    public var detail: String {
        switch self {
        case .flashcard:
            return "EN文をタップで裏返しRU文を確認 → 覚えている/曖昧/忘れたをフリックで自己評価。FSRSに直接反映される。"
        case .strict:
            return "EN文に対しRU4択から選ぶ従来方式。自己評価より機械的に採点したい場合向け。"
        }
    }
}

/// 本体アプリと Extension が App Group UserDefaults 越しに共有するゲート状態。
/// 純 Foundation のみ（Extension からも読めるよう SwiftUI / DeviceActivity を持ち込まない）。
public enum GateState {
    private static var defaults: UserDefaults { AppGroup.userDefaults }

    private enum Key {
        static let mode = "gate.mode"
        static let quizMode = "gate.quizMode"
        static let unlockMinutes = "gate.unlockMinutes"
        static let unlockedUntil = "gate.unlockedUntil"       // shield: 解除ウィンドウ終了時刻
        static let suppressPrefix = "gate.suppressUntil."     // automation: appKey 別の再トリガー抑制
    }

    /// 選べる解除時間（分）。設計 §4.2。
    public static let unlockDurationChoices = [5, 10, 15, 30]

    // MARK: - モード

    public static var mode: GateMode {
        get {
            #if PHASE0
            // Phase 0 ビルドは Family Controls entitlement を持たないため、
            // 保存値に関わらず常に automationOnly に固定する（LINGO-003: 無料 Personal
            // Team は Family Controls 非対応と判明したための退避ターゲット）。
            return .automationOnly
            #else
            return GateMode(rawValue: defaults.string(forKey: Key.mode) ?? "") ?? .shield
            #endif
        }
        set { defaults.set(newValue.rawValue, forKey: Key.mode) }
    }

    // MARK: - 出題UI（flashcard既定 / strict=4択・厳格モード）

    public static var quizMode: QuizMode {
        get { QuizMode(rawValue: defaults.string(forKey: Key.quizMode) ?? "") ?? .flashcard }
        set { defaults.set(newValue.rawValue, forKey: Key.quizMode) }
    }

    // MARK: - 解除時間（分）

    public static var unlockMinutes: Int {
        get {
            let v = defaults.integer(forKey: Key.unlockMinutes)
            return unlockDurationChoices.contains(v) ? v : 10   // 既定 10 分
        }
        set { defaults.set(newValue, forKey: Key.unlockMinutes) }
    }

    // MARK: - shield: 解除ウィンドウ

    /// 解除が有効な終了時刻。nil＝解除していない（シールド中）。
    public static var unlockedUntil: Date? {
        get {
            let t = defaults.double(forKey: Key.unlockedUntil)
            return t > 0 ? Date(timeIntervalSince1970: t) : nil
        }
        set {
            if let d = newValue { defaults.set(d.timeIntervalSince1970, forKey: Key.unlockedUntil) }
            else { defaults.removeObject(forKey: Key.unlockedUntil) }
        }
    }

    // MARK: - automation: 再トリガー抑制

    /// automationOnly で対象アプリへ復帰した直後、この時刻まではクイズをスキップして即復帰させる。
    public static func automationSuppressedUntil(appKey: String) -> Date? {
        let t = defaults.double(forKey: Key.suppressPrefix + appKey)
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    public static func setAutomationSuppress(appKey: String, until: Date) {
        defaults.set(until.timeIntervalSince1970, forKey: Key.suppressPrefix + appKey)
    }

    /// 抑制ウィンドウ内か。
    public static func isAutomationSuppressed(appKey: String, now: Date = Date()) -> Bool {
        guard let until = automationSuppressedUntil(appKey: appKey) else { return false }
        return now < until
    }
}
