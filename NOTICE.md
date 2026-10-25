# NOTICE — サードパーティと有料ライセンスについて

このリポジトリのソースコードは [MIT License](LICENSE) です。ただし、**動かすために必要な次のものは本ライセンスの対象外**で、それぞれの条件に従います。

## 有料・独自条件のもの（要注意）

| 対象 | 条件 | 本リポジトリでの扱い |
|---|---|---|
| Claude Code（`@anthropic-ai/claude-code`） | Anthropic の利用規約（商用条件）。利用には Claude のサブスクリプションまたは API キー（従量課金）が必要 | 同梱しない。利用者が自分でインストール・認証する |
| Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`） | OSS ライセンスではなく Anthropic の条件（パッケージの README 参照） | `npm install` で取得（同梱しない） |
| Claude API / モデル | Anthropic の利用規約・料金 | 利用者の API キー／アカウントで利用 |
| Azure（Microsoft Learn MCP、Azure MCP が操作する Azure サブスクリプション） | Microsoft の利用条件・Azure の料金 | サービス利用。リソース変更は行わない設計（ADR 0002） |

## 寛容ライセンスのもの

npm 依存（Next.js・React・Radix UI・@xyflow/react・react-markdown・Tailwind CSS: MIT、その他は主に MIT/ISC/BSD/Apache-2.0）と Python 側（FastAPI: MIT、uvicorn・httpx: BSD-3-Clause）の詳細は [docs/licenses/](docs/licenses/README.md) を参照してください。GPL 系は含みません。

## 再配布する場合
- Docker イメージ等にこれらを含めて配布する場合は、各ソフトウェアの条件（特に Anthropic 製のもの）を再確認してください。
- 依存を変更したら `python3 scripts/gen-licenses.py` で一覧を更新します。
