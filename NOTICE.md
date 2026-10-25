# NOTICE — サードパーティと有料ライセンスについて

このリポジトリのソースコードは [MIT License](LICENSE) です。ただし、**動かすために必要な次のものは本ライセンスの対象外**で、それぞれの条件に従います。

## 有料・独自条件のもの（要注意）

| 対象 | 条件 | 本リポジトリでの扱い |
|---|---|---|
| Claude Code（`@anthropic-ai/claude-code`） | Anthropic の利用規約（商用条件）。利用には Claude のサブスクリプションまたは API キー（従量課金）が必要 | 同梱しない。利用者が自分でインストール・認証する |
| Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`） | OSS ライセンスではなく Anthropic の条件（パッケージの README 参照） | `npm install` で取得（同梱しない） |
| Claude API / モデル | Anthropic の利用規約・料金 | 利用者の API キー／アカウントで利用 |
| Azure（Microsoft Learn MCP、Azure MCP が操作する Azure サブスクリプション） | Microsoft の利用条件・Azure の料金 | サービス利用。リソース変更は行わない設計（ADR 0002） |

## 画像・アニメーション素材（MIT の対象外・このアプリ専用）

次の素材は、本プロジェクトのために ChatGPT（OpenAI）で生成・加工したものです。**MIT License の対象外**で、このアプリの中でだけ使います。無断で複製・再配布・他のアプリへの転用をしないでください。利用したい場合は、先にプロジェクトの所有者へ連絡してください。

| 対象 | 内容 |
|---|---|
| `icons/cat-goddess-icons/` | 猫神さまのアイコン（原画） |
| `icons/sun-cat-loading/` | 太陽の猫神さまの走るアニメーション（原画、スプライト、GIF / WebP） |
| `portal/assets/icons/` | ポータルのアイコン選択用の縮小版 |
| `web/public/neko-goddess.png`、`web/public/sun-cat-running.gif` | 画面に配信する縮小版・GIF |
| `resource/`、`docs-screenshot.png` | 上の素材が写っている画面キャプチャ（README で使用） |

- 生成物の権利は OpenAI の利用規約に従います（確認状況は [docs/licenses/](docs/licenses/README.md)）。AI 生成物は、国によって著作権で保護されないことがあります。独占できる保証はありません。
- `web/public/neko-run.gif` は `scripts/gen-neko-gif.py` が生成するもので、本体と同じ MIT です。

## 寛容ライセンスのもの

npm 依存（Next.js・React・Radix UI・@xyflow/react・react-markdown・Tailwind CSS: MIT、その他は主に MIT/ISC/BSD/Apache-2.0）と Python 側（FastAPI: MIT、uvicorn・httpx: BSD-3-Clause）の詳細は [docs/licenses/](docs/licenses/README.md) を参照してください。GPL 系は含みません。

## 再配布する場合
- Docker イメージ等にこれらを含めて配布する場合は、各ソフトウェアの条件（特に Anthropic 製のもの）を再確認してください。
- 依存を変更したら `python3 scripts/gen-licenses.py` で一覧を更新します。
