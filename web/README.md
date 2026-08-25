# LingoGate — Web / PWA 版

脱スマホ中毒 × ロシア語フラッシュカードの **ブラウザ版**。iOS ネイティブ版
（`../ios/`）と同じ FSRS・出題ロジック・ゲートフローを、**何度でも高速に反復
テストできる形**で動かすための実装です（LINGO-008）。iOS 版のコードは温存。

- スタック: Vite + React + TypeScript / テスト: Vitest / 学習状態: IndexedDB
- **実行時の外部ネットワーク依存ゼロ**（コンテンツも FSRS もアイコンも全て同梱）
- PWA: manifest + Service Worker（オフライン動作・iPhone Safari でホーム画面追加可）

---

## Mac で試す（1コマンド）

```bash
cd workspace/apps/lingogate/web && npm install && npm run dev
```

- 初回のみ `npm install`（以後は不要）。
- `npm run dev` が **自動で** pipeline の JSONL → コンテンツ JSON を生成し（`predev`）、
  `http://localhost:5173/` を開けば動きます。
- ゲートフローを直接見る: `http://localhost:5173/gate?return=tiktok`

### 本番ビルドで確認する

```bash
npm run build && npm run preview   # http://localhost:4173/
```

`build` は Service Worker まで含めた本番構成。オフライン動作（機内モードで再読込）
や「ホーム画面に追加」を確認したい時はこちら。

### テスト

```bash
npm test        # Vitest（FSRS 既知値・セッション・抑制ウィンドウ・undo・コンテンツビルド）
```

---

## iPhone で試す

### A. 同一 Wi‑Fi の Mac から LAN 公開（今すぐ）

```bash
npm run dev -- --host      # or: npm run preview -- --host
```

表示される `Network: http://192.168.x.x:5173/` を iPhone の Safari で開く
→ 共有ボタン → **ホーム画面に追加**。standalone アプリとして起動します。

> 注: iOS の Service Worker / オフラインは **https もしくは localhost** が前提。LAN の
> 素の http では SW 登録がスキップされることがあります（アプリ自体は動きます）。
> オフライン込みで検証したい場合は後日ホスティング（要・勝田承認）へ。

### B. オートメーション（対象アプリを開くとクイズが割り込む）

アプリ内「オートメーションを設定する」を開くと、iOS ショートカットの手順と
**貼り付ける URL（実行中の origin から動的生成）** が表示されます。
`TikTok を開いた時 → URL を開く: <このアプリ>/gate?return=tiktok` を作れば iOS 版と
同じ割り込み体験になります。

---

## 画面と機能（iOS 版と同仕様）

- **ホーム**: 今日のゲート回数 / 解除 / 既知率、band1 の語彙カバー率・定着率バー、
  「10問を解く」、設定、オートメーション設定ガイド。
- **フラッシュカード**: 表 = EN（`kind='word'` は EN gloss）、タップで裏返し裏 = RU
  （＋ kana / JA を小さく）。**フリック右 = 覚えた(Good) / 左 = 忘れた(Again) /
  下 = 曖昧(Hard)**。ドラッグ中は方向色＋凡例ハイライト。**裏返すまで評価不可＋
  裏返し後 ~1.5 秒はフリック無効**（ゲート突破対策）。「直前を取り消す」で 1 枚 undo。
  評価はメモリにバッファし、**セッション完了時に IndexedDB へ一括コミット**。
  Again のカードはセッション末尾に再出題、10 枚すべて非 Again で完了。
- **ゲートフロー**: `/gate?return=tiktok` で起動 → 10 問 → 完了画面「TikTok に戻る」
  （`tiktok://` 等のスキーム）。完了から N 分（設定 5/10/15/30、既定 10）は再訪しても
  クイズをスキップして即「戻る」。
- **設定**: 解除時間、出題 UI（フラッシュカードのみ。4択は「準備中」）、学習状態リセット。

---

## 構成

```
web/
  scripts/
    build-content.mjs   pipeline JSONL → src/content/deck.generated.json（band1 + imported を glob）
    gen-icons.mjs       依存ゼロで PWA / apple-touch アイコン PNG を生成
  public/
    manifest.webmanifest, sw.js, icons/
  src/
    engine/   fsrs.ts（FSRS-4.5 移植）/ rng.ts / content.ts / session.ts / gate.ts ＋ *.test.ts
    db/idb.ts        IndexedDB 薄ラッパ（reviewStates / gateSessions / meta）
    state/           service.ts（デッキ読込・セッション・統計）/ settings.ts
    ui/              App / Home / Quiz / FlashcardCard / GateEntry / Settings / AutomationGuide
```

`deck.generated.json` と `public/icons/` は `predev` / `prebuild` で **自動生成**される
成果物なので Git 管理外（`.gitignore`）。

---

## iOS 版との差分・割り切り（Web 版で意図的に省いたもの）

1. **シールド（強制遮断）なし** — Screen Time / FamilyControls は iOS ネイティブ専用で
   Web に等価物がない。Web 版は **automationOnly 相当**（弱い強制力：スワイプで逃げられる）
   のみ。クイズ × FSRS の反復 UX 検証が目的なので影響なし（設計書 §4.3 の合意どおり）。
2. **4択（厳格モード）は未実装** — 「準備中」表示。Web 版はまず反復テストが目的のため
   フラッシュカードのみ実装。QuestionBuilder / 誤答選択肢生成は移植していない（iOS 版に温存）。
3. **学習状態は IndexedDB**（SQLite ではない）。FSRS 数式・スケジュールは iOS と同一で、
   Swift の既知値テスト（S=3.0412 / S≈13.216 / Again 後 S≈2.702 等）を `fsrs.test.ts` で照合済み。
4. **復帰スキーム** は各アプリ非公開仕様依存でブラウザからは開けない場合がある（iOS 版と同じ限界）。
5. **band は band1 のみ**（コンテンツ制約、iOS 版と同じ）。`sentences_imported*.jsonl`
   （LINGO-009）は存在すれば自動で取り込む（`build-content.mjs` が glob）。

## 既知の制約

- ブラウザ操作の自動テストは範囲外（フリップ / フリックの操作感は実機・実ブラウザで確認）。
- LAN の素の http では iOS の Service Worker 登録がスキップされることがある（上記 A の注）。
- デプロイ（外部公開）はしていない。公開は勝田の承認が必要。
