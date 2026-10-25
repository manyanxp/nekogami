# ADR（Architecture Decision Records）

Azure Sage の設計判断と仕様の記録です。1 ファイル 1 判断、連番で追加します。

| No. | タイトル | 状態 |
|---|---|---|
| [0001](0001-orchestrator-and-subagents.md) | 指揮役 + 役割別サブエージェントの構成とモデル配分 | Accepted |
| [0002](0002-safety-and-permissions.md) | 読み取り中心の安全設計と権限制御 | Accepted |
| [0003](0003-dashboard-trace-and-chat.md) | Agent Console（トレース可視化 + チャット）の方式 | Accepted |
| [0004](0004-console-ui-spec.md) | Agent Console の画面仕様（リサイズ・猫アイコン・保存済みドキュメント） | Accepted |
| [0005](0005-deployment-docker.md) | 配布・実行方式（Docker / ローカル） | Accepted |
| [0006](0006-entity-registry-and-ids.md) | エンティティ台帳と UUID 管理 | Accepted |
| [0007](0007-portal-architecture.md) | ポータルの構成（フロント/バックエンド分離、Python 標準ライブラリ） | Accepted（標準ライブラリ・画面配信の部分は [0031](0031-nextjs-fastapi-split.md) で置換） |
| [0008](0008-authn-authz-decision.md) | 認証・認可の方針（Agent 365 型は導入しない） | Accepted |
| [0009](0009-docker-lifecycle-control.md) | Docker コンテナの起動・停止管理 | Accepted |
| [0010](0010-project-license.md) | 本体ライセンスは MIT、有料ライセンスは NOTICE で明示 | Accepted |
| [0011](0011-nekogamisama-hierarchy-and-delegation.md) | 猫神さまの階層と、サブオーケストレーターへの委任方式 | Accepted |
| [0012](0012-trace-nya-suffix.md) | トレースの発言に「にゃ」を付ける | Accepted |
| [0013](0013-admin-agent-and-admin-page.md) | 管理者エージェント（猫神さま）の保護と管理ページ | Accepted |
| [0014](0014-node-graph-editor.md) | ノードグラフエディタ（自作 SVG）とツール接続・モデル選択の位置づけ | Accepted（自作 SVG は [0031](0031-nextjs-fastapi-split.md) で @xyflow/react に置換） |
| [0015](0015-portal-chat-with-nekogamisama.md) | ポータルから猫神さまとチャットする方式 | Accepted |
| [0016](0016-agent-definition-files.md) | エージェント定義ファイル（.claude/agents/）を正とする | Accepted |
| [0017](0017-suborchestrator-as-agent-definition.md) | サブオーケストレーターをエージェント定義として追加し、Agent ツールで呼ぶ | Accepted |
| [0018](0018-delegation-editing-contextmenu-rename.md) | 委任先一覧の編集、右クリックメニュー、名前の変更 | Accepted |
| [0019](0019-chat-trace-in-portal.md) | ポータルのチャットで、選ばれたエージェントをトレースで見せる | Accepted |
| [0020](0020-agent-console-multi-target.md) | Agent Console への改称と、複数のサブオーケストレーターとの会話 | Accepted |
| [0021](0021-nekogamisama-personality.md) | 猫神さまの性格 | Accepted |
| [0022](0022-portal-layout-and-delegation-flow.md) | ポータルの画面配置の変更と、委任のフロー図 | Accepted |
| [0023](0023-code-quality-guidelines.md) | コード品質の基準を参照情報として取り込む | Accepted |
| [0024](0024-portal-panels-and-flow-view.md) | ポータルのパネル配置（4 パネルのドッキング）と、委任フロー・トレースの独立 | Accepted |
| [0025](0025-theme.md) | テーマ（ポータルと Agent Console の色） | Accepted |
| [0026](0026-chatbot-agent-and-slash-commands.md) | チャットボットエージェント（neko-chat）と / コマンド | Accepted |
| [0027](0027-console-per-agent.md) | エージェントごとの Agent Console | Accepted |
| [0028](0028-line-style-chat-and-uuid-flow.md) | LINE 風チャット・考え中の猫 GIF・フロー図の担当 UUID | Accepted |
| [0029](0029-markdown-preview-and-diagrams.md) | 回答のマークダウンプレビュー・コピーと、構成図の HTML 表示 | Accepted |
| [0030](0030-neko-goddess-avatar.md) | 猫神さまのアイコン | Accepted |
| [0031](0031-nextjs-fastapi-split.md) | 画面を Next.js、ポータルの API を FastAPI にする（公開に向けた再構成） | Accepted |
| [0032](0032-entity-icons.md) | エージェントのアイコン（変更・アップロード・既定） | Accepted |
| [0033](0033-terminal-windows.md) | エージェントごとのターミナル窓（ポータル） | Accepted |
| [0034](0034-frontend-backend-containers.md) | 画面と API を別コンテナにして、複数の PC から使う | Accepted |
| [0035](0035-login-and-roles.md) | ログイン（ローカルアカウント）と管理者／利用者のロール | Accepted |
| [0036](0036-trace-to-terminal-and-ui-icons.md) | トレースのパネルを廃止してターミナル窓に統合、UI アイコン | Accepted |
| [0037](0037-directory-nodes-and-permissions.md) | ディレクトリのノードと権限（担当が読み書き・削除できる作業領域） | Accepted |
| [0038](0038-python-execution-sandbox.md) | Python の生成・実行（実行役のコンテナと「Python 実行」権限） | Accepted |
| [0039](0039-local-llm-agent.md) | ローカル LLM の担当（Ollama + qwen3:8b、別セッション型） | Accepted |

## 運用ルール

- 新しい判断は `NNNN-<slug>.md` で追加する（テンプレート: [template.md](template.md)）。
- 既存 ADR の判断を変える場合は、書き換えず新しい ADR を作り、古い方の状態を `Superseded by NNNN` にする。誤記・追記程度の軽微な修正は直接直してよい。
- **仕様を変更したら [`../changes/`](../changes/README.md) に差分の履歴を 1 件追加する**（ADR の追加・更新が伴うときは相互リンクする）。
