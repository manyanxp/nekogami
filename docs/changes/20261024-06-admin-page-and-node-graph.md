# 2026-10-24 猫神さま管理ページとノードグラフ（Phase 3）

- 関連 ADR: 0013, 0014
- 要件: [20261024-nekogamisama-phase3.md](../requirements/20261024-nekogamisama-phase3.md)
- 影響範囲: `portal/`（バックエンド・フロント）、`docs/`、README

## 変更前
猫神さまは通常のエンティティで、API から削除できた。ポータルの一覧に猫神さまも並び、ツリーの折りたたみはなかった。構成の編集はフォームのみで、ツールの概念はなかった。

## 変更後
猫神さまは保護され（削除・無効化・改名・親変更は 403）、専用の管理ページ（`/admin.html`）で扱う。ポータルの一覧はサブオーケストレーター以下をツリーで表示し、▼/▶ で折りたためる。管理ページのノードグラフで、サブオーケストレーター・エージェント・サブエージェント・ツールの追加、削除、親子の付け替え、ツール接続ができる。

## 差分
- 追加: `portal/frontend/admin.html`・`js/admin.js`・`js/graph.js`・`js/graph-model.js`・`css/admin.css`、`portal/frontend/test/index.html`（ブラウザ内テスト）、ADR 0013・0014、要件資料。
- 変更:
  - バックエンド: `registry.py`（`protected`、`tool_ids`、`pos`、ツールの台帳、管理ページ用の概要、台帳ファイルを version 2 に）、`server.py`（403、`/api/tools`、`/api/admin/overview`、ディレクトリの `index.html`）、`config.py`、`__main__.py`。
  - フロント: `model.js`（ツリーの折りたたみ・猫神さまの非表示）、`app.js`・`index.html`・`style.css`（トグル、管理ページへのリンク）、`api.js`。
  - テスト: 9 → 15 件のバックエンドテスト、ブラウザ内 42 項目。
- 変更なし: `nekogamisama/`、`dashboard/`、`.claude/`、ライセンス（新規依存なし）。

## 移行・注意点
- 既存の台帳は、ポータルの起動時（または「組み込みを取り込み」）に自動で移行される。猫神さまに `protected` が付き、組み込みのサブエージェントには `.claude/agents/*.md` の `tools:` から初期のツール接続が入る。UUID は変わらない。台帳は version 2 になる（古い版のポータルでは読めるが、`tools` は無視される）。
- ポータルを再起動すると反映される。
- ツール接続は台帳上のメタ情報で、エージェントの実際の権限は変わらない。
- 未確認: グラフのダイアログ操作と確認ダイアログの実操作（ブラウザの手動確認）。
