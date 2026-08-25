import Foundation

/// automationOnly モードで `lingogate://gate?return=<appKey>` の appKey を
/// 復帰用 URL スキームに変換する対応表。
///
/// 対象アプリを直接 open できるスキームは各アプリ非公開仕様なので、主要どころを
/// ベストエフォートで登録する。ここに無い appKey や open に失敗した場合は
/// フォールバックとして何もしない（ユーザーが手動で戻る）。
enum ReturnAppMap {

    /// 復帰先の1候補。先頭から順に open を試す（アプリによりスキームが複数あるため）。
    struct Target {
        let key: String
        let displayName: String
        /// open を試す URL 文字列（先頭優先）。
        let urlCandidates: [String]
    }

    static let all: [Target] = [
        Target(key: "tiktok",    displayName: "TikTok",    urlCandidates: ["tiktok://", "snssdk1233://"]),
        Target(key: "youtube",   displayName: "YouTube",   urlCandidates: ["youtube://", "vnd.youtube://"]),
        Target(key: "twitter",   displayName: "X (Twitter)", urlCandidates: ["twitter://"]),
        Target(key: "x",         displayName: "X (Twitter)", urlCandidates: ["twitter://"]),
        Target(key: "instagram", displayName: "Instagram", urlCandidates: ["instagram://"]),
        Target(key: "facebook",  displayName: "Facebook",  urlCandidates: ["fb://"]),
        Target(key: "reddit",    displayName: "Reddit",    urlCandidates: ["reddit://"]),
        Target(key: "vk",        displayName: "VK",        urlCandidates: ["vk://"]),
        Target(key: "telegram",  displayName: "Telegram",  urlCandidates: ["tg://", "telegram://"]),
        Target(key: "whatsapp",  displayName: "WhatsApp",  urlCandidates: ["whatsapp://"]),
    ]

    static func target(forKey key: String) -> Target? {
        let k = key.lowercased()
        return all.first { $0.key == k }
    }

    static func displayName(forKey key: String) -> String {
        target(forKey: key)?.displayName ?? key
    }

    /// open を試す URL の候補（先頭優先）。
    static func urls(forKey key: String) -> [URL] {
        (target(forKey: key)?.urlCandidates ?? []).compactMap { URL(string: $0) }
    }
}
