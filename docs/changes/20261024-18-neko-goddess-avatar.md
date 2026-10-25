# 2026-10-24 猫神さまのアイコン

- 関連 ADR: 0030
- 影響範囲: `portal/frontend/`、`dashboard/`、`scripts/`、`docs/`

## 変更前
チャットの猫神さまは絵文字（🐱）。フロー図の指揮役は猫のシルエット。

## 変更後
`sun_cat_goddess.png` の縮小版が、チャットのアイコンと、Agent Console の猫神さまのカードに出る。

## 差分
- 追加: `scripts/make-avatar.py`、`portal/frontend/img/neko-goddess.png`、`dashboard/public/neko-goddess.png`、ADR 0030
- 変更: `portal/frontend/js/chat.js`・`css/style.css`、`dashboard/server.mjs`（PNG の MIME）・`public/index.html`、`.dockerignore`（`icons`）、ライセンス台帳、要件資料
- 未確認: 画像の利用条件（商用・再配布）。
