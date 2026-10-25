# 0031. 画面を Next.js、ポータルの API を FastAPI にする（公開に向けた再構成）

- 状態: Accepted（[0007](0007-portal-architecture.md) のうち「標準ライブラリだけの Python サーバーが画面も配る」部分と、[0014](0014-node-graph-editor.md) の「自作 SVG」を置き換える）
- 日付: 2026-10-24

## 背景
ポータルは標準ライブラリだけの Python サーバー（`http.server`）で、画面は素の HTML と ES Modules だった。公開（配布・商用利用）に向けて、広く使われ保守されているフレームワークに載せ替えたい。条件は、商用利用できる許諾（MIT / Apache-2.0 / BSD 系）であること。

## 決定
- **画面は `web/`（Next.js 15 + React 19 + TypeScript）**。ポータル `/`、猫神さま管理 `/admin`、Agent Console `/console` の 3 ページ。静的書き出しにはせず、Next.js のサーバーとして動かす。
- **ポータルの API は FastAPI（`portal/backend/portal_api/app.py`）**。API は `/api/*`。Python 本体の業務ロジック（台帳・定義ファイル・性格・テーマ・Docker 操作）は変えない。
- **Agent Console のサーバー（`dashboard/server.mjs`）は API と SSE だけ**にする（画面は Next.js 側）。`GET /` は Next.js の `/console` へリダイレクト。
- 3 つのプロセスと経路:

  | プロセス | ポート | 受け持ち |
  |---|---|---|
  | Next.js | 4400（ブラウザが開く先） | 画面。`/api/*` → FastAPI、`/console-api/*`・`/console-events` → Console へ中継（rewrites） |
  | FastAPI | 4401 | ポータルの API |
  | Agent Console | 4317 | チャット実行・フック受信・SSE |

  ブラウザからは同一オリジンに見えるので CORS は使わない。
- UI 部品: **Tailwind CSS 4**（ビルド時のみ。リセット `preflight` は読み込まず、既存の見た目の CSS を `web/src/styles/` にそのまま移した）、**Radix UI**（ダイアログ）、**react-markdown + remark-gfm**（回答のマークダウン）、**@xyflow/react**（管理ページのノードグラフ）。
- 純粋なロジック（一覧の木構造・パネル配置・トレース・委任フロー・グラフの接続規則・テーマ・SSE の分割）は `web/src/lib/*.ts` に TypeScript で移し、vitest でテストする（29 件）。
- セキュリティは維持する:
  - FastAPI: Host / Origin 検査（DNS リバインディング対策）、`PORTAL_TOKEN` による Bearer 認証（`/api/health` を除く）、本文 128 KB 制限、`nosniff`・`no-store`。
  - Next.js: `middleware.ts` で Host を検査する（中継で Host が書き換わるため、API 側だけでは足りない）。許可は `localhost` / `127.0.0.1` / `[::1]` と `PORTAL_ALLOWED_HOSTS`。
  - 回答中の ```html / ```svg は、`sandbox=""` かつ CSP `default-src 'none'` の iframe に表示する（[0029](0029-markdown-preview-and-diagrams.md) を踏襲）。生の HTML は描画しない。
- 依存の許諾:
  - Next.js の画像最適化用の任意依存 `sharp`（LGPL の libvips バイナリ）は、`web/vendor/sharp-stub` の空パッケージに差し替えて入れない（`next/image` を使わないため。`overrides`）。
  - Python: FastAPI（MIT）、uvicorn（BSD-3-Clause）、httpx（BSD-3-Clause）。
  - 旧 `marked`・`dompurify`（Agent Console の静的画面用）は不要になり外した。

## 理由・検討した代替案
- Python 側で画面も配る（Jinja2 など）案: 画面の部品（ノードグラフ・ドッキング・マークダウン）の保守に、React のエコシステムの方が向く。
- Next.js を静的書き出しにして FastAPI が配る案: プロセスは減るが、Host 検査などを Next.js 側に持てず、開発時のホットリロードも使いにくい。利用者の選択で、サーバーとして分けた。
- ノードグラフを自作のまま TypeScript に移す案: 約 600 行の自作 SVG を保守し続けることになる。@xyflow/react（MIT）で、ドラッグ・パン・ズーム・接続の検証を任せられる。
- Express / Flask など: 型付きの入力検証と OpenAPI（`/api/openapi.json`）が標準で付く FastAPI を選んだ。

## 影響・注意
- **ホストに Node.js 20.9 以上が必要**になる（Python 3.10 以上は従来どおり）。起動は `scripts/portal.sh`（初回に `.venv` の作成・`pip install`・`npm ci`・`next build` を行う）。
- Docker（compose）は Agent Console だけ。画面は Docker に入れていない。
- ポート `4400` は従来どおりブラウザの入口だが、中身は Next.js になり、FastAPI は `4401`（`PORTAL_PORT`）。
- 旧 `portal/frontend/`（約 2,500 行の素の JS と CSS、102 件のブラウザテスト）と `dashboard/public/index.html` は削除した。テストは vitest（29 件）に移し、DOM に依存する部分（ドラッグ操作の合成イベントなど）は、ヘッドレス Edge での画面確認に置き換えた。**ドラッグによるパネルの入れ替え・ノードグラフの接続は、自動テストが無い**（未確認の範囲）。
- Next.js 16 では `middleware.ts` が別名になる。15.x に固定している（`~15.5.28`）。
