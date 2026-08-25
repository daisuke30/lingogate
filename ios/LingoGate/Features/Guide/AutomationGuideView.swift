import SwiftUI

/// ショートカットアプリで「対象アプリが開かれたら LingoGate を開く」個人用オートメーションを
/// 作る手順ガイド。スクリーンショットは撮れないのでテキスト＋SF Symbols で示す。
/// automationOnly では必須、shield でも切替の摩擦を消す補助として案内（設計 §4.3）。
struct AutomationGuideView: View {

    private struct Step: Identifiable {
        let id = Int.random(in: .min ... .max)
        let symbol: String
        let title: String
        let body: String
    }

    private let steps: [Step] = [
        Step(symbol: "app.badge",
             title: "「ショートカット」アプリを開く",
             body: "iPhone 標準の「ショートカット」アプリを開き、下タブの「オートメーション」を選ぶ。"),
        Step(symbol: "plus.circle",
             title: "個人用オートメーションを新規作成",
             body: "右上の「＋」→「個人用オートメーションを作成」をタップ。"),
        Step(symbol: "app.dashed",
             title: "きっかけに「App」を選ぶ",
             body: "一覧から「App」を選び、「開いている」にチェック。「選択」から TikTok / YouTube / X など堰き止めたいアプリを選ぶ。"),
        Step(symbol: "link",
             title: "アクションに「URLを開く」を追加",
             body: "「アクションを追加」→「URLを開く」を検索して追加。URL欄に下の対応表の値（例: lingogate://gate?return=tiktok）を入力。"),
        Step(symbol: "bolt.slash",
             title: "「実行前に尋ねる」をオフ",
             body: "「次で実行の前に尋ねる」をオフにして即実行に。これで対象アプリを開くと LingoGate が自動で割り込む。"),
        Step(symbol: "arrow.triangle.2.circlepath",
             title: "アプリごとに繰り返す",
             body: "堰き止めたいアプリの数だけ 2〜5 を繰り返す（1オートメーション＝1アプリ）。"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                intro
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    stepRow(number: index + 1, step: step)
                }
                urlTable
                note
            }
            .padding(20)
        }
        .navigationTitle("オートメーション設定")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("なぜ設定するか", systemImage: "questionmark.circle")
                .font(.headline)
            Text("iOSの制約で、シールド画面から直接 LingoGate を開けません。ショートカットのオートメーションを使うと、対象アプリを開いた瞬間に LingoGate が前面に出て、クイズ→解除→アプリ復帰がなめらかになります。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func stepRow(number: Int, step: Step) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle().fill(Color.accentColor.opacity(0.15)).frame(width: 34, height: 34)
                Text("\(number)").font(.headline).foregroundStyle(.tint)
            }
            VStack(alignment: .leading, spacing: 4) {
                Label(step.title, systemImage: step.symbol)
                    .font(.body.weight(.semibold))
                Text(step.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var urlTable: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("アプリ別の URL", systemImage: "list.bullet.rectangle")
                .font(.headline)
            Text("「URLを開く」に入れる値。return= のあとが復帰先アプリのキー。")
                .font(.caption)
                .foregroundStyle(.secondary)
            VStack(spacing: 0) {
                ForEach(Array(ReturnAppMap.all.enumerated()), id: \.offset) { index, target in
                    if index > 0 { Divider() }
                    HStack {
                        Text(target.displayName)
                            .font(.subheadline.weight(.medium))
                            .frame(width: 96, alignment: .leading)
                        Text("lingogate://gate?return=\(target.key)")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 8)
                }
            }
            .padding(.horizontal, 14)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var note: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("補足", systemImage: "info.circle")
                .font(.subheadline.bold())
            Text("・x / twitter はどちらも X に戻ります。\n・復帰先アプリのURLスキームは各社仕様に依存し、開けない場合があります（その時は手動で戻ってください）。\n・オートメーションのみモードでは、復帰直後の\(GateState.unlockMinutes)分間はクイズをスキップして即復帰します。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}
