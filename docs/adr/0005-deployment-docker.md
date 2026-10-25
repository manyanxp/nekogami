# 0005. 配布・実行方式（Docker / ローカル）

- 状態: Accepted
- 日付: 2026-10-24

## 背景
環境差をなくし、成果物と認証状態を保ちながら動かしたい。

## 決定
- ローカル: `cd dashboard && npm install && npm start`（http://127.0.0.1:4317）。
- Docker: `docker-compose.yml` で `neko-brain`（Agent Console。当初は `azure-sage`）を 1 サービスとして起動。公開先は `BIND_ADDR`（既定 `127.0.0.1`、LAN 公開は `0.0.0.0`）。
- 認証: `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`、または `claude` で `/login`。ログイン状態はボリューム `claude-config` に保持。
- 成果物 `reports/`・`research/` はホストへバインドマウント。
- Azure MCP を使う場合は `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`（Reader 推奨）。
- `.mcp.json`: Microsoft Learn（HTTP）と Azure MCP（`npx @azure/mcp`、要 Node/npx）。

## 影響
- `npx` が無い環境では Azure MCP が接続失敗する（Learn MCP は影響なし）。
- 現在の compose は 3 コンテナ（[0034](0034-frontend-backend-containers.md)）。ログインは [0035](0035-login-and-roles.md)。
- LAN 公開時は ADR 0002 のとおり認証付きプロキシを前置すること。
- 関連: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.mcp.json`
