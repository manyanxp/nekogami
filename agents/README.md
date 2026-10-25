# agents/ — 追加エージェントの置き場

追加するエージェントは `agents/<名前>/docker-compose.yml` に Compose 定義を置きます。

1. `agents/example/docker-compose.yml` をコピーして編集する（サービス名・image・ポート）。
2. ポータル（`scripts/portal.sh` → http://127.0.0.1:4400）で「＋ 追加」し、ランタイムに **docker**、compose ファイルとサービス名を指定する。
3. 一覧の「▶ 起動」「■ 停止」で `docker compose up -d <service>` / `stop <service>` が実行される。

ポータルが操作できるのは、台帳に登録された compose ファイル（プロジェクト配下の `.yml/.yaml`）とサービスだけです。
