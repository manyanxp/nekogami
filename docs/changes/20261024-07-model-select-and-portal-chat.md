# 2026-10-24 モデル選択とポータルのチャット欄（Phase 3 追記）

- 関連 ADR: 0014（追記）, 0015
- 要件: [20261024-nekogamisama-phase3.md](../requirements/20261024-nekogamisama-phase3.md)（Q7・Q8）
- 影響範囲: `portal/`、`dashboard/`、`docs/`、README

## 変更前
ノードグラフでモデルを選ぶ操作はなかった（モデルは詳細編集のフォームで自由入力）。ポータルには会話の入力欄がなく、猫神さまと話すには Agent Console の画面（`CHAT_PROJECT_DIR=nekogamisama` で起動）を使う必要があった。Agent Console のチャットは、起動時に決めた 1 つの相手とだけ話せた。

## 変更後
- ノードグラフで、選択したノードの詳細パネルと追加ダイアログからモデルを選べる（猫神さまのカードも）。台帳と定義ファイルのモデルが異なると警告が出る。
- ポータルの一覧画面の右に、猫神さまとのチャット欄がある。ポータルのバックエンドが Agent Console に中継する。
- Agent Console は、リクエストの `agent` で相手（Azure Sage / 猫神さま）を選べ、セッションは相手ごとに別。

## 差分
- 追加: `portal/frontend/js/chat.js`、ADR 0015、`filter_chat_event` などのチャット中継（`server.py`）、`MODEL_CHOICES`（`graph-model.js`）。
- 変更:
  - バックエンド: `server.py`（`/api/chat*`、`/api/health` に `console`）、`registry.py`（`drift`）。
  - フロント: `admin.html`・`js/admin.js`（モデル選択）、`index.html`・`css/style.css`・`js/api.js`（チャット欄、SSE を `fetch` で購読）。
  - Agent Console: `server.mjs`（`agent` ごとのセッション・許可リスト、`reset` の相手指定、Bash 許可は猫神さまだけ、`/vendor/*` の未導入でも落ちないように修正）、`public/index.html`（他の相手の会話を出さない）。
  - テスト: バックエンド 15 → 18 件、ブラウザ内 42 → 46 項目、Node（`nya.test.mjs`）7 件。
- 変更なし: `nekogamisama/`、`.claude/`、ライセンス（新規依存なし）。

## 移行・注意点
- **Agent Console（`dashboard/` の `npm start`）とポータルの両方を再起動する。** Agent Console が古いままだと、ポータルのチャット欄には何も出ない（ADR 0015）。
- 実際の会話には、Agent Console の `npm install` と Claude の認証が必要。
- モデルの選択は台帳上のメタ情報で、実際のモデルは定義ファイルで決まる（ADR 0014）。
- 修正: Agent Console は、`dashboard/node_modules` が無い状態でブラウザが `/vendor/*.js` を取りに来ると、未処理のエラーで落ちていた。404 を返すようにした。
