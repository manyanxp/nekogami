# 0006. エンティティ台帳と UUID 管理

- 状態: Accepted
- 日付: 2026-10-24

## 背景
オーケストレーター・エージェント・サブエージェントが増えるため、一覧管理と一意な識別が必要（要件 R1〜R3）。

## 決定
- 管理対象を 1 種類の「エンティティ」にまとめ、`kind`（orchestrator / agent / subagent）で区別する。
- 項目: `id`(UUID), `kind`, `name`, `parent_id`, `description`, `model`, `enabled`, `tags`, `runtime`, `created_at`, `updated_at`。
- ID: 新規は UUID v4。組み込み（`azure-sage` と `.claude/agents/*.md`）は名前から UUID v5 を生成し、再取り込みしても同じ ID・重複なし。
- 階層: orchestrator は親なし / agent の親は orchestrator / subagent の親は agent か orchestrator。`kind` は作成後に変更不可。
- `name` は全体で一意（英数字と `. _ -`）。子がある親の削除は `cascade=1` が必要。
- 永続化は JSON ファイル（`portal/data/registry.json`、一時ファイル + `os.replace` で原子的に書き込み）。

## 理由・検討した代替案
個人利用の規模では DB は過剰。ファイルなら依存ゼロで中身も読める。件数や同時編集が増えたら SQLite へ移行する（API は不変）。種別ごとに別テーブル/別モデルにする案は、項目がほぼ共通のため不採用。

## 影響
- `.claude/agents/*.md` が実行時の正で、台帳はそのメタ情報の写し（取り込みは追加のみで、既存の台帳内容は上書きしない）。
- Phase 2 で `suborchestrator` 種別を追加し、組み込みの最上位を `nekogamisama` に変更した（[ADR 0011](0011-nekogamisama-hierarchy-and-delegation.md)）。上の階層ルールはその ADR で拡張されている。
- Phase 4 で `definition`（`agent-md` / `claude-md` と相対パス）を項目に追加し、`.claude/agents/` の定義ファイルを正にした（[ADR 0016](0016-agent-definition-files.md)・[0017](0017-suborchestrator-as-agent-definition.md)）。
- Phase 3 で `protected`・`tool_ids`・`pos` を項目に追加し、ツールを台帳に加えた（[ADR 0013](0013-admin-agent-and-admin-page.md)・[0014](0014-node-graph-editor.md)）。
- 関連: `portal/backend/portal_api/registry.py`
