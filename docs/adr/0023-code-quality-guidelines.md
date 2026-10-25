# 0023. コード品質の基準を参照情報として取り込む

- 状態: Accepted
- 日付: 2026-10-24

## 背景
`docs/code-quality/` に、Python / JavaScript / TypeScript のコード品質を保つためのスキル（`SKILL.md` と `references/`）が置かれた。これをプロジェクトの参照情報として扱えるようにする。

## 決定
- 次のファイルを、プロジェクトの**コード品質の基準（参照情報）**とする。内容は変更せず、そのまま置く。
  | ファイル | 内容 |
  |---|---|
  | [code-quality/SKILL.md](../code-quality/SKILL.md) | 進め方（既存に合わせる・変更は最小限・推測で進めない）、設計・命名・型・エラー処理・セキュリティ・テスト・コメント、品質チェックの実行、完了報告の形式 |
  | [references/python.md](../code-quality/references/python.md) | Python の規約（型ヒント、よくある落とし穴、pytest、`pyproject.toml` の推奨設定） |
  | [references/typescript-javascript.md](../code-quality/references/typescript-javascript.md) | JavaScript / TypeScript の規約（`strict`、非同期、エラー処理、フロントエンドのセキュリティ、Vitest / Jest） |
  | [references/review-checklist.md](../code-quality/references/review-checklist.md) | 完了報告の前に確認するチェックリスト |
- `docs/README.md` の索引に載せ、コードを変えるときの参照先として案内する。
- **これはドキュメントとしての取り込みで、Claude Code のスキルとしては有効化していない。** スキルとして自動で読ませるには `.claude/skills/code-quality/` に置く必要がある（`docs/` 以下は自動では読まれない）。また、ルートの `CLAUDE.md` は Azure Sage の指揮役と猫神さまが読むため、コード品質の指示は書き足していない（調査・提案のエージェントの文脈を増やさないため）。有効化する場合は、別途判断する。
- `docs/code-quality/.DS_Store`（macOS が作るファイル）は、`.gitignore` に `.DS_Store` を足して追跡対象から外す。ファイル自体は消さない。

## 現状との差（基準に対して満たしていない点）
基準は「作業完了前に、プロジェクトに設定されているツールを実行し、すべて通す。未導入のツールは、勝手に導入せず、導入を提案する」としている。現状は次のとおりで、**導入は提案のみ（未実施）**。
- 設定ファイルがない: `pyproject.toml`（ruff / mypy / pytest）、`eslint.config.*`、`.prettierrc*`、`tsconfig.json`。`ruff` / `mypy` / `pyright` も、この環境に入っていない。
- テストは、Python が標準の `unittest`（`portal/backend/tests/`、32 件）、JavaScript が Node 標準の `node --test`（`dashboard/*.test.mjs`、11 件）とブラウザ内テスト（`portal/frontend/test/`、67 項目）。基準が挙げる `pytest` / `vitest` / `jest` ではない。ポータルは外部ライブラリを使わない方針（ADR 0007・0014）に合わせている。
- 型: Python は一部のみ型ヒントがある。フロントエンドは JavaScript（JSDoc なし）。
- 導入するなら、ADR 0007 の「追加依存なし」の方針との関係（開発時のみの依存にする、など）を決めてから、`ruff` と `eslint` / `prettier` の設定を足し、既存コードの指摘を整理する。

## 理由・検討した代替案
- スキルとして有効化する案: 指示が常に文脈に入り、調査・提案のエージェントの動きに影響しうる。まず参照情報として置き、有効化は必要になった時点で決める。
- 既存コードを基準に合わせて直す案: 依頼は情報の追加で、無関係な変更を混ぜない（基準の「変更は最小限に」とも一致）。差は上に記録した。

## 影響
- 良い点: 基準の場所が分かり、今後の変更で参照できる。現状との差が記録される。
- 関連: `docs/code-quality/`、`docs/README.md`、[ADR 0007](0007-portal-architecture.md)・[0014](0014-node-graph-editor.md)
