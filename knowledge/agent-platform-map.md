# Agent 365 / Microsoft Foundry 周辺サービス見取り図（調査の起点）

> 2026-10 時点の整理。**状態（GA/Preview）や名称は変わりやすいので、回答前に必ず Microsoft Learn で再確認すること。**
> 起点ページ: https://learn.microsoft.com/azure/foundry/agents/concepts/agent-365-integration

## 1. 全体像（2 つの層）

- **Microsoft Foundry = エージェントを「作って動かす」層**（Azure 側）
- **Microsoft Agent 365 = エージェントを「台帳管理・統制する」層**（Microsoft 365 / Entra 側のコントロールプレーン）
- Foundry のエージェントは registry sync で Agent 365 の台帳に載り、hosted agent は「autopilot」として Teams / M365 で利用可能にできる。

## 2. Agent 365 側（統制・利用）

| サービス | 関係 |
|---|---|
| Microsoft Entra Agent ID | エージェントを Entra の ID として扱う。認証・認可、アクセスレビュー、条件付きアクセス |
| Microsoft Defender | エージェントの脅威検知・振る舞い監視 |
| Microsoft Purview | エージェントのデータ保護・コンプライアンス・監査 |
| Microsoft 365 管理センター | Agent 365 の有効化（グローバル管理者） |
| Microsoft 365 Copilot ライセンス | テナント有効化に必要（少なくとも 1 ライセンス） |
| Frontier プレビュー | Foundry 連携の前提として参加が必要（要確認：GA 状況） |
| Teams / Microsoft 365 アプリ / Work IQ | エージェントを利用者が使う場所・組織データへの文脈 |
| Copilot Studio | ここで作ったエージェントも Agent 365 台帳に載る |

## 3. Foundry 側（構築・実行）

| 領域 | 主なサービス/機能 |
|---|---|
| エージェント実行 | Foundry Agent Service（prompt agents / hosted agents / workflows） |
| モデル | Foundry Models（Azure OpenAI ほかモデルカタログ、Claude を含むパートナーモデル） |
| ツール接続 | MCP、OpenAPI、Azure AI Search、Bing などのグラウンディング、Logic Apps / Functions |
| 開発 SDK | Microsoft Agent Framework、Foundry SDK |
| 品質・安全 | 評価（Evaluations）、Azure AI Content Safety / ガードレール |
| 可観測性 | トレース（OpenTelemetry → Application Insights）、Agent 365 へのアクティビティ連携（hosted agent は Agent 365 SDK が必要） |
| ID | エージェント ID（Entra Agent ID）、Managed Identity |

## 4. Azure 基盤（周辺で必ず話題になるもの）

- データ/検索: Azure AI Search、Cosmos DB、Storage、Fabric / OneLake
- 実行基盤: Container Apps、App Service、Functions、AKS
- ゲートウェイ: API Management（AI ゲートウェイ：トークン制限、負荷分散、ログ）
- セキュリティ: Key Vault、Private Endpoint / VNet、Defender for Cloud（AI 脅威保護）、Azure Policy
- 監視・コスト: Azure Monitor / Log Analytics / Application Insights、Cost Management
- データ所在地: Foundry はリソースのリージョン、Agent 365 は Entra テナントの保存場所に従う

## 5. 検討時のチェックリスト（researcher への観点の例）

1. 作りたいエージェントは prompt agent / hosted agent / Copilot Studio のどれが適するか
2. Agent 365 の有効化要件（ライセンス、プレビュー参加、管理者作業）と現状のテナント状況
3. ID 設計（Entra Agent ID、Managed Identity、権限の最小化）
4. データ接続と閉域化（Private Endpoint、データ所在地）
5. トレース・評価・監査ログをどこに集約するか（App Insights / Purview / Agent 365）
6. コスト構造（モデルのトークン課金、Agent Service、検索、ライセンス）
7. 本番化の可否（Preview 依存箇所とその代替）
