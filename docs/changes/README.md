# 仕様変更履歴（changes）

仕様を変えるたびに、**何がどう変わったか（差分）**を 1 件ずつ記録します。判断の理由は [ADR](../adr/README.md) 側、ここは「いつ・何が変わったか」の時系列です。

- ファイル名: `YYYYMMDD-NN-<slug>.md`（同日は NN で連番）。新しいものほど下に索引を追加。
- 書式: [template.md](template.md)
- ADR の追加・更新を伴う場合は両方からリンクする。

## 索引

| 日付 | 変更 | 関連 ADR |
|---|---|---|
| 2026-10-23 | [初期構成](20261023-01-initial-spec.md) | 0001, 0002, 0003, 0005 |
| 2026-10-24 | [画面リサイズ対応](20261024-01-resizable-panes.md) | 0004 |
| 2026-10-24 | [保存済みマークダウン表示と猫アイコン](20261024-02-saved-docs-and-cat-icons.md) | 0003, 0004 |
| 2026-10-24 | [docs/ への集約とライセンス台帳](20261024-03-docs-and-licenses.md) | — |
| 2026-10-24 | [マルチエージェント管理ポータルと MIT ライセンス](20261024-04-multi-agent-portal.md) | 0006〜0010 |
| 2026-10-24 | [猫神さま（NekoGamiSama）Phase 2](20261024-05-nekogamisama.md) | 0011, 0012 |
| 2026-10-24 | [猫神さま管理ページとノードグラフ（Phase 3）](20261024-06-admin-page-and-node-graph.md) | 0013, 0014 |
| 2026-10-24 | [モデル選択とポータルのチャット欄（Phase 3 追記）](20261024-07-model-select-and-portal-chat.md) | 0014, 0015 |
| 2026-10-24 | [Claude のエージェント定義の追加・編集（Phase 4）](20261024-08-claude-agent-definitions.md) | 0016, 0017 |
| 2026-10-24 | [委任先の編集・右クリックメニュー・改名・チャットのトレース（Phase 4 追記）](20261024-09-delegation-contextmenu-rename-trace.md) | 0018, 0019 |
| 2026-10-24 | [Agent Console の汎用化・画面配置・フロー図・性格（Phase 5）](20261024-10-agent-console-layout-flow-personality.md) | 0020, 0021, 0022 |
| 2026-10-24 | [Agent Console のフローを相手ごとに・Console のダイアログ・フロー図が光らない不具合の修正（Phase 5 変更）](20261024-12-console-per-target-flow-and-flow-fix.md) | 0019, 0020, 0022 |
| 2026-10-24 | [パネル配置・テーマ・チャットボットと / コマンド（rev2）](20261024-13-rev2-panels-theme-chatbot.md) | 0024, 0025, 0026 |
| 2026-10-24 | [エージェントごとの Agent Console](20261024-14-console-per-agent.md) | 0027 |
| 2026-10-24 | [LINE 風チャット・考え中の猫 GIF・フロー図の担当 UUID](20261024-15-line-chat-gif-uuid.md) | 0028 |
| 2026-10-24 | [委任コマンドのパスの不具合修正](20261024-16-delegate-path-fix.md) | 0011 |
| 2026-10-24 | [マークダウンのプレビュー・コピーと構成図の HTML 表示](20261024-17-markdown-preview-diagram.md) | 0029 |
| 2026-10-24 | [猫神さまのアイコン](20261024-18-neko-goddess-avatar.md) | 0030 |
| 2026-10-24 | [画面を Next.js、API を FastAPI に載せ替え](20261024-19-nextjs-fastapi.md) | 0031 |
| 2026-10-24 | [ルートの CLAUDE.md を猫神さま（現行仕様）に変更](20261024-20-root-claude-md-nekogamisama.md) | 0011, 0016, 0017, 0021, 0026, 0031 |
| 2026-10-24 | [アイコンの変更・アップロード・既定](20261024-21-entity-icons.md) | 0032 |
| 2026-10-24 | [不要なコード・ファイルの整理](20261024-22-cleanup.md) | — |
| 2026-10-24 | [azure-sage の委任先を azure-architect（agent 型）にそろえる](20261024-23-azure-sage-agent-type.md) | 0017 |
| 2026-10-24 | [エージェントごとのターミナル窓](20261024-25-terminal-windows.md) | 0033 |
| 2026-10-24 | [考え中の GIF を太陽の猫神さまにする](20261024-24-sun-cat-running-gif.md) | 0028 |
| 2026-10-24 | [コード品質の基準を参照情報として追加](20261024-11-code-quality-guidelines.md) | 0023 |
| 2026-10-24 | [ポータルの LAN 公開モード](20261024-26-portal-lan-mode.md) | [0031](../adr/0031-nextjs-fastapi-split.md) |
| 2026-10-24 | [ターミナル窓の位置・待ち時間と、並列実行の指示](20261024-27-terminal-position-and-parallel.md) | [0033](../adr/0033-terminal-windows.md) |
| 2026-10-24 | [チャットの「作業中…」が消えないときの自己修復](20261024-28-chat-busy-reconcile.md) | [0015](../adr/0015-portal-chat-with-nekogamisama.md) |
| 2026-10-24 | [コンテナで Azure MCP が起動しない問題の修正](20261024-29-mcp-azure-icu.md) | [0005](../adr/0005-deployment-docker.md) |
| 2026-10-25 | [画面と API の別コンテナ化 / ログインとロール / 画像素材の扱い](20261025-35-login-and-roles.md) | [0034](../adr/0034-frontend-backend-containers.md)・[0035](../adr/0035-login-and-roles.md)・[0010](../adr/0010-project-license.md) |
| 2026-10-25 | [トレースのパネルを廃止、UI アイコン（rev1 の第 1 段階）](20261025-37-trace-to-terminal-and-ui-icons.md) | [0036](../adr/0036-trace-to-terminal-and-ui-icons.md) |
| 2026-10-25 | [ディレクトリのノードと権限（rev1 の第 2 段階）](20261025-38-directory-nodes.md) | [0037](../adr/0037-directory-nodes-and-permissions.md) |
