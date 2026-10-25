# 2026-10-25 Shared Principles — 全エージェント共通指示（rev4）

- 関連 ADR: 0047
- 関連要件: [rev4](../requirements/20261025-rev4-shared-principles.md)
- 影響範囲: `portal/backend/portal_api/{shared,registry,app}.py`、`web/src/`

## 変更前
サブオーケストレーターの配下に共通の指示を渡す手段がなく、子ごとにプロンプトへ同じ内容を書いていた。

## 変更後
サブオーケストレーターに Shared Principles を書ける。チェックした直下の子の定義ファイルに、節として自動で入る。親の変更や削除にも追従する。

## 移行・注意点
- `docker compose up -d --build api web`。既存の定義ファイルは変えない（使うと決めた子にだけ節が入る）。
