# 2026-10-24 委任コマンドのパスの不具合修正

- 関連 ADR: 0011（追記）
- 影響範囲: `dashboard/server.mjs`、`nekogamisama/`、`docs/`

## 変更前
猫神さまが `nekogamisama/bin/delegate.sh` で委任すると、作業場所が `/app/nekogamisama` のため「No such file or directory」で失敗した。作業場所基準の `bin/delegate.sh` は許可されておらず、猫神さまは委任できなかった。

## 変更後
`bin/delegate.sh <名前> '<依頼文>'` を案内・許可する（`nekogamisama/` 付きも引き続き許可）。

## 差分
- 変更: `dashboard/server.mjs`（許可する形）、`nekogamisama/CLAUDE.md`・`.claude/settings.json`・`bin/delegate.sh`（使い方）、ADR 0011（追記）
- 未確認: 実際の Claude での委任の成功。
