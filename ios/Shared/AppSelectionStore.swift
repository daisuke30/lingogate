import Foundation
import FamilyControls

/// FamilyActivityPicker で選ばれた対象アプリ/カテゴリ/Webドメインを
/// App Group の UserDefaults に永続化する。本体アプリと各Extensionから共通で読む。
///
/// 注意: FamilyActivitySelection の中身（トークン）は不透明値で、picker由来のもの以外を
/// 手で構築することはできない。ここでは Codable による丸ごと保存/復元のみを行う。
enum AppSelectionStore {
    private static let key = "familyActivitySelection"

    static func save(_ selection: FamilyActivitySelection) {
        guard let data = try? JSONEncoder().encode(selection) else { return }
        AppGroup.userDefaults.set(data, forKey: key)
    }

    static func load() -> FamilyActivitySelection {
        guard
            let data = AppGroup.userDefaults.data(forKey: key),
            let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else {
            return FamilyActivitySelection()
        }
        return selection
    }
}
