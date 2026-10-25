# 0002. 読み取り中心の安全設計と権限制御

- 状態: Accepted
- 日付: 2026-10-23

## 背景
Azure 環境を扱うエージェントが、意図せずリソースを変更・破壊してはならない。

## 決定
- Azure リソースの作成・変更・削除は行わない（読み取りと提案のみ）。IaC は提案としてファイルに書くまで。
- チャットモード（`dashboard/server.mjs` の `canUseTool`）:
  - 許可: Read / Glob / Grep / WebSearch / WebFetch / Agent / Task / TodoWrite / ToolSearch、Microsoft Learn MCP、Azure MCP（`ALLOW_AZURE_MCP=0` で無効化可）
  - Write / Edit は `reports/` と `research/` 配下のみ許可
  - それ以外（Bash 等）は拒否し、トレースに「拒否」として表示
- CLI モード: `.claude/settings.json` の allow/deny が有効。`az` の作成・削除・更新系は拒否。
- Azure の認証は Reader ロールのアカウント／サービスプリンシパルを推奨（実権限は RBAC で決まる）。
- サーバーは既定で `127.0.0.1` のみ待受。共有する場合は認証付きリバースプロキシを前段に置く。
- 保存済みドキュメント API は `reports/`・`research/` 内の `.md` だけを返す（パス検証あり）。

## 理由・検討した代替案
プロンプトの指示だけでなく、ツール権限という強制力のある層で制限する。Bash を許可して `az` を制御する案は、抜け道が多いため不採用。

## 影響
- 安全だが、Bash が必要な作業（ビルド等）はチャットからはできない。
- 関連: `dashboard/server.mjs`, `.claude/settings.json`, `.mcp.json`
