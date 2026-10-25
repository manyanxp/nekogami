# 2026-10-24 LINE 風チャット・考え中の猫 GIF・フロー図の担当 UUID

- 関連 ADR: 0028
- 影響範囲: `portal/frontend/`、`dashboard/`、`scripts/`、`docs/`

## 変更前
チャットは単純な吹き出し。考え中は文字だけ。Console のフロー図に UUID は出なかった。

## 変更後
- ポータルのチャットが LINE 風（アイコン・吹き出し・時刻）。考え中は走る猫の GIF（ポータルと Console）。
- Console のフロー図に、各エージェントの担当 UUID（先頭 8 桁）が出る。`GET /api/ids`。

- Console の相手の一覧が、10 秒ごとに更新される（ポータルでの追加・削除が再読み込みなしで反映）。

## 差分
- 追加: `scripts/gen-neko-gif.py`、`portal/frontend/img/neko-run.gif`、`dashboard/public/neko-run.gif`、`dashboard/ids.mjs`・`ids.test.mjs`、ADR 0028
- 変更: `portal/frontend/js/chat.js`・`css/style.css`、`dashboard/server.mjs`（`/api/ids`、GIF の MIME）・`public/index.html`、要件資料、ライセンス台帳
- テスト: Node 22 件（ids 3 件を追加）
- 変更なし: 新規依存なし。Azure のリソース。
