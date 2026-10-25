# 2026-10-25 画面と API を別コンテナにした

- 関連 ADR: 0034、0005、0008
- 影響範囲: `docker-compose.yml`、`web/Dockerfile`、`portal/backend/Dockerfile`、`portal/backend/portal_api/app.py`

## 変更前
compose は Agent Console のみ。画面と API はホストで `scripts/portal.sh` を実行していた。

## 変更後
`web` / `api` / `azure-sage` の 3 コンテナ。公開は `web` のみ（`BIND_ADDR`、`WEB_PORT`）。`host_ok` が、0.0.0.0 待ち受けのとき Origin と `X-Forwarded-Host` を突き合わせる（テスト追加、40 件成功）。
LAN 上の別 IP から、画面・`/api`・`/console-api`・SSE（`/console-events`）が通ることと、不正な Origin が 403 になることを確認した。

## 移行・注意点
- `docker compose up -d --build`。Agent Console のポート 4317 は公開しなくなった（画面経由で使う）。
- 複数 PC で使う: `BIND_ADDR=0.0.0.0 PORTAL_TOKEN=... docker compose up -d --build`。
- 依存の追加なし（`docs/licenses/` の更新は不要）。
