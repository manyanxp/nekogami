# 0016. エージェント定義ファイル（.claude/agents/）を正とする

- 状態: Accepted
- 日付: 2026-10-24

## 背景
Phase 3 までは、台帳のモデル・ツール接続は「メタ情報」で、実際のエージェントの設定（`.claude/agents/*.md`）とは別だった（ADR 0014）。Phase 4 の要求 S1〜S3 は、これを実際の設定にし、定義を `.claude/agents/` 以下で体系的に管理することを求めている。

## 決定
- **定義ファイルが正、台帳はその写し。** `portal/backend/portal_api/definitions.py` が読み書きする。
  - 対象は 3 種類だけ: `.claude/agents/<フォルダ>/<名前>.md`、`CLAUDE.md` と `nekogamisama/CLAUDE.md`（プロンプト）、`.claude/settings.json` と `nekogamisama/.claude/settings.json` の `model`。API の入力から任意のパスは受け取らない（フォルダ名・名前は `[A-Za-z0-9][A-Za-z0-9._-]*` で検証し、`.claude/agents/` の外へ出るパスは拒否）。
- **配置の規則**: `.claude/agents/<親の名前>/<名前>.md`。サブオーケストレーターは自分の名前のフォルダに `<名前>/<名前>.md`（その子のエージェントも同じフォルダ）。フォルダ名は人が読むための分類で、Claude Code は `name`（frontmatter）で識別する（名前は全体で一意）。Azure Sage の 4 エージェントは `.claude/agents/azure-sage/` に移した。
- **追加・編集・移動・削除**:
  - 追加: `POST /api/agents`（ノードグラフの「＋」）。frontmatter は `name` / `description` / `role`（`suborchestrator`・`agent`・`subagent`。Claude Code は未知のキーを無視する）/ `model` / `tools`、本文はプロンプト（空なら雛形）。**`tools` は必ず明示する**（省略すると全ツールを継承するため）。既定は読み取り中心: サブオーケストレーター `Agent, Read, Glob, Grep`、エージェント `Read, Glob, Grep, WebSearch, WebFetch`。
  - 編集: モデル・説明・ツール接続は `PATCH /api/entities/{id}`、プロンプトは `PUT /api/entities/{id}/prompt`（`GET .../definition` で読む）。**編集する項目の行だけ**を差し替え、`effort` / `color` / `disallowedTools` などほかの行と本文は元のまま（変更なしの往復はバイト単位で同一）。`description` に `: ` などを含むときは YAML として壊れないよう引用符で囲む。
  - 移動: 親を付け替えると、定義ファイルも新しい親のフォルダへ移す（空になったフォルダは片付ける）。
  - 削除: ファイルは `portal/data/trash/` へ移す（消さない）。書き換え前は `portal/data/backups/` に退避する（git 管理外のため）。
  - 名前の変更は、ファイル名・フォルダ・委任先一覧も追随させる（[ADR 0018](0018-delegation-editing-contextmenu-rename.md)）。
- **ツール接続 ⇔ `tools`**: グラフのツールノードとの接続を `tools` に反映する。外した項目は消し、残る項目は元の書き方のまま残す（例: `mcp__server__個別ツール`）。新しく接続する MCP サーバーは `mcp__<サーバー>__*`。カタログにないツール名（例: `TodoWrite`）はグラフで操作できないので保持し、詳細パネルに表示する。`tools` 未指定のエージェントは「全ツール継承」と表示し、最初のツール接続で、接続したものだけに制限されることを確認する。
- **安全**:
  - `Bash` / `Write` / `Edit` / `NotebookEdit` を新しく足すときは明示の確認が要る（UI の確認ダイアログと API の `allow_dangerous`）。新規作成時には付けられない。
  - `permissionMode`・`hooks`・`mcpServers` など権限に関わるキーは、API から変更できない。
  - プロンプトは 5 万文字まで。失敗したときは、ファイルも台帳も変えない。
- **同期**: `POST /api/sync-builtin`（ポータル起動時にも実行）が `.claude/agents/` を再帰的に走査して台帳を更新する。台帳にあれば model / description / ツール接続をファイルから更新（ファイルが正）、無ければ登録する。親は「フォルダ名のエンティティ」、フォルダ直下の定義は azure-sage の配下、`role: suborchestrator` は猫神さまの直下。不正な定義は読み飛ばす。規則から外れた配置と、ファイルが無いエンティティは、管理ページに警告する。

## 理由・検討した代替案
- 台帳を正にして、実行時に定義を生成する案: Claude Code が直接読むファイルが別に要るので二重管理になる。ファイルを正にすると、手で編集しても、CLI やダッシュボードからもそのまま使える。
- YAML ライブラリで frontmatter を読み書きする案: 依存が増え、再整形で既存ファイルの書き方（コメント・並び・引用符）が変わる。編集する行だけ差し替える方が、差分が最小になる。
- フォルダを使わず `.claude/agents/` 直下に平置きする案: Claude Code はどちらも読めるが、サブオーケストレーターごとの管理が難しくなる。

## 影響
- 良い点: ポータルでの編集が実際のエージェントの設定になる。手で書いた定義もポータルに現れる。ファイルは git などで差分管理できる。
- 制約・注意:
  - Claude Code は作業ディレクトリから親へ辿って `.claude/agents/` を読むため、**フォルダ分けは分類であって隔離ではない**。猫神さまや他のサブオーケストレーターからも、ほかのフォルダのエージェントが見える（確認済み）。呼び分けはプロンプトの記述と `description` に依存する。
  - `.claude/agents/` 以下は、ポータルを通さず手で変えてもよい（同期でポータルに反映される）。ただし台帳の編集とファイルの編集が競合したときはファイルが勝つ。
  - 指揮役（猫神さま・Azure Sage）のモデルは `settings.json` の `model` を書き換える（該当の 1 行だけ）。実行中の Agent Console には再起動後に反映される。
- 関連: `portal/backend/portal_api/definitions.py`・`registry.py`・`server.py`、`portal/frontend/js/admin.js`、[ADR 0001](0001-orchestrator-and-subagents.md)・[0006](0006-entity-registry-and-ids.md)・[0014](0014-node-graph-editor.md)
