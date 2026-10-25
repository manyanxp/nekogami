# 2026-10-24 ルートの CLAUDE.md を猫神さま（現行仕様）に変更

- 関連 ADR: 0011, 0016, 0017, 0021, 0026, 0031
- 影響範囲: エージェント定義（指示）

## 変更前
ルートの `CLAUDE.md` は Azure Sage（サブオーケストレーター）用の指示で、猫神さまは `nekogamisama/CLAUDE.md` にだけ書かれていた。

## 変更後
ルートの `CLAUDE.md` を、最上位オーケストレーター「猫神さま」の指示にした。委任（agent / session）、指名（`/コマンド`）、おしゃべり（`neko-chat`）、性格の取り込み、現行の構成（Next.js + FastAPI + Agent Console）を反映した。Azure Sage の手順は節として残した。

## 差分（箇条書き）
- 変更: `CLAUDE.md`（猫神さまの指示へ。`@nekogamisama/personality.md` を取り込み）、`nekogamisama/CLAUDE.md`（「親の CLAUDE.md は Azure Sage 用」の注記を訂正）
- 退避: 旧ルート `CLAUDE.md` は `portal/data/backups/CLAUDE.md.20261024-azure-sage`

## 移行・注意点
- `nekogamisama/` で起動すると、ルートと `nekogamisama/CLAUDE.md` の両方が読まれ、性格が 2 回取り込まれる（害はないが重複する）。
- `suborchestrators.json` の `azure-sage` は `type: agent`（`azure-architect`）だが、ADR 0017 は `session` 型と書いている。`azure-architect` は `Agent` ツールを持たないため、調査チームを指揮できない。未解消。
