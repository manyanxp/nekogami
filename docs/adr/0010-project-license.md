# 0010. 本体ライセンスは MIT、有料ライセンスは NOTICE で明示

- 状態: Accepted
- 日付: 2026-10-24

## 背景
ルートにライセンスを置きたい（MIT か Apache-2.0）。Claude 等の有料ライセンスがある場合はその旨も示す（要件）。

## 決定
- ルートに [LICENSE](../../LICENSE)（MIT）を置く。LICENSE 末尾に「本ライセンスは第三者のソフトウェア・サービスには及ばない」旨の注記を付け、[NOTICE.md](../../NOTICE.md) に有料・独自条件のもの（Claude Code、Claude Agent SDK、Claude API、Azure）を明記する。
- 著作権表示は暫定で "Azure Sage contributors"。個人名や組織名にする場合は LICENSE を直す。
- dompurify は MPL-2.0 / Apache-2.0 の選択式のため Apache-2.0 を選択する。

## 理由・検討した代替案
- 依存を確認した結果（[docs/licenses](../licenses/README.md)）、同梱・配信するコードは MIT/ISC/BSD/Apache-2.0 等の寛容ライセンスのみで、MIT での公開に支障はない。Claude Code と Agent SDK は同梱せず、利用者が取得する。
- Apache-2.0 は特許条項があるが、個人プロジェクトでは MIT の簡潔さを優先した。

## 影響
- Docker イメージなどに Claude Code / SDK を含めて配布する場合は、Anthropic の条件を別途確認する。
- 法的判断ではなく、記載事項の確認結果である。公開前に最終確認すること。
