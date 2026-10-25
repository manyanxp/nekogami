# 2026-10-24 エージェントごとの Agent Console

- 関連 ADR: 0027（0020 を拡張）
- 影響範囲: `dashboard/`、`portal/`、`docs/`

## 変更前
Agent Console の相手は、猫神さま・Azure Sage・委任先一覧の項目だけ。応答中の管理は全体で 1 つで、別の相手とは同時に話せなかった。ポータルの「Console」は、サブオーケストレーターの行だけ。

## 変更後
- `.claude/agents/` の全定義が、Console の相手（`agent` 型）になる。ポータルは、相手にできる全行に「🖥 Console」を出す。
- 相手ごとに同時に応答できる。応答中・停止・リセットも相手ごと。フックは `session_id` で相手に振り分ける。

## 差分
- 変更: `dashboard/targets.mjs`・`targets.test.mjs`（19 件）・`server.mjs`・`public/index.html`、`portal/backend/portal_api/server.py`・`tests/test_portal.py`、`portal/frontend/js/app.js`、ADR 0027
- 変更なし: ライセンス（新規依存なし）、Azure のリソース。
- 未確認: 実際の Claude での会話・同時実行（認証が必要）。
