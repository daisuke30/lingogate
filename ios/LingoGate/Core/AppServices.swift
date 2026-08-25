import Foundation
import QuizEngine

/// アプリ全体で1つ持つサービスコンテナ。
/// - 起動時にバンドルの例文DBを書込可能領域へ冪等コピーして open（QuizEngine.DBOpen）
/// - ContentStore / FSRS / QuestionBuilder を構築し、ゲートセッションの生成口を提供
/// - ホーム画面向けの軽い統計（今日のゲート回数・バンド進捗）を読む
///
/// DBが開けなかった場合は `openError` を保持し、UIはエラー表示にフォールバックする
/// （クラッシュさせない）。
@MainActor
final class AppServices: ObservableObject {

    /// EN→RU のドッグフード用固定設定。将来は設定化（設計 §2）。
    static let deckCode = "RU-from-EN"
    static let direction = StudyDirection.en2ru
    static let sessionSize = 10

    @Published private(set) var openError: String?

    private(set) var store: ContentStore?
    private(set) var deck: Deck?
    private let fsrs = FSRS()

    init() {
        openDatabase()
    }

    var isReady: Bool { store != nil && deck != nil }

    // MARK: - DB 起動

    private func openDatabase() {
        do {
            guard let bundled = Bundle.main.url(forResource: "lingogate", withExtension: "db") else {
                openError = "バンドルに lingogate.db が見つかりません（リソース同梱の確認が必要）。"
                return
            }
            let db = try DBOpen.openWritable(bundledAt: bundled)
            let store = ContentStore(db: db)
            guard let deck = try store.deck(code: Self.deckCode) else {
                openError = "Deck '\(Self.deckCode)' が DB に見つかりません。"
                return
            }
            self.store = store
            self.deck = deck
        } catch {
            openError = "DBを開けませんでした:\n\(String(reflecting: error))"
        }
    }

    // MARK: - ゲートセッション生成

    /// 現在バンド（MVPは band1 固定）で 10 問のゲートセッションを組み立てて返す。
    /// UI（QuizViewModel）が `runner` を駆動し、完了時に `finish` を呼ぶ。
    func makeGateController(appBundleID: String?, now: Date = Date()) throws -> GateController {
        guard let store, let deck else {
            throw ServiceError.notReady
        }
        let band = currentBand
        let builder = QuestionBuilder(store: store, deckId: deck.id)
        let planBuilder = GateSessionBuilder(store: store, builder: builder,
                                             direction: Self.direction, size: Self.sessionSize)
        var rng = SeededRNG(seed: UInt64(now.timeIntervalSince1970.bitPattern))
        let plan = try planBuilder.build(deckId: deck.id, band: band, now: now, rng: &rng)
        return try GateController(store: store, plan: plan, fsrs: fsrs,
                                  appBundleID: appBundleID, now: now)
    }

    enum ServiceError: Error { case notReady }

    // MARK: - 進捗 / 統計（ホーム表示用）

    /// MVP は band1 のみ稼働。将来は昇格判定で現在バンドを決める。
    var currentBand: Int { 1 }

    /// 現在バンドの学習進捗（カバー率・定着率）。
    func bandProgress() -> BandProgress? {
        guard let store, let deck else { return nil }
        return try? BandPromotion().evaluate(
            store: store, deckId: deck.id, band: currentBand, direction: Self.direction
        )
    }

    /// 今日（端末ローカル日）のゲート統計。DBの started_at は UTC 文字列なので、
    /// ローカル日の始まりを UTC 文字列に直して字句比較する。
    func todayStats(now: Date = Date()) -> TodayStats {
        guard let store else { return .empty }
        let startOfDayUTC = Self.utcString(from: Calendar.current.startOfDay(for: now))
        do {
            let st = try store.db.prepare("""
                SELECT COUNT(*),
                       COALESCE(SUM(unlocked), 0),
                       COALESCE(SUM(questions), 0),
                       COALESCE(SUM(correct), 0)
                FROM GateSession
                WHERE started_at >= ?1
                """)
            st.bind(1, startOfDayUTC)
            guard try st.step() else { return .empty }
            let sessions = st.int(0)
            let unlocked = st.int(1)
            let questions = st.int(2)
            let correct = st.int(3)
            let rate = questions > 0 ? Double(correct) / Double(questions) : nil
            return TodayStats(sessions: sessions, unlocked: unlocked, accuracy: rate)
        } catch {
            return .empty
        }
    }

    struct TodayStats {
        let sessions: Int
        let unlocked: Int
        let accuracy: Double?
        static let empty = TodayStats(sessions: 0, unlocked: 0, accuracy: nil)
    }

    private static func utcString(from date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f.string(from: date)
    }
}
