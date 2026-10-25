# 2026-10-25 猫神さまは委任だけ、フローのテーマ追従、ポータルの連動（rev4 追加分）

- 関連 ADR: 0048
- 関連要件: [rev4](../requirements/20261025-rev4-shared-principles.md)
- 影響範囲: `dashboard/{server,neko-policy}.mjs`、`nekogamisama/.claude/settings.json`、`CLAUDE.md`（2 か所）、`portal/backend/portal_api/registry.py`、`web/src/`

## 変更前
猫神さまは Read・Glob・Grep・Web などを自分で使えた。Console のフローは暗色固定。消した担当が委任フローに残り、ポータルは開いたときしか読み直さなかった。

## 変更後
猫神さまは委任の道具（Agent・delegate.sh）と、委任先の一覧の Read だけ。フローはテーマ（モード・アクセント色）に追従。定義ファイルが消えた委任先は画面とファイルから外れ、ポータルは定期的・復帰時に読み直す。

- Bash は開けず、Python ノードに任せる方針とした。専用の担当 `py-analyst` を削除した。

## 移行・注意点
- `docker compose up -d --build api neko-brain web`。
- CLI では、配下の担当の Read などが確認つきになる。
