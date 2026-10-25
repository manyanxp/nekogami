# 2026-10-24 マークダウンのプレビュー・コピーと構成図の HTML 表示

- 関連 ADR: 0029
- 影響範囲: `portal/frontend/`、`nekogamisama/CLAUDE.md`、`docs/`

## 変更前
猫神さまの回答は、マークダウンの記号がそのまま見えるテキストだった。構成図は文字の図だけ。

## 変更後
回答がマークダウンのプレビューになり、元の文との切り替えとコピーができる。```html / ```svg の図は、その場で表示される（サンドボックス）。猫神さまは、構成図を ```html で書くよう指示された。

## 差分
- 追加: `portal/frontend/js/markdown.js`、ADR 0029
- 変更: `portal/frontend/js/chat.js`・`css/style.css`・`test/index.html`（ブラウザ内テスト 102 項目）、`nekogamisama/CLAUDE.md`、要件資料
- 変更なし: 新規依存なし（ライセンス台帳の変更なし）。
