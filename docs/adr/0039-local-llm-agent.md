# 0039. ローカル LLM の担当（Ollama + qwen3:8b を、別セッション型の委任先として）

- 状態: Accepted
- 日付: 2026-10-25

## 背景
rev1 の要求: Docker で動くローカル LLM を、Claude Code の Haiku の代わりに使えるプラグイン的なエージェントとして追加したい。想定の PC は RTX 3080（VRAM 10GB）・RAM 32GB。

## 決定
- **実行基盤**: Ollama（MIT）を Docker で動かす。compose のプロファイル `local-llm` の下に置き、`docker compose --profile local-llm up -d ollama` のときだけ起動する（NVIDIA GPU がない環境でも、既定の起動は壊れない）。ポートは公開せず、`neko-brain` から `http://ollama:11434` で使う。モデルはボリューム `ollama-models` に保存する。
- **モデル**: `qwen3:8b`（4bit 量子化、7.4GB）。10GB の VRAM に、文脈 16K で収まる（実測 8.3GB）。モデルは `docker compose --profile local-llm exec ollama ollama pull qwen3:8b` で取得する。
- **つなぎ方**: Ollama の Anthropic Messages API 互換（`/v1/messages`）を使い、Claude Code（`claude -p`）をそのまま向ける。実測で、ストリーミングなしの応答とツール呼び出し（`tool_use`）が通った。
- **別セッション型の委任先** `local-llm`（`nekogamisama/suborchestrators.json`）。猫神さまは `bin/delegate.sh local-llm '依頼'` で呼ぶ（`/local-llm 依頼` でも指名できる）。作業フォルダは `nekogamisama/local-llm/`（短い `CLAUDE.md` と、読み取りだけを許す設定）。
- **env と args を持てるようにした**: session 型の項目に、任意の `env`（環境変数）と `args`（`claude` への引数）を足せる。`delegate.sh` が、**許可リストにあるものだけ**を渡す（台帳の登録でも同じ規則で検査）。
  - env: `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` / `CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `CLAUDE_CODE_MAX_CONTEXT_TOKENS` / `CLAUDE_CODE_MAX_OUTPUT_TOKENS`。値は英数字と `. _ : / , * @ -` のみ。
  - args: `--tools` / `--max-turns` / `--model`（値を取る）、`--strict-mcp-config` / `--disable-slash-commands`。`--dangerously-skip-permissions` などは拒否する。
  - 画面などで項目を更新しても、`env` と `args` は、指定がなければ今の値を保つ。
- **env を設定ファイルではなく項目に置く理由**: `.claude/settings.json` の `env` は、起動後に効く。ログイン情報が先に読まれ、Claude アカウントのコネクタ（Claude Docs など）のツールが読み込まれて、小さなモデルが惑わされた（実測）。起動前の環境変数なら、コネクタは無効になる。
- **ツールの絞り込み**: `--tools Read,Glob,Grep`（組み込みは読み取りだけ）、`--strict-mcp-config`（MCP なし）、`--disable-slash-commands`。これでプロンプトは約 8K トークンに収まる（絞らないと、さらに膨らんで誤動作した）。
- **窓を教える**: `CLAUDE_CODE_MAX_CONTEXT_TOKENS=16384`（Ollama の文脈と同じ）と `CLAUDE_CODE_MAX_OUTPUT_TOKENS=2048`。これで「モデルを認識せず、窓を 200k と仮定」の警告が消え、**自動圧縮も 16K の窓で効く**。出力の上限を絞らないと、出力用に確保する分が窓を超え、「Prompt is too long」で失敗する（実測）。`[claude-code:unrecognized_model]` の行は、`nekogamisama/local-llm/.claude/settings.json` の `modelOverrides`（`"claude-haiku-4-5": "qwen3:8b"`）で消える（公式の方法）。
- **Haiku の代わり**: `ANTHROPIC_DEFAULT_HAIKU_MODEL` などを `qwen3:8b` にしてあるので、この担当の中で Haiku を指すものは、すべてローカルのモデルになる。

## 検証（RTX 3080 10GB）
- GPU はコンテナから見える。モデルは 100% GPU、文脈 16,384、VRAM 8.3GB / 10GB。
- 応答: 読み込み後の短い呼び出しは約 1 秒、`claude -p` の 1 往復は約 6〜12 秒。初回のモデル読み込みは約 60 秒。
- 実機（本物の猫神さま）: `/local-llm` で指名 → `delegate.sh` → `qwen3:8b` が `Read` で `CLAUDE.md` を読んで正しく要約。箇条書きの項目数を問う依頼も、正しく「3」と答えた。

## 影響・注意
- **文脈が短い**: Claude Code の最初のプロンプトだけで、絞っても約 8K トークン。ツールを 1 回使うと約 12K（絞らない場合）。16K を超えると、Ollama が古い部分を切る。長い資料や、ツールを何度も呼ぶ作業は向かない。自動圧縮は、上の窓の指定で効くが、圧縮の要約も同じ 16K に入れる必要があり、長い作業の質は落ちる。`--max-turns 8` で、ターンの数も抑えている。
- **向く用途**: 短い質問、要約、単発のファイル読み取り。ツールを連続して呼ぶ作業は、8B では失敗しやすい。
- **読み取り専用**: 書き込み・コマンド実行・Web 取得は、`--tools` で渡していない。ディレクトリのノード（0037）と Python 実行（0038）も使えない（別セッション型のため）。
- 警告: 「このフォルダは未信頼で、`settings.json` の `permissions.allow` を無視した」が出る。`--tools` で絞ってあるので動作に影響はない。信頼を付けるなら、`claude-config` の `.claude.json` で、そのフォルダの `hasTrustDialogAccepted` を `true` にする。
- 警告「`qwen3:8b` を認識せず、窓を 200k と仮定」は、窓の指定で消える（上）。初めは「直せない」と書いたが誤りで、公式の資料に方法があった。
- 残る表示: 「claude.ai のコネクタは無効」（API キー等を設定しているため。意図どおり）。
- **WSL2 の注意**: WSL に割り当てられた RAM は、PC の 32GB ではなく 15GB だった（`free`）。GPU に載る 8B なら足りるが、CPU に溢れる大きなモデルを使うなら、`.wslconfig` の `memory` を増やす。
- Ollama を起動していないと、`local-llm` の呼び出しは接続エラーになる。
- モデルの精度・日本語の質は、Claude より落ちる。重要な判断には使わない。
- 関連: [0011](0011-nekogamisama-hierarchy-and-delegation.md)、[0017](0017-suborchestrator-as-agent-definition.md)、[0038](0038-python-execution-sandbox.md)
