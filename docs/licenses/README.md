# ライセンス台帳

Azure Sage が使用・同梱・参照しているものとそのライセンスの一覧です。再配布・社内展開・公開の前に確認します。

> 状態の凡例: **確認済み** = ロックファイル等の記載で確認 / **要確認** = 一般に知られる内容を記載しているが、配布前に一次情報（リポジトリの LICENSE・利用規約）で確認すること。

## 1. 本プロジェクト自身

| 対象 | ライセンス | 状態 |
|---|---|---|
| Azure Sage 本体（`CLAUDE.md`、`.claude/agents/`、`dashboard/`、`portal/`、`web/`、`docs/` ほか） | **MIT**（ルートの [LICENSE](../../LICENSE)、ADR 0010）。有料・独自条件の依存は [NOTICE.md](../../NOTICE.md) | 確認済み |
| 猫アイコン（`web/src/components/ConsoleApp.tsx` 内の SVG） | 本プロジェクトで作成（本体に準ずる） | — |
| 太陽の猫神さまの走る GIF（原画 `icons/sun-cat-loading/sun-cat-running-256.gif`。`web/public/sun-cat-running.gif` にコピー。ポータルのチャットの考え中） | 画像生成ツールで制作（`icons/sun-cat-loading/README.txt`）。**利用条件（商用利用・再配布）は、生成ツールの規約で確認が必要** | **要確認** |
| 走る猫の GIF（`web/public/neko-run.gif`。Agent Console のチャットの考え中。`scripts/gen-neko-gif.py` が標準ライブラリだけで生成） | 本プロジェクトで作成（本体に準ずる） | — |
| 猫神さまのアイコン（原画 `icons/cat-goddess-icons/sun_cat_goddess.png`。縮小版 `web/public/neko-goddess.png` を `scripts/make-avatar.py` で生成） | 画像生成ツールで制作（`icons/cat-goddess-icons/README.txt`）。**利用条件（商用利用・再配布）は、生成ツールの規約で確認が必要** | **要確認** |
| ポータルのアイコン選択用の縮小版（`portal/assets/icons/`、miko / sun / munakata の 3 種。原画 `icons/cat-goddess-icons/`、`scripts/make-avatar.py` で生成） | 上と同じ（画像生成ツールで制作）。**利用条件は要確認** | **要確認** |
| `docs-screenshot.png` | 本プロジェクトの画面キャプチャ（本体に準ずる） | — |
| `docs/add_requirement/2026-10-24/reference-flow.png` | 要件の参考にした画面の画像。**出どころ・利用条件は不明**。公開する場合は、出どころを確認するか外す | **要確認** |

## 2. npm 依存

全件の一覧は [third-party-npm.md](third-party-npm.md)（`python3 scripts/gen-licenses.py` で自動生成。実行時の依存と、開発・ビルド時のみの依存を分けている）。コピーレフト（GPL / LGPL 系）は含まれない（Next.js の任意依存 `sharp` は、LGPL の libvips を避けるため空のスタブに差し替えている。ADR 0031）。

### 2a. `dashboard/`（Agent Console のサーバー）

| パッケージ | バージョン | ライセンス | 用途 | 状態 |
|---|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.309 | `SEE LICENSE IN README.md`（Anthropic の条件。OSS ライセンスではない） | エージェント実行 | 確認済み（条件の中身は同パッケージの README を参照） |

推移的依存の大半は MIT・ISC・BSD・Apache-2.0 等の寛容ライセンス。`SEE LICENSE IN LICENSE.md` の件は `@anthropic-ai/claude-agent-sdk` の OS 別バイナリ（optional）で、上記 SDK と同じ扱い。旧 `marked`・`dompurify` は、画面を Next.js に移したため外した。

### 2b. `web/`（画面）

| パッケージ | バージョン | ライセンス | 用途 | 状態 |
|---|---|---|---|---|
| `next` | 15.5.x | MIT | 画面のフレームワーク | 確認済み |
| `react` / `react-dom` | 19.x | MIT | UI | 確認済み |
| `@radix-ui/react-dialog` | 1.x | MIT | ダイアログ | 確認済み |
| `@xyflow/react` | 12.x | MIT | 管理ページのノードグラフ | 確認済み |
| `react-markdown` / `remark-gfm` | 10.x / 4.x | MIT | 回答のマークダウン描画（生 HTML は描画しない） | 確認済み |
| `tailwindcss` / `@tailwindcss/postcss` | 4.x | MIT | CSS のビルド（ビルド時のみ） | 確認済み |
| `typescript` | 5.9.x | Apache-2.0 | 型チェック（ビルド時のみ） | 確認済み |
| `vitest` | 3.x | MIT | テスト（ビルド時のみ） | 確認済み |
| `caniuse-lite`（Next.js・ブラウザ対応表の推移的依存） | — | CC-BY-4.0 | ビルド時のデータ。配布する場合は帰属表示が必要 | 確認済み（データのみ） |

## 2c. Python（`portal/backend/`）

`portal/backend/requirements.txt`（各行にライセンスをコメントしている）。

| パッケージ | ライセンス | 用途 | 状態 |
|---|---|---|---|
| `fastapi` | MIT | ポータルの API | 確認済み（PyPI のメタデータ） |
| `uvicorn` | BSD-3-Clause | ASGI サーバー | 確認済み |
| `httpx` | BSD-3-Clause | Agent Console への中継（SSE を含む） | 確認済み |
| FastAPI の依存（`starlette`: BSD-3-Clause、`pydantic`: MIT） | 同左 | — | 確認済み |

Python 本体は PSF License（同梱せず、利用者の環境のものを使う）。

## 3. 実行環境・外部ツール

| 対象 | ライセンス / 条件 | 用途 | 状態 |
|---|---|---|---|
| Claude Code（`@anthropic-ai/claude-code`） | Anthropic の利用規約・商用条件 | エージェント実行基盤（Dockerfile で導入） | 要確認 |
| Node.js（`node:22-slim` イメージ） | Node.js: MIT。イメージ内の Debian パッケージは各自のライセンス | 実行環境 | 要確認 |
| Azure MCP Server（`@azure/mcp`、`npx` 実行） | MIT（Microsoft 公開リポジトリ） | Azure 読み取り | 要確認 |
| Microsoft Learn MCP（`https://learn.microsoft.com/api/mcp`） | ソフトウェアではなくリモートサービス。Microsoft の利用条件に従う | ドキュメント検索 | 要確認 |
| Azure CLI | MIT | `az login`（任意） | 要確認 |
| Docker Engine / Compose | Docker Engine は Apache-2.0。Docker Desktop は規模により有料（大企業等） | ポータルからの起動・停止 | 要確認 |

## 4. フォント・アセット

| 対象 | ライセンス | 配信方法 | 状態 |
|---|---|---|---|
| IBM Plex Mono / IBM Plex Sans JP | SIL Open Font License 1.1 | Google Fonts から実行時に読み込み（同梱していない） | 要確認 |

## 5. 生成物・コンテンツの扱い

- `reports/`・`research/` の調査結果は Microsoft Learn 等の一次情報を要約したもの。**出典の著作権は各提供元に帰属**し、全文転載はしない（URL で出典を示す）。
- Microsoft Learn のコンテンツの再利用条件は、公開前に Microsoft の最新の利用条件で確認する。

## 運用

- 依存を追加・更新したら `python3 scripts/gen-licenses.py` で [third-party-npm.md](third-party-npm.md) を再生成し、上の直接依存の表を更新する。
- ライセンスの追加・変更は [`../changes/`](../changes/README.md) に 1 件記録する。
- 有料・独自条件のものを追加したら、ルートの [NOTICE.md](../../NOTICE.md) も更新する。
