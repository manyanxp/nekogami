# 2026-10-23 初期構成

- 関連 ADR: 0001, 0002, 0003, 0005
- 影響範囲: 全体

## 変更前
なし。

## 変更後
指揮役 + 4 サブエージェント、読み取り中心の権限、Agent Console（トレース + チャット）、Docker 配布。

## 差分
- 追加: `CLAUDE.md`, `.claude/agents/*`（researcher / inventory / reviewer / architect）, `.mcp.json`, `dashboard/`, `scripts/demo-events.mjs`, `knowledge/agent-platform-map.md`, `Dockerfile`, `docker-compose.yml`
