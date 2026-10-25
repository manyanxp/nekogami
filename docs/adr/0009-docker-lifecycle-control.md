# 0009. Docker コンテナの起動・停止管理

- 状態: Accepted
- 日付: 2026-10-24

## 背景
追加するエージェントは Docker コンテナ + Docker Compose で動かし、UI から起動・停止したい（要件 R6）。

## 決定
- エンティティの `runtime` に `type=docker`, `compose_file`, `service`（任意で `url`）を持たせる。種類は `docker` / `builtin`（Agent Console 内）/ `external`（外部で稼働、管理は一覧のみ）。
- ポータルは `docker compose -f <file> up -d <service>` / `stop <service>` / `ps -a --format json <service>` を実行する。状態は running / stopped / not_created / unknown。
- 安全策:
  - 引数は配列で渡し、シェルを介さない。
  - `compose_file` はプロジェクト配下の `.yml/.yaml` のみ、`service` は英数字と `. _ -` のみ（登録時に検証）。
  - 無効化（`enabled=false`）したエンティティは起動不可。タイムアウトあり（起動 300 秒、停止 120 秒、状態 15 秒）。
  - `PORTAL_DOCKER=0` で操作を無効化できる。
- 追加エージェントの Compose は `agents/<名前>/docker-compose.yml` に置く（ひな形: `agents/example/`）。
- ポータル自体は**ホストで実行**する（コンテナ化しない）。

## 理由・検討した代替案
ポータルをコンテナで動かすには Docker ソケットのマウントが要り、事実上ホストの root 相当の権限を渡すことになるため見送り。Docker SDK for Python は依存が増えるため CLI 呼び出しを採用。

## 影響
- ホストに Docker（Compose v2）が必要。
- 停止は `stop`（コンテナは残る）。完全削除は UI からは行わない。
- 関連: `portal/backend/portal_api/docker_ctl.py`, `agents/`
