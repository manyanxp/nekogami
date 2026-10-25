# 0034. 画面と API を別コンテナにして、複数の PC から使う

- 状態: Accepted（[0005](0005-deployment-docker.md) の「compose は Agent Console の 1 サービス」を置き換える）
- 日付: 2026-10-25

## 背景
画面（Next.js）と API（FastAPI）はホストで直接動かしていた。複数の PC のブラウザから猫神さまを使いたい。

## 決定
`docker-compose.yml` を 3 サービスにする。ブラウザが開くのは `web` だけ。

| サービス | 中身 | 公開 |
|---|---|---|
| `web` | Next.js（`web/Dockerfile`）。`/api/*` → `api`、`/console-api/*`・`/console-events` → `neko-brain`（旧 `azure-sage`）へ中継 | `${BIND_ADDR:-127.0.0.1}:${WEB_PORT:-4400}` |
| `api` | FastAPI（`portal/backend/Dockerfile`）。台帳・定義・性格・テーマ | なし（コンテナ間のみ） |
| `neko-brain` | Agent Console（猫神さまの脳。旧名 `azure-sage`）（従来どおり。`claude` の実行） | なし（コンテナ間のみ） |

- 複数 PC から使うときは `BIND_ADDR=0.0.0.0 PORTAL_TOKEN=<長い文字列> docker compose up -d --build`。各 PC は `http://<ホストの IP>:4400` を開く。
- `api` はプロジェクトの `portal/data`・`.claude`・`nekogamisama` などをバインドマウントして読み書きする。`azure-sage` も `.claude/agents` と `nekogamisama` をマウントし、ポータルでの編集がすぐ届く。
- 中継先は Next.js のビルド時に固定されるため、`web` のビルド引数（`PORTAL_API_URL` / `CONSOLE_URL`）で渡す。サービス名を変えたら再ビルドする。
- `api` は 0.0.0.0 で待ち受けるので、Host の許可リストは使えない。代わりに「Origin が `X-Forwarded-Host`（ブラウザが見ているホスト）と同じ」ことを検査する。他サイトからの操作は 403。
- `api` ではコンテナからの `docker compose` 操作を切る（`PORTAL_DOCKER=0`）。ポータルの起動・停止ボタンは使えない。

## 影響・注意
- 認証は共有トークンだけ（[0008](0008-authn-authz-decision.md)）。LAN に出すときは `PORTAL_TOKEN` を必ず設定し、信頼できないネットワークでは TLS 付きのリバースプロキシを前置する。トークンなしで `0.0.0.0` にしない。
- 同時に使える `claude` セッションは、従来どおり Agent Console 側の制約に従う（複数 PC が同じ会話を共有する）。利用者ごとの分離は未対応。
- `scripts/portal.sh`（ホストで直接動かす方法）は開発用として残す。
