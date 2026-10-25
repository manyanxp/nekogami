# 0007. ポータルの構成（フロント/バックエンド分離、Python 標準ライブラリ）

- 状態: Accepted（標準ライブラリだけの構成と、API が画面も配る部分は [0031](0031-nextjs-fastapi-split.md) で置き換え）
- 日付: 2026-10-24

## 背景
複数エージェントを管理する新しい UI が必要。バックエンドは Python、フロントは現行言語（JavaScript）、ロジックは分離（要件 R5, R7, R8）。ライセンスは寛容なものに限りたい。

## 決定
- `portal/backend`（Python 3.10+、**標準ライブラリのみ**: `http.server` / `json` / `subprocess` / `uuid`）が JSON REST API を提供し、`portal/frontend` の静的ファイルも配信する。
- フロントは HTML + ES Modules（ビルド不要）。`api.js`（通信のみ）/ `model.js`（DOM に触れない純粋ロジック）/ `app.js`（描画とイベント）に分離。動的な値は `textContent` で描画し、`innerHTML` を使わない。
- 両者の結合は API（JSON）だけ。ポートは 4400（既存 Agent Console は 4317 のまま）。
- 既存の Agent Console（Node、チャットとトレース）は変更せず、台帳の `azure-sage` から URL で連携する。Python への移行は今回の範囲外。
- 主な API: `/api/entities`（GET/POST）、`/api/entities/{uuid}`（GET/PATCH/DELETE）、`.../status`、`.../start`、`.../stop`、`/api/sync-builtin`、`/api/health`。

## 理由・検討した代替案
- FastAPI 等のフレームワーク: 便利だがインストールが必要で、規模に対して過剰。標準ライブラリなら追加ライセンスもゼロで、API を保てば後から載せ替え可能。
- 既存 Node サーバーに機能追加: 「バックエンドは Python」の要件に反する。
- Agent Console 全体の Python 移行: Agent SDK 連携・フック・SSE の書き直しが大きく、別 ADR で扱う。

## 影響
- 標準ライブラリの `http.server` は高負荷向きではない（個人利用なら十分）。
- ポータルと Agent Console の 2 プロセス構成になる。
- 関連: `portal/`, `scripts/portal.sh`
