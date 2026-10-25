# 猫神さま Portal

オーケストレーター / サブオーケストレーター / エージェント / サブエージェントを一覧管理し、Docker で動くエージェントを UI から起動・停止するポータルです。

```
portal/
├─ backend/    Python 3.10+、FastAPI（:4401）。ポータルの REST API（画面は配らない）
│   ├─ portal_api/app.py        ルーティング、Host/Origin 検証、任意トークン認証
│   ├─ portal_api/registry.py   台帳（UUID、親子、検証、JSON 永続化）
│   ├─ portal_api/definitions.py 定義ファイル（.claude/agents/）の読み書き
│   ├─ portal_api/icons.py      アイコン（組み込み・アップロード）
│   ├─ portal_api/chat.py       Agent Console への中継、/ コマンド
│   ├─ portal_api/theme.py・personality.py・docker_ctl.py
│   └─ tests/                   単体・API テスト
├─ assets/icons/  アイコン選択用の組み込み画像（scripts/make-avatar.py で生成）
└─ data/       registry.json・theme.json・icons/・backups/・trash/（実行時に作成。git 管理外）
```

画面は `web/`（Next.js、:4400）です（[ADR 0031](../docs/adr/0031-nextjs-fastapi-split.md)）。

## 起動
```bash
scripts/portal.sh            # → http://127.0.0.1:4400
```
初回に猫神さま（`nekogamisama`）、Azure Sage（サブオーケストレーター）、`.claude/agents/` 以下の定義（再帰。フォルダ名が親）を自動登録します。定義ファイルが正で、台帳のモデル・ツール接続は取り込みのたびにファイルの内容に更新されます。Phase 1 の台帳は自動で移行します（「組み込みを取り込み」で再実行可、冪等）。

## 設定（環境変数）
| 変数 | 既定 | 内容 |
|---|---|---|
| `PORTAL_HOST` / `PORTAL_PORT` | `127.0.0.1` / `4401` | API の待受先（画面は 4400） |
| `PORTAL_TOKEN` | なし | 設定すると API に `Authorization: Bearer` が必要（個人利用は不要） |
| `PORTAL_DOCKER` | `1` | `0` で起動・停止を無効化 |
| `CONSOLE_URL` | `http://127.0.0.1:4317` | 組み込みオーケストレーターのリンク先 |
| `PORTAL_DATA` | `portal/data/registry.json` | 台帳ファイル |

## API
`GET/POST /api/icons`・`GET/DELETE /api/icons/{参照}`、`GET/PUT /api/theme`、`GET /api/chat/commands`、`GET/PUT/POST /api/admin/personality`、`GET /api/delegation`・`PUT/DELETE /api/delegation/{名前}`、`POST /api/agents`、`GET /api/entities/{uuid}/definition`、`PUT /api/entities/{uuid}/prompt`、`POST /api/chat`・`/api/chat/stop`・`/api/chat/reset`、`GET /api/chat/stream`、`GET /api/admin/overview`、`GET/POST /api/tools`、`PATCH/DELETE /api/tools/{uuid}`、`GET/POST /api/entities`、`GET/PATCH/DELETE /api/entities/{uuid}`（`?cascade=1`）、`GET /api/entities/{uuid}/status`、`POST /api/entities/{uuid}/start|stop`、`POST /api/sync-builtin`、`GET /api/health`。

## 画面
- 一覧（http://127.0.0.1:4400）: サブオーケストレーター以下。ヘッダーの「🐾 猫神さま管理」から管理ページへ。
- グラフ上の右クリック: 背景・ノードから新規追加、名前の変更、削除、接続の解除（[ADR 0018](../docs/adr/0018-delegation-editing-contextmenu-rename.md)）。管理ページの「委任先の突き合わせ」で、台帳と委任設定（`suborchestrators.json`）を同時に編集し、片方にしかないものを「整える」でそろえられる。
- 一覧のサブオーケストレーターの行の「🖥 Console」: そのサブオーケストレーターを相手に選んだ Agent Console を、ダイアログで開く（[ADR 0020](../docs/adr/0020-agent-console-multi-target.md)）。
- 画面の配置: 一覧・チャット・委任フロー・トレースの 4 つのパネルを、ヘッダー（⠿）のドラッグで、左の列・右の列・下の行へ移動でき、境界のドラッグでサイズ変更（ダブルクリックで既定に戻る）。既定は、左に 一覧 → 委任フロー → トレース、右にチャット（[ADR 0024](../docs/adr/0024-portal-panels-and-flow-view.md)）。
- チャットの `/`: `/` で委任先・エージェントの候補が出て、`/名前 依頼文` で猫神さまにその相手を指名する。`/help` で一覧（[ADR 0026](../docs/adr/0026-chatbot-agent-and-slash-commands.md)）。
- 管理ページの「🎨 テーマ」で、ポータルと Agent Console の色（モードとアクセント色）を設定する（[ADR 0025](../docs/adr/0025-theme.md)）。
- 管理ページの「猫神さまの性格」で、猫神さまの一人称・口調・性格を設定する（[ADR 0021](../docs/adr/0021-nekogamisama-personality.md)）。
- 右のチャット欄: 猫神さまと会話できる（ポータルが Agent Console `CONSOLE_URL` に中継。Agent Console の起動と Claude の認証が必要。下に、選ばれたエージェントのトレースが出る（[ADR 0019](../docs/adr/0019-chat-trace-in-portal.md)）。[ADR 0015](../docs/adr/0015-portal-chat-with-nekogamisama.md)）。
- 猫神さま管理（/admin）: 猫神さまは削除・無効化・改名・親変更ができない（API が 403）。ノードグラフで Claude のサブオーケストレーター・エージェントを追加・削除し、親子の付け替え・ツール接続・モデルの選択・プロンプトの編集ができる。**変更は定義ファイル（`.claude/agents/<親の名前>/<名前>.md`）に書き込まれる**（書き換え前は `portal/data/backups`、削除は `portal/data/trash` へ退避。[ADR 0016](../docs/adr/0016-agent-definition-files.md)）。

## テスト
```bash
cd portal/backend && ../../.venv/bin/python -m unittest discover -s tests   # バックエンド
cd web && npx vitest run && npx tsc --noEmit                                  # 画面のロジックと型
```
