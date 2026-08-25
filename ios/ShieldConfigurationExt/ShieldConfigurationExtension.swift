import ManagedSettings
import ManagedSettingsUI
import UIKit

/// 遮断画面（シールド）の見た目を提供する。
/// iOSの制約上、この画面は静的UI（タイトル/サブタイトル/アイコン/ボタン）のみ。
/// クイズ自体はここには出せないため、本体アプリへ誘導する文言にする。
final class ShieldConfigurationExtension: ShieldConfigurationDataSource {

    private func gateConfiguration() -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundBlurStyle: .systemUltraThinMaterialDark,
            backgroundColor: UIColor(red: 0.06, green: 0.07, blue: 0.12, alpha: 1.0),
            icon: nil,
            title: ShieldConfiguration.Label(
                text: "🔒 ロシア語10問で解除",
                color: .white
            ),
            subtitle: ShieldConfiguration.Label(
                text: "LingoGate を開いてクイズを解くと、このアプリを一定時間だけひらけます。",
                color: UIColor.white.withAlphaComponent(0.75)
            ),
            primaryButtonLabel: ShieldConfiguration.Label(
                text: "LingoGate を開く",
                color: .white
            ),
            primaryButtonBackgroundColor: UIColor(red: 0.35, green: 0.32, blue: 0.9, alpha: 1.0),
            secondaryButtonLabel: ShieldConfiguration.Label(
                text: "閉じる",
                color: UIColor.white.withAlphaComponent(0.6)
            )
        )
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        gateConfiguration()
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        gateConfiguration()
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        gateConfiguration()
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        gateConfiguration()
    }
}
