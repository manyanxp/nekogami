# 2026-10-24 azure-sage の委任先を azure-architect（agent 型）にそろえる

- 関連 ADR: 0017（追記）
- 影響範囲: エージェント定義（指示）/ ドキュメント

## 変更前
`suborchestrators.json` は `azure-sage` → `azure-architect`（agent 型）だが、ADR 0017・`nekogamisama/CLAUDE.md`・README は「`azure-sage` は session 型」と書いていた。

## 変更後
実際の設定（agent 型 → `azure-architect`）を正として文書を直した。`azure-architect` は `Agent` ツールを持たないので、調査・精査は猫神さまが先に行って渡す手順を明記した。

## 差分（箇条書き）
- 変更: `nekogamisama/CLAUDE.md`（種類の例、「Azure への依頼」の手順）、`nekogamisama/README.md`、ルートの `CLAUDE.md`（Azure Sage の節）、ADR 0017（追記）
- 削除: なし。`suborchestrators.json` は変更していない

## 移行・注意点
- `bin/delegate.sh azure-sage …` は、agent 型のため拒否される（Agent ツールで呼ぶ）。
- 未確認: 実際の会話で、猫神さまがこの手順どおりに researcher → reviewer → architect と進めるか（モデルの挙動）。
