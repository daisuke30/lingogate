import SwiftUI

/// モード（shield / automationOnly）と解除時間の設定。診断（SpikeView）への導線もここ。
struct SettingsView: View {
    /// 変更をホームに伝えるためのコールバック。
    var onChange: () -> Void = {}

    @State private var mode = GateState.mode
    @State private var quizMode = GateState.quizMode
    @State private var minutes = GateState.unlockMinutes

    var body: some View {
        Form {
            Section {
                Picker("出題UI", selection: $quizMode) {
                    ForEach(QuizMode.allCases, id: \.self) { m in
                        Text(m.title).tag(m)
                    }
                }
                .pickerStyle(.inline)
                Text(quizMode.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("出題UI")
            } footer: {
                Text("既定はフラッシュカード（勝田のdogfoodフィードバックによる変更）。4択に戻したい場合は厳格モードへ。ゲート方式（shield/automationOnly）とは独立。")
            }
            .onChange(of: quizMode) { _, newValue in
                GateState.quizMode = newValue
                onChange()
            }

            #if PHASE0
            Section {
                Label(GateMode.automationOnly.title, systemImage: "wand.and.stars")
                    .font(.headline)
                Text(GateMode.automationOnly.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("ゲート方式（固定）")
            } footer: {
                Text("この Phase 0 ビルドは Family Controls entitlement を持たないため「オートメーションのみ」で固定です（LINGO-003: 無料 Personal Team は非対応と判明）。Developer Program 加入後は LingoGate スキーム（シールド版）に切り替えてください。")
            }
            #else
            Section {
                Picker("ゲート方式", selection: $mode) {
                    ForEach(GateMode.allCases, id: \.self) { m in
                        Text(m.title).tag(m)
                    }
                }
                .pickerStyle(.inline)
                Text(mode.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("ゲート方式")
            } footer: {
                Text("既定はシールド。無料アカウントで Family Controls が使えない場合は「オートメーションのみ」に切り替えてください（実機Spike＝LINGO-003で判定）。")
            }
            .onChange(of: mode) { _, newValue in
                GateState.mode = newValue
                onChange()
            }
            #endif

            Section {
                Picker("解除時間", selection: $minutes) {
                    ForEach(GateState.unlockDurationChoices, id: \.self) { m in
                        Text("\(m) 分").tag(m)
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                Text("解除時間")
            } footer: {
                Text("クイズ完了後、対象アプリを開けておく時間。既定は10分。")
            }
            .onChange(of: minutes) { _, newValue in
                GateState.unlockMinutes = newValue
                onChange()
            }

            Section {
                NavigationLink {
                    AutomationGuideView()
                } label: {
                    Label("オートメーション設定ガイド", systemImage: "wand.and.stars")
                }
            } footer: {
                Text("シールド方式でも、対象アプリ→LingoGate の切り替えの摩擦を消す補助として推奨します。")
            }

            Section {
                NavigationLink {
                    SpikeView()
                } label: {
                    Label("診断（Family Controls Spike）", systemImage: "stethoscope")
                }
            } header: {
                Text("開発者向け")
            } footer: {
                Text("権限リクエスト・アプリ選択・シールド適用/解除を手動で試すデバッグ画面（LINGO-003）。")
            }
        }
        .navigationTitle("設定")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            mode = GateState.mode
            quizMode = GateState.quizMode
            minutes = GateState.unlockMinutes
        }
    }
}
