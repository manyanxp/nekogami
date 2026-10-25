# 2026-10-24 コード品質の基準を参照情報として追加

- 関連 ADR: 0023
- 影響範囲: `docs/`、`.gitignore`

## 変更前
コード品質の基準はプロジェクトに記録されていなかった。

## 変更後
`docs/code-quality/`（スキルと 3 つの参照資料）をコード品質の基準として `docs/README.md` の索引に載せ、現状との差を ADR 0023 に記録した。

## 差分
- 追加: ADR 0023、本ファイル。
- 変更: `docs/README.md`（索引と運用の案内）、`docs/adr/README.md`・`docs/changes/README.md`（索引）、`.gitignore`（`.DS_Store`）。
- 変更なし: `docs/code-quality/` の内容、コード、`CLAUDE.md`、`.claude/`（スキルとしては有効化していない）。

## 移行・注意点
- 基準のツール（ruff / mypy / eslint / prettier / tsc）は未導入。導入は提案のみ（ADR 0023）。
