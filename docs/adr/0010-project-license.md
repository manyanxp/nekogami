# 0010. 本体ライセンスは MIT、有料ライセンスは NOTICE で明示

- 状態: Accepted
- 日付: 2026-10-24

## 背景
ルートにライセンスを置きたい（MIT か Apache-2.0）。Claude 等の有料ライセンスがある場合はその旨も示す（要件）。

## 決定
- ルートに [LICENSE](../../LICENSE)（MIT）を置く。LICENSE 末尾に「本ライセンスは第三者のソフトウェア・サービスには及ばない」旨の注記を付け、[NOTICE.md](../../NOTICE.md) に有料・独自条件のもの（Claude Code、Claude Agent SDK、Claude API、Azure）を明記する。
- 著作権表示は "manyanxp"（個人。2026-10-25 に、暫定の "Azure Sage contributors" から変更）。他の人の貢献を受けるようになったら、"NekoGamiSama contributors" への変更や貢献の条件を検討する。画像・アニメーション素材は対象外（NOTICE.md）
- dompurify は MPL-2.0 / Apache-2.0 の選択式のため Apache-2.0 を選択する。

## 理由・検討した代替案
- 依存を確認した結果（[docs/licenses](../licenses/README.md)）、同梱・配信するコードは MIT/ISC/BSD/Apache-2.0 等の寛容ライセンスのみで、MIT での公開に支障はない。Claude Code と Agent SDK は同梱せず、利用者が取得する。
- Apache-2.0 は特許条項があるが、個人プロジェクトでは MIT の簡潔さを優先した。

## 影響
- Docker イメージなどに Claude Code / SDK を含めて配布する場合は、Anthropic の条件を別途確認する。
- 法的判断ではなく、記載事項の確認結果である。公開前に最終確認すること。

## 追記（2026-10-25）画像・アニメーションは MIT の対象外
- ChatGPT で生成した猫神さまのアイコンと走る GIF は、**このアプリ専用**の素材とし、MIT の対象外にした（LICENSE 末尾の NOTE 2、NOTICE.md、README）。
- 理由: 他の開発者に複製・転用されたくない素材と、自由に使ってよいコードを分けるため。AI 生成物は著作権で守られない国もあり、法的な独占は保証できない。表示は意思表示としての意味が中心。
- 対象外の一覧は NOTICE.md の「画像・アニメーション素材」。`scripts/gen-neko-gif.py` が作る `neko-run.gif` は対象外にしない。
