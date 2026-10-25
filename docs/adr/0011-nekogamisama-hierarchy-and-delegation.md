# 0011. 猫神さまの階層と、サブオーケストレーターへの委任方式

- 状態: Accepted
- 日付: 2026-10-24

> **訂正（2026-10-24）**: 下の「サブエージェントはさらにサブエージェントを起動できない」は誤りだった。公式ドキュメントでは起動できる（既定 3 層まで）。この ADR の `session` 型（別セッションでの委任）は引き続き有効で、追加するサブオーケストレーターは [ADR 0017](0017-suborchestrator-as-agent-definition.md) の `agent` 型を使う。

## 背景
Phase 2 で、既存の Azure Sage を残したまま、全体を束ねる上位オーケストレーター「猫神さま」を作る（要件 P1〜P4）。Claude Code のサブエージェントは、さらにサブエージェントを起動できない（私の理解。公式ドキュメントでの再確認は未実施）。そのため、「猫神さま → Azure Sage → 4 サブエージェント」を 1 つのセッション内で入れ子にはできない。

## 決定
- **階層**（台帳の `kind`）: `orchestrator`（猫神さま）→ `suborchestrator`（azure-sage ほか）/ `agent` → `subagent`。
  - `suborchestrator` の親は `orchestrator` のみ。`agent` の親は `orchestrator` か `suborchestrator`。`subagent` の親は `agent` / `suborchestrator` / `orchestrator`。
  - 組み込み: `nekogamisama`（orchestrator）、`azure-sage`（suborchestrator、親 = nekogamisama）、`.claude/agents/*.md` の 4 つ（subagent、親 = azure-sage）。
  - `azure-sage` の UUID は Phase 1 と同じ（UUID v5 の元の名前 `orchestrator:azure-sage` を維持）。Phase 1 の台帳は `sync-builtin` 時に kind と親を更新して移行する。
- **配置**: 猫神さまは `nekogamisama/`（`CLAUDE.md`、`.claude/settings.json`、`suborchestrators.json`、`bin/delegate.sh`）。Azure Sage のファイルは変更しない。
- **委任**: 猫神さまが Bash で `nekogamisama/bin/delegate.sh <名前> '<依頼文>'` を実行し、スクリプトが `suborchestrators.json` で解決したフォルダで `claude -p` を別セッションとして起動する。依頼文は標準入力で渡す。
  - 名前は `suborchestrators.json` にあるものだけ。名前は `^[a-z0-9][a-z0-9-]*$`。
  - 実行時間の上限は 900 秒（`DELEGATE_TIMEOUT`）。
  - 委任先のセッションは自分の `.claude/settings.json` のフックでも Agent Console へトレースを送るので、トレースには猫神さまと Azure Sage の両方が流れる。
- **権限**: 猫神さまの Bash は `delegate.sh` のみ（CLI は `permissions.allow`、チャットは `canUseTool` の正規表現）。チャット側は「依頼文が単一引用符で囲まれ、中に単一引用符がない」形に限り、コマンド連結や展開を持ち込めないようにする。Write/Edit は不可。
- **チャット先の切替**: 環境変数 `CHAT_PROJECT_DIR`（既定 `.` = Azure Sage、`nekogamisama` = 猫神さま）が、Agent Console の既定の相手。Phase 3 でリクエストの `agent` による相手の切替を追加した（[ADR 0015](0015-portal-chat-with-nekogamisama.md)）。

## 理由・検討した代替案
- Azure Sage を猫神さまのサブエージェントにする案: 入れ子ができず、Azure Sage が自分の 4 サブエージェントを使えなくなるので不採用。
- ルートを猫神さまにして Azure Sage をサブフォルダへ移す案: 「Azure 調査のエージェント群を残したまま」に反し、パスの変更がドキュメントとダッシュボードに広がるので不採用。
- 依頼文を引数でそのまま `claude -p "$prompt"` に渡す案: `-` で始まる依頼文がオプションとして解釈されるので、標準入力にした。
- Docker で動くサブオーケストレーターへの HTTP 委任: 将来の拡張。今回は同一マシンのフォルダ委任のみ。

## 影響
- 良い点: Azure Sage は無変更で、サブオーケストレーターを増やすときは `suborchestrators.json` と台帳に足すだけ。
- 制約・注意:
  - 委任先は別セッションなので、会話の文脈は共有されない（依頼文に前提を書く）。コストと時間も別途かかる。
  - `nekogamisama/` で起動したセッションは、親フォルダの `CLAUDE.md`（Azure Sage 用）も読み込む可能性がある。`nekogamisama/CLAUDE.md` で役割を明示して打ち消しているが、実機での挙動は未確認。
  - 実機での委任（認証が必要）は未確認。
- 関連: `nekogamisama/`、`portal/backend/portal_api/registry.py`、`dashboard/server.mjs`（`canUseTool`・`CHAT_DIR`）、[ADR 0001](0001-orchestrator-and-subagents.md)、[ADR 0006](0006-entity-registry-and-ids.md)

## 追記（2026-10-24）: 委任コマンドは作業場所基準でも許可する
Agent Console（Docker）では、猫神さまの作業場所が `/app/nekogamisama` になる。そこで `nekogamisama/bin/delegate.sh` と書くと `/app/nekogamisama/nekogamisama/bin/…` を探して失敗し、チャットの許可は決まりの形しか通さないため、猫神さまは委任できず止まった（実際の会話で発生）。許可する形を `bin/delegate.sh`（作業場所基準。`./` 付きと `nekogamisama/` 付きも可）にし、`nekogamisama/CLAUDE.md` の案内も `bin/delegate.sh` にした。CLI 側の許可（`settings.json`）にも同じ形を足した。ほかの書き方（連結・`cd`・上位への相対パス）は、これまでどおり拒否する。コンテナ内で `bin/delegate.sh`（作業場所 `/app/nekogamisama`）が動くことは確認済み。実際の Claude での委任の成功は未確認。
