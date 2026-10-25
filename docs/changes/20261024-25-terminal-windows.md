# 2026-10-24 エージェントごとのターミナル窓

- 関連 ADR: 0033
- 影響範囲: 画面（ポータル）

## 変更前
トレースは、1 つの「トレース」パネルに全員分の時系列が並ぶだけだった。

## 変更後
猫神さまが呼んだサブオーケストレーター・エージェントごとに、動かせるターミナル窓が開く。終了すると自動で閉じ、✕ で手動でも閉じられる。「トレース」パネルは残す。

## 差分（箇条書き）
- 追加: `web/src/lib/terminal-model.ts`・`terminal.test.ts`、`web/src/components/TerminalWindows.tsx`、ADR 0033
- 変更: `web/src/lib/trace-model.ts`（`LogLine.to`）、`PortalApp.tsx`、`portal.css`
- 削除: なし

## 移行・注意点
- 新しい依存なし。実際の Claude の会話での表示は、Mac のブラウザ（WSL2 の LAN 公開）で確認済み（2026-10-24）。
