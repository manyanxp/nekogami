# 2026-10-24 猫神さま（NekoGamiSama）Phase 2

- 関連 ADR: 0011, 0012（0006 に追記）
- 要件: [20261024-nekogamisama-phase2.md](../requirements/20261024-nekogamisama-phase2.md)
- 影響範囲: 新規 `nekogamisama/`、`portal/`、`dashboard/`、`Dockerfile`、`docker-compose.yml`、`docs/`、README

## 変更前
最上位は Azure Sage（orchestrator）で、種別は orchestrator / agent / subagent の 3 つ。トレースの発言は生のまま。チャットの相手は Azure Sage 固定。

## 変更後
最上位は猫神さま（orchestrator）。Azure Sage はそのサブオーケストレーター（suborchestrator）で、4 サブエージェントは変わらずその配下。猫神さまは `delegate.sh` で Azure Sage に別セッションで委任する。トレースのエージェント発言は語尾に「にゃ」が付く。

## 差分
- 追加: `nekogamisama/`（CLAUDE.md、`.claude/settings.json`、`suborchestrators.json`、`bin/delegate.sh`、README）、`dashboard/nya.mjs`・`nya.test.mjs`、ADR 0011・0012、要件資料。
- 変更: `registry.py`（`suborchestrator` 種別、組み込みの階層、Phase 1 台帳の移行）、ポータルの画面（種別の選択肢・件数・色、表示名を「猫神さま Portal」に）、`dashboard/server.mjs`（語尾変換、`CHAT_PROJECT_DIR`、委任コマンドだけを許可する Bash 判定）、`Dockerfile`（python3）、`docker-compose.yml`（環境変数 2 つ）、テスト（6 → 8 件）、各 README と索引。
- 変更なし: `.claude/`、`CLAUDE.md`、`knowledge/`、`reports/`、ライセンス台帳（新規依存なし）。

## 移行・注意点
- 既存のポータル台帳は、「組み込みを取り込み」（または起動時の同期）で `azure-sage` が suborchestrator に移行し、`nekogamisama` が追加される。UUID は変わらない。
- 猫神さまと話すには `CHAT_PROJECT_DIR=nekogamisama npm start`（`dashboard/` で）。既定は従来どおり Azure Sage。
- 語尾を止めるには `NYA_SUFFIX=`（空）。
- 未確認: Node 上での `server.mjs` / `nya.test.mjs` の実行、実機での猫神さま → Azure Sage の委任（§要件 6）。
