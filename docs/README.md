# docs

| ディレクトリ | 内容 |
|---|---|
| [adr/](adr/README.md) | 仕様と設計判断（ADR） |
| [changes/](changes/README.md) | 仕様変更の履歴（差分の時系列） |
| [licenses/](licenses/README.md) | 使用しているライセンスの台帳 |
| [requirements/](requirements/) | 要件資料（元資料は `add_requirement/`（日付ごとのフォルダ。Git の管理対象外なので、リポジトリには含まれない）） |
| [code-quality/](code-quality/SKILL.md) | コード品質の基準（Python / JavaScript / TypeScript のスキル）。コードを書く・直す・レビューするときの参照用（[ADR 0023](adr/0023-code-quality-guidelines.md)） |

運用: コードを変えるときは [code-quality/SKILL.md](code-quality/SKILL.md) の基準（と、完了前の [チェックリスト](code-quality/references/review-checklist.md)）を参照する。仕様を変えたら `changes/` に 1 件追加し、判断が変わるなら `adr/` を更新する。依存を変えたら `licenses/` を更新する。
