# 2026-10-24 画面を Next.js、API を FastAPI に載せ替え（公開に向けた再構成）

- 関連 ADR: 0031（0007・0014 の一部を置き換え）
- 影響範囲: `web/`（新規）、`portal/backend/`、`portal/frontend/`（削除）、`dashboard/`、`scripts/`、`docker-compose.yml`、`.gitignore`、`CLAUDE.md`、`README.md`、`docs/`

## 変更前
ポータルは標準ライブラリだけの Python サーバーが画面（素の HTML / JS）と API を配り、Agent Console は `dashboard/public/index.html` を自前で配信していた。

## 変更後
画面は Next.js（`web/`、:4400）が配る。ポータルの API は FastAPI（:4401）、Agent Console のサーバー（:4317）は API と SSE だけ。Next.js が `/api/*` と `/console-api/*`・`/console-events` を中継する。

## 差分
- 追加: `web/`（Next.js 15 / React 19 / TypeScript / Tailwind 4 / Radix UI / react-markdown / @xyflow/react / vitest）、`portal/backend/portal_api/app.py`・`chat.py`・`requirements.txt`、`web/vendor/sharp-stub`、ADR 0031
- 削除: `portal/frontend/`、`dashboard/public/index.html`（と同梱の画像の重複）、`portal/backend/portal_api/server.py`、`dashboard` の `marked`・`dompurify`
- 変更: `dashboard/server.mjs`（静的配信をやめ、`/` は Next.js へリダイレクト）、`scripts/portal.sh`（FastAPI と Next.js を起動）、`scripts/gen-licenses.py`（`dashboard/` と `web/` の両方）、`docker-compose.yml`（`portal/data` を読み取り専用でマウント）、`.dockerignore`、`.gitignore`、ルートの `CLAUDE.md`（現状の構成）、`README.md`、ライセンス台帳
- 検証: バックエンド 35 件、Node 22 件、vitest 29 件、`tsc --noEmit`、`next build`、ヘッドレス Edge で 3 ページの表示。
- 未確認: ドラッグ操作（パネル入れ替え・ノード接続）の自動テスト、Docker での Agent Console の再ビルド後の動作、Next.js 経由の長時間 SSE。
