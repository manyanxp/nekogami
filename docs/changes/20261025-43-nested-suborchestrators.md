# 2026-10-25 サブオーケストレーターの入れ子（rev2 の第 3 段階）

- 関連 ADR: 0042
- 関連要件: [rev2](../requirements/20261025-rev2-llm-node-tree-dynamic-agents.md)（2）
- 影響範囲: `portal/backend/portal_api/registry.py`、`web/src/lib/graph-model.ts`、`docker-compose.yml`

## 変更前
サブオーケストレーターは猫神さまの直下にしか置けなかった。

## 変更後
- サブオーケストレーターの下に、サブオーケストレーターをつなげる（ツリー）。深さは 4 階層まで。循環は拒否。
- 入れ子にできるのは、定義ファイルのあるサブオーケストレーターだけ。親の `tools` に `Agent` が要る。
- 入れ子のサブオーケストレーターの定義は、親のフォルダに置く。付け替え・名前の変更でファイルが一緒に動く。
- 委任先一覧には、猫神さま直下のものだけを載せる。
- neko-brain に `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=4` を設定。
- 検証: API 58 件、画面 51 件が成功。実機で、3 段の入れ子から Python ノードまでの呼び出しを確認。

## 移行・注意点
- `docker compose up -d --build`。既存のツリーには影響しない。
