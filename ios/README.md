# LingoGate iOS（Phase 1 骨格 / Family Controls Spike台）

脱スマホ中毒 × ロシア語学習ゲートアプリの iOS 本体。
このフォルダは **LINGO-002（Xcode scaffold）** の成果物で、次の2役を兼ねる:

1. Phase 1 本体アプリの土台（SwiftUI + Screen Time API の3 Extension）
2. **無料 Apple ID（Personal Team）で Family Controls が動くかの実機Spike台（→ LINGO-003）**

設計の背景は `ai-org/Ideas/20260703-quiz-gate-app-design.md` §4。

---

## Phase 0 で始める（今はこちら）

**LINGO-003 の結果**: 無料 Personal Team は Family Controls 非対応（署名段階で `Personal development
teams, including "DAISUKE KATSUTA", do not support the Family Controls (Development) capability.`）。
設計書 §4.3 の分岐どおり、**シールドを使わない Phase 0（オートメーションのみ）構成**で始める。

手順（最短）:

1. Xcode 上部のスキーム選択で **`LingoGatePhase0`** に切り替える（`LingoGate` ではない）。
2. 左のナビゲータで青い `LingoGatePhase0` を選択 → `Signing & Capabilities` タブ →
   `Team` を **`DAISUKE KATSUTA (Personal Team)`** に設定。
   - `LingoGatePhase0` ターゲットは entitlements を一切持たない（Family Controls も App Group も無し）ので、
     Team 設定でエラーは出ないはず。**他のターゲット（`LingoGate` / 3 Extension）は触らなくてよい**（今回はビルド対象外）。
3. iPhone を接続 → デバイス選択 → `⌘R`。
4. 起動したら「設定 → オートメーション設定ガイド」（`AutomationGuideView`）の手順どおりに
   ショートカットの個人用オートメーションを作成（対象アプリが開いたら `lingogate://gate?return=<app>` を開く）。
5. `DEVICE_TEST.md` の **パートB（B-1〜B-3）／パートC** が Phase 0 の該当実機確認項目。

`LingoGatePhase0` は既存の `LingoGate` ターゲット・3 Extension とは別ターゲットとして追加した
（**既存構成は温存**）。Developer Program（$99/年）加入後は `LingoGate` スキームに戻せば、
そのままシールド構成（本命）を試せる。

---

## いちばん最初にやること（シールド版 `LingoGate` を試す場合＝4ステップ）

> `.xcodeproj` は `project.yml` から xcodegen で生成済み。通常はそのまま開くだけ。

1. **開く**: `LingoGate.xcodeproj` を Xcode でダブルクリック。
2. **Team を選ぶ**: 左のナビゲータで青い `LingoGate` を選択 → `Signing & Capabilities` タブ →
   - `Team` を自分の **Personal Team**（無料 Apple ID）に設定。
   - **4ターゲットすべてで同じ操作が要る**: 上部のターゲット選択（`LingoGate` / `ShieldConfigurationExt` / `ShieldActionExt` / `DeviceActivityMonitorExt`）を切り替え、それぞれ Team を設定。
   - ここで **`Family Controls` capability が Personal Team で弾かれるか**が最初の観測点（下の「Spikeで見ること ①」）。
3. **iPhone を接続**: USB で繋ぎ、Xcode 上部のデバイス選択で自分の iPhone を選ぶ（初回は iPhone 側で「このコンピュータを信頼」）。
4. **Run（⌘R）**: ビルド → 実機へインストール → 起動。初回は iPhone の
   `設定 > 一般 > VPN とデバイス管理` で自分の開発者証明書を「信頼」する必要がある。

起動すると1画面のデバッグUI（`SpikeView`）が出る。上から順に ①権限 ②アプリ選択 ③シールド。

---

## 無料アカウント（Personal Team）の注意

- **7日で署名が切れる**: 無料 Apple ID の実機ビルドは7日でアプリが起動しなくなる。**週1回 Xcode から再 Run**（再インストール）が必要。
- **同時3アプリまで** の制限あり（本アプリは1つとしてカウント。Extension は本体に内包）。
- **Family Controls は有料 Developer Program 前提の可能性が高い**。無料で弾かれるかどうかを測るのがこのSpikeの主目的。弾かれた場合の fallback は設計書 §4.3 の「Phase 0＝オートメーション方式のみ」。
  → **結果確定（2026-07-03）**: 無料 Personal Team は Family Controls **非対応**。上の「Phase 0 で始める」節を参照。

---

## Spikeで見ること（結果は `ai-org/Tasks/LINGO-003-device-spike.md` の `## コメント` に記録）

観測は3段階。**どこで詰まったか自体が結果**なので、失敗しても失敗内容をそのまま記録する。

| # | 見ること | 成功の判定 | 失敗しそうな所 |
|---|---|---|---|
| ① | ビルド/インストールが**署名段階で弾かれないか** | Run が実機インストールまで通る | `Signing & Capabilities` で `Family Controls` が「Personal Team では追加できない」等のエラー → その文言を丸ごと記録 |
| ② | `requestAuthorization` が通るか | 画面①の状態が **approved（緑）** になる。iOS の許可ダイアログが出て「許可」できる | ボタン押下でエラー赤枠にエラー全文が出る → **その全文を記録**（これが核心データ） |
| ③ | 選んだアプリに**実際にシールドが出るか** | ②approved後、画面②の Picker で TikTok 等を選び、画面③「シールド適用」→ そのアプリを開くと遮断画面「🔒 ロシア語10問で解除」が出る | 適用しても遮断されない／Picker が開かない等 |

> Screen Time API は**シミュレータでは一切動かない**。必ず実機で。

### 画面の使い方（SpikeView）
- **① Family Controls 権限**: 「権限をリクエスト」ボタン。状態（notDetermined/approved/denied）を大きく表示。失敗時はエラー全文を赤枠に表示（コピー可）。
- **② 対象アプリを選択**: approved になると Picker が開ける。選択は App Group の UserDefaults に自動保存。
- **③ シールド**: 「適用」で選択アプリを遮断、「解除」で戻す。

---

## プロジェクト構成

```
ios/
├─ project.yml                 ← 真実の定義（xcodegenの入力）。ターゲット・署名・entitlementsはここ
├─ LingoGate.xcodeproj         ← project.yml から生成（再生成可）
├─ Shared/                     ← 本体と全Extensionで共有
│   ├─ AppGroup.swift          App Group ID / ManagedSettingsStore名（PHASE0では standard UserDefaults に直結）
│   ├─ AppSelectionStore.swift FamilyActivitySelection の永続化（App Group UserDefaults）
│   └─ GateState.swift         GateMode・解除時間・解除ウィンドウ（PHASE0では常に automationOnly）
├─ LingoGate/                  ← 本体アプリのソース（LingoGate と LingoGatePhase0 の両ターゲットが共有）
│   ├─ App/LingoGateApp.swift
│   ├─ Core/                   AppServices・GateCoordinator・UnlockController・ReturnAppMap
│   ├─ Features/Home/          HomeView（PHASE0では対象アプリ選択/今すぐロックを非表示、ガイド導線が主役）
│   ├─ Features/Quiz/          QuizView + QuizViewModel + FlashcardCardView（フリップ/フリック）
│   ├─ Features/Settings/      SettingsView（PHASE0ではゲート方式固定表示）
│   ├─ Features/Guide/         AutomationGuideView（オートメーション設定ガイド）
│   ├─ Features/Spike/         SpikeView + SpikeViewModel（診断。PHASE0ではシールド区画を非表示）
│   ├─ ShieldKit/ShieldController.swift  ManagedSettingsStore ラッパ（適用/解除）
│   ├─ Resources/Assets.xcassets
│   ├─ Info.plist              ← LingoGate ターゲットの生成 Info.plist（lingogate:// スキーム含む）
│   └─ LingoGate.entitlements  Family Controls + App Group
├─ LingoGatePhase0/Info.plist  ← LingoGatePhase0 ターゲットの生成 Info.plist（entitlements ファイルなし）
├─ ShieldConfigurationExt/     遮断画面の見た目（「🔒 ロシア語10問で解除」。LingoGate のみ埋め込み）
├─ ShieldActionExt/            遮断画面のボタン応答（現状 .close のみ。LingoGate のみ埋め込み）
└─ DeviceActivityMonitorExt/   解除時間切れの再シールド用フック。LingoGate のみ埋め込み
```

- **ターゲット**: `LingoGate`（シールド版・本命。3 Extension を埋め込み、Family Controls + App Group entitlements あり）／
  `LingoGatePhase0`（entitlements なし。3 Extension 埋め込みなし。automationOnly 専用。無料 Personal Team 用）。
  ソース（`Shared` / `LingoGate` フォルダ）は両ターゲットで共有し、`SWIFT_ACTIVE_COMPILATION_CONDITIONS` の
  `PHASE0` フラグで挙動を分岐する（`#if PHASE0`）。
- **Bundle ID**: `tech.inoma.lingogate`（本体）＋ `.phase0`（Phase0）＋ `.ShieldConfigurationExt` / `.ShieldActionExt` / `.DeviceActivityMonitorExt`
- **App Group**: `group.tech.inoma.lingogate`（`LingoGate` 側のみ。`LingoGatePhase0` は使わず standard UserDefaults）
- **Deployment target**: iOS 17.0 / iPhone / SwiftUI

---

## project.yml を変更したとき

ターゲット・署名・Bundle ID・entitlements を変えたら **project.yml を編集 → 再生成**:

```bash
cd ios
brew install xcodegen   # 未導入なら一度だけ
xcodegen generate       # LingoGate.xcodeproj を作り直す
```

Xcode の GUI で直接いじった構成変更は次回の `xcodegen generate` で消える（project.yml が真実）。
※ `Signing & Capabilities` の **Team 選択は Xcode 側の操作**で、project.yml には書いていない（各自のアカウント依存のため空にしてある）。一度選べば `.xcodeproj` に保存される。

---

## CI/署名なしビルド（動作確認済み）

署名抜きでコンパイルが通ることの確認（実機不要・このリポジトリで確認済み）。**両スキームとも確認**:

```bash
cd ios
xcodebuild -scheme LingoGate       -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -scheme LingoGatePhase0 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
# → どちらも ** BUILD SUCCEEDED **
```

### 既知の警告（無害）
- `SpikeViewModel.swift` の権限 switch に「switch must be exhaustive」警告が1つ出る。
  iOS 26.4 で追加された `.approvedWithDataAccess` を deployment target iOS 17 では case として直接書けないため、
  `@unknown default` 内で `#available(iOS 26.4, *)` 判定して approved 扱いにしている。**動作は正しい**。
- `ShieldActionExt` に submenu 系の新caseに関する同種の警告。すべて `.close` に落ちるため挙動は正しい。

---

## 通常起動の画面構成（LINGO-005）

起動すると **ホーム**（`HomeView`）が出る。SpikeView はデバッグ用に「設定 → 診断」へ移動した。

```
ホーム（今日の学習サマリ / 対象アプリ選択＋今すぐロック / 10問開始 / 設定・ガイド導線）
  ├─ クイズ（QuizView）… 出題UIで分岐（既定=フラッシュカード／厳格モード=4択）→10問→解除→完了画面
  ├─ 設定（SettingsView）… 出題UI・ゲート方式・解除時間・オートメーションガイド・診断
  │     └─ 診断（SpikeView）… 旧Spike画面（権限/選択/シールドを手動で試す）
  └─ オートメーション設定ガイド（AutomationGuideView）
```

- 例文DBは `../pipeline/lingogate.db` をアプリのリソースとして同梱（コピースクリプトなし）。
  起動時に `QuizEngine.DBOpen` が書込可能領域へ**冪等コピー**して開く（学習状態は保持される）。

---

## 出題UI（flashcard / strict）— LINGO-007

「設定」→「出題UI」で切り替える（App Group / standard UserDefaults に保存、`GateState.quizMode`）。
**既定はフラッシュカード**（2026-07-04 勝田dogfoodフィードバックによる変更。4択は「厳格モード」として温存）。

| モード | 動き |
|---|---|
| **フラッシュカード（既定）** | カード表=EN文のみ。タップで裏返すまでRU文は見えない。裏面=RU文＋JA訳（小さく）。3方向フリックで自己評価: 右=覚えている(Good)／左=忘れた(Again)／下=曖昧(Hard)。FSRSの`Rating`に直接渡す（4択の正誤2値マッピングより精度が高い）。 |
| **厳格モード（4択）** | 従来どおりEN文提示→RU 4択（sentenceChoice/cloze）→即時フィードバック。 |

### ゲート突破対策（フリック連打での嘘の自己申告を防ぐ）
1. **裏返すまで評価不可** — ドラッグ検出自体をカードの内部状態でゲートしており、未フリップ時は反応しない。
2. **裏返してから約1.5秒はフリック判定無効** — `FlashcardCardView` が `.task(id: isFlipped)` で管理。見た目にはフリップ直後のカードが一瞬反応しないだけで、不自然な待機表示は出さない。

### Again（忘れた）の再出題・undo・バッファコミット
- Again評価のカードは（従来の誤答再出題と同じ流れで）セッション末尾に再出題。10枚すべて非Againで完了。
- 「戻る」で直前1枚の評価を取り消し、カードを表向き（未フリップ）で復元（誤フリック対策）。**単一レベルのundo**（直前の1枚のみ、2手前へは戻れない）。
- 実装: `GateSessionRunner.submitRating(_:now:)` がFSRSグレードをメモリバッファ（`pendingRatingUpserts`）に積み、DBへは書かない。`undoLastRating()`はそのバッファと queue/カウンタを丸ごとスナップショットから復元する純メモリ操作（undoにDB補償が要らない設計）。`GateController.finish()` が完了時に `commitPendingRatingUpserts()` を呼び一括コミット。**4択（`submit(choiceIndex:...)`）側は変更なし**（従来どおり回答ごとに即時DB書き込み）。

---

## モード切替（shield / automationOnly）

「設定」→「ゲート方式」で切り替える（App Group に保存）。**既定は shield**。

| モード | 動き | いつ使う |
|---|---|---|
| **シールド（本命）** | 対象アプリをシールドで遮断 → クイズ10問 → **N分だけ解除** → 時間切れで**自動再シールド** | LINGO-003 で Family Controls が通ったら |
| **オートメーションのみ（Phase 0）** | シールドを使わず、ショートカットのオートメーションが `lingogate://gate?return=<app>` を開く → クイズ → 対象アプリへ復帰。**復帰後N分間はクイズをスキップ**（再トリガー抑制） | 無料アカウントでシールドが弾かれた場合 |

**解除時間**は 5 / 10 / 15 / 30 分（既定10分、設定で変更、App Group 保存）。

### shield モードの解除タイマー（二重化の割り切り）
- 主系＝App Group のタイムスタンプ（`GateState.unlockedUntil`）。本体アプリがフォアグラウンド復帰するたびに期限超過を判定して再シールドする（最も確実）。
- 副系＝DeviceActivity のインターバル監視。時間切れで `DeviceActivityMonitorExt.intervalDidEnd` が再シールドする（アプリを開かなくても効く）。
- **DeviceActivity は最小15分粒度**のため、5/10分ちょうどの再シールドは副系だけでは保証されない。主系（タイムスタンプ＋フォアグラウンド再チェック）で担保する設計。実際は「対象アプリを閉じて別アプリに切替 or LingoGate に戻る」時点で再シールドが確定する。

---

## オートメーション設定（両モード共通で推奨）

「設定 → オートメーション設定ガイド」（`AutomationGuideView`）に手順を用意した。要点:

1. 「ショートカット」アプリ →「オートメーション」→「＋」→「個人用オートメーションを作成」
2. きっかけ＝「App」→「開いている」→ TikTok / YouTube / X などを選択
3. アクション＝「URLを開く」→ URL に `lingogate://gate?return=tiktok`（アプリ別の値はガイドの対応表）
4. 「実行の前に尋ねる」をオフ
5. 堰き止めたいアプリの数だけ繰り返す（1オートメーション＝1アプリ）

- shield モードでも、シールド→本体アプリ切替の摩擦を消す補助として設定推奨（設計 §4.3 の二段構え）。
- 復帰先の URL スキーム（`tiktok://` など）は各社仕様依存で開けないことがある（その場合は手動で戻る）。

---

## 実機でしか確認できないこと（勝田チェックリスト）

Screen Time API はシミュレータで動かないため、以下は実機Runで確認する（LINGO-003 と合わせて）:

- [ ] shield: 「今すぐロック」→ 対象アプリを開くと遮断画面が出る
- [ ] shield: クイズ10問完走 → 対象アプリが**解除**され開ける
- [ ] shield: 解除から N 分後（or 別アプリ切替後）に**自動再シールド**される
- [ ] automationOnly: オートメーション作成後、対象アプリを開くと LingoGate が割り込みクイズが出る
- [ ] automationOnly: クイズ完走 → 対象アプリへ**復帰**できる（URLスキームが開く）
- [ ] automationOnly: 復帰後 N 分以内はクイズがスキップされ即復帰する
- [ ] フラッシュカード（既定）: 表→裏→フリック評価が実データで最後まで破綻なく回る
- [ ] フラッシュカード: 裏返すまで評価不可／裏返してから約1.5秒はフリック無効が実機で自然に感じる
- [ ] フラッシュカード: 「戻る」で直前1枚が表向き復元される（undo）
- [ ] 厳格モード（4択）に切り替えても実データで最後まで破綻なく回る

詳細な手順は `DEVICE_TEST.md` パートC（C-1〜C-5）を参照。

---

## 次のタスク
- ~~**LINGO-003**: 勝田が Family Controls Spike を実機で実施~~ → **完了・非対応と確定**（無料 Personal Team）。
- ~~**LINGO-007**: 出題UIをフラッシュカード式に改修~~ → **実装・ビルド・テスト完了**。実機での操作感確認が残課題。
- **今ここ**: `LingoGatePhase0` スキームで実機Run → `DEVICE_TEST.md` パートB/Cを消化（フラッシュカードの操作感含む）。
- Developer Program 加入後: `LingoGate` スキームに切り替えてパートA（シールド）を実施。
- 学習体験の作り込み（統計・band2以降・タイピング）は **Phase 2**。
