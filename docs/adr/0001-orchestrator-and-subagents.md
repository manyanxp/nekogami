# 0001. 指揮役 + 役割別サブエージェントの構成とモデル配分

- 状態: Accepted
- 日付: 2026-10-23

## 背景
Azure 全般（Foundry / Agent 365 含む）の調査と開発提案を、コストと品質を両立して行いたい。

## 決定
- 指揮役（orchestrator, sonnet）は `CLAUDE.md` のルールに従い、自分では長い調査をせずサブエージェントに分担して結果を統合する。
- サブエージェントは `.claude/agents/*.md` で定義し、`model:` でモデルを固定する。

| エージェント | モデル | 役割 |
|---|---|---|
| azure-researcher | haiku | Microsoft Learn MCP / Web で一次情報を収集。観点ごとに並列起動 |
| azure-inventory | haiku | Azure MCP でサブスクリプション現状を**読み取りのみ**で確認 |
| azure-reviewer | opus | 出典照合、GA/Preview、リージョン・価格・ライセンス・廃止予定、矛盾の指摘 |
| azure-architect | opus | 精査済みの事実から構成・IaC 方針・セキュリティ・コスト・段階導入を提案 |

- 標準ワークフロー: 分解（2〜4 観点）→ 並列調査 → 精査（再調査は最大 1 往復）→ 提案（求められたときのみ）→ 回答（結論 → 根拠 → 未確定/リスク → 出典。日本語）。長い成果物は `reports/YYYYMMDD-<topic>.md`。
- 単純な事実確認は researcher 1 体で済ませる。
- 情報源は Microsoft Learn 最優先。Preview/GA/廃止予定・リージョン・ライセンスは必ず明記し、不明は「未確認」。事実と推測・提案を分ける。
- 専門エージェントの追加は `.claude/agents/` に Markdown を足すだけ（画面は自動反映）。Phase 4 でフォルダ構成を `.claude/agents/azure-sage/` に整理し、ポータルからも編集できるようにした（[ADR 0016](0016-agent-definition-files.md)）。

## 理由・検討した代替案
調査は軽量モデルへ寄せてコストと速度を稼ぎ、誤りが致命的な精査・提案だけ Opus にする。単一エージェントで全部やる案は、コストと文脈の肥大化のため見送り。

## 影響
- モデル配分は frontmatter の変更だけで調整できる。
- 関連: `CLAUDE.md`, `.claude/agents/`, `knowledge/agent-platform-map.md`
