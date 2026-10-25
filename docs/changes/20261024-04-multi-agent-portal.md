# 2026-10-24 マルチエージェント管理ポータルと MIT ライセンス

- 関連 ADR: 0006, 0007, 0008, 0009, 0010
- 要件: [20261024-multi-agent-portal.md](../requirements/20261024-multi-agent-portal.md)
- 影響範囲: 新規 `portal/`、`agents/`、ルート、`docs/`、`scripts/`

## 変更前
管理対象は Agent Console（Node）上の 1 オーケストレーターと 4 サブエージェント（`.claude/agents/`）のみ。一覧・ID・起動停止の管理はなかった。ライセンス未設定。

## 変更後
Python バックエンド + JavaScript フロントのポータル（:4400）で、オーケストレーター・エージェント・サブエージェントを UUID で一覧管理でき、Docker ランタイムのものは UI から起動・停止できる。本体は MIT。

## 差分
- 追加: `portal/backend`（registry / docker_ctl / server / tests 6 件）、`portal/frontend`（api.js / model.js / app.js）、`portal/README.md`、`agents/`（README とサンプル Compose）、`scripts/portal.sh`、`LICENSE`、`NOTICE.md`、`.gitignore`、`docs/requirements/`、ADR 0006〜0010。
- 変更: `docs/licenses/README.md`（本体 MIT、Python、Docker を追記）、`docs/README.md`、各 README の索引。
- 変更なし: 既存 Agent Console（`dashboard/`）、`.claude/` の設定。認証は導入せず、任意トークンのみ（ADR 0008）。

## 移行・注意点
- 起動: `scripts/portal.sh`。初回に組み込み 5 件（azure-sage + 4 サブエージェント）を自動登録する。
- 追加依存なし（Python 3.10+ のみ）。
