/**
 * iOS Shortcuts automation setup guide. The gate URL uses the live origin so
 * the exact string the user must paste is always correct for wherever the app
 * is being served (localhost, a LAN IP with --host, or a future host).
 */
export function AutomationGuideView({ onBack }: { onBack: () => void }) {
  const gateURL = `${window.location.origin}/gate?return=tiktok`;

  const steps: (string | JSX.Element)[] = [
    <>「ショートカット」アプリを開き、下タブの<b>オートメーション</b>を選ぶ。</>,
    <>右上の<b>＋</b>→<b>個人用オートメーションを作成</b>。</>,
    <><b>App</b>を選び、<b>開いた時</b>にチェック→対象アプリ（例: TikTok）を選ぶ→次へ。</>,
    <><b>アクションを追加</b>→<b>URLを開く</b>を選ぶ。</>,
    <>URL欄に下のアドレスを貼り付ける（<b>return=</b>の後ろを youtube / twitter などに変えれば他アプリ用も作れる）。</>,
    <><b>即時に実行</b>をオン（確認を求めないにする）→完了。</>,
  ];

  return (
    <div className="app">
      <button className="backlink" onClick={onBack}>
        ‹ ホーム
      </button>
      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>オートメーション設定</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        対象アプリを開くと自動でこのクイズが割り込む設定です（iPhone / iOSショートカット）。
        10問クリアすると対象アプリへ戻り、設定した時間だけ再割り込みしません。
      </p>

      <div className="section-title">手順</div>
      <div className="steps">
        {steps.map((s, i) => (
          <div className="step" key={i}>
            <div className="num">{i + 1}</div>
            <div className="body">{s}</div>
          </div>
        ))}
      </div>

      <div className="section-title">貼り付けるURL</div>
      <code className="urlbox">{gateURL}</code>
      <button
        className="btn block"
        style={{ marginTop: 10 }}
        onClick={() => navigator.clipboard?.writeText(gateURL)}
      >
        URLをコピー
      </button>

      <p className="muted" style={{ marginTop: 18 }}>
        注: 復帰は対象アプリのURLスキーム依存です（開けない場合は手動で戻ります）。ホーム画面に
        追加してスタンドアロン起動にすると割り込み感が自然になります。
      </p>
    </div>
  );
}
