# 2026-10-24 Claude のエージェント定義の追加・編集（Phase 4）

- 関連 ADR: 0016, 0017（0001・0006・0011・0014 に追記）
- 要件: [20261024-nekogamisama-phase4.md](../requirements/20261024-nekogamisama-phase4.md)
- 影響範囲: `.claude/agents/`、`portal/`、`nekogamisama/`、`dashboard/server.mjs`、`docs/`、README

## 変更前
モデル・ツール接続は台帳上のメタ情報で、エージェントの実際の設定（`.claude/agents/*.md`）とは別だった。エージェントの追加は定義ファイルを手で書く必要があり、プロンプトの編集はポータルからできなかった。`.claude/agents/` は平置き。

## 変更後
ノードグラフから Claude のサブオーケストレーター・エージェントを追加でき、モデル・プロンプト・ツールを編集すると定義ファイルに書き込まれる。定義は `.claude/agents/<親の名前>/<名前>.md` に体系的に置かれ、ポータルが追加・移動・削除（trash へ退避）を管理する。

## 差分
- 移動: `.claude/agents/azure-*.md`（4 つ）→ `.claude/agents/azure-sage/`。内容は変更なし。
- 追加: `portal/backend/portal_api/definitions.py`、API（`POST /api/agents`、`GET /api/entities/{id}/definition`、`PUT /api/entities/{id}/prompt`）、ADR 0016・0017、要件資料。
- 変更:
  - バックエンド: `registry.py`（`definition`、定義ファイルへの書き込み、同期、委任先一覧の更新、管理ページ用の整合性チェック。`drift` は廃止）、`server.py`。
  - フロント: `admin.html`・`js/admin.js`・`js/api.js`（プロンプト編集、危険なツールの確認、プロンプト付きの追加ダイアログ、警告表示。`null` が文字列で出る表示崩れの修正）。
  - 猫神さま: `nekogamisama/CLAUDE.md`（`session` と `agent` の 2 つの呼び方）、`suborchestrators.json`（`type` を追加）、`bin/delegate.sh`（`agent` 型を拒否）。
  - Agent Console: `server.mjs`（`.claude/agents/` を再帰的に読む）。
  - ドキュメント: ルートの `CLAUDE.md`（フォルダ名）、ADR 0011 の前提の訂正、ADR 0014 の更新注記。
  - テスト: バックエンド 18 → 26 件、ブラウザ内 46 項目（変更なし）。
- 変更なし: ライセンス（新規依存なし）。

## 移行・注意点
- ポータルを再起動（または「組み込みを取り込み」）すると、台帳が定義ファイルに結び付く。UUID は変わらない。台帳のモデル・ツール接続は、定義ファイルの内容で更新される（ファイルが正）。
- 台帳には、定義ファイルを持たないエンティティ（Phase 1〜3 で手動登録したもの）が残る。詳細パネルに「定義ファイルのないエンティティ」と出て、プロンプトとツールは編集できない。
- `nekogamisama/` で CLI を使うときは、一度 `cd nekogamisama && claude` で信頼の確認に答える（ADR 0017）。
- Agent Console を再起動すると、`.claude/agents/` の階層を読んだモデル表示になる。
- 未確認: 猫神さまが追加したサブオーケストレーターへ Agent ツールで実際に依頼する動作（Claude との会話が必要）。
