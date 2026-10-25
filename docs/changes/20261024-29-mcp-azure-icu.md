# 2026-10-24 コンテナで Azure MCP が起動しない問題の修正

- 関連 ADR: 0002、0005
- 影響範囲: Docker イメージ（Agent Console）

## 変更前
コンテナ内の Azure MCP（`@azure/mcp`、.NET 製）が、`libicu` が無いため起動直後に落ち、猫神さまのセッションで `azure: failed` になっていた。

## 変更後
`Dockerfile` に `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` を設定。コンテナ内で `initialize` に応答することを確認した。

## 移行・注意点
- `docker compose up -d --build` で作り直す。
- 実際の Azure 操作には認証（`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`）が要る。未設定のあいだ、ツール呼び出しは認証エラーになる。
- 外部の MCP サーバーを足すときは、`.mcp.json` への追記に加えて、`dashboard/server.mjs` の `canUseTool`（許可リスト）に `mcp__<名前>__` を足す必要がある。
