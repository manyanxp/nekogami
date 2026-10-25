# 0020. Agent Console への改称と、複数のサブオーケストレーターとの会話

- 状態: Accepted
- 日付: 2026-10-24

## 背景
Phase 5 の要求 F1・F2。Agent Console（`dashboard/`）は Azure Sage 専用の名前と画面で、会話の相手も猫神さまと Azure Sage の 2 つに固定されていた（ADR 0015）。

## 決定
- **改称**: 「Azure Sage Console」→「Agent Console」。画面のタイトル・ヘッダー、起動メッセージ、`package.json` / ロックファイルの名前、ドキュメントを変更。Docker Compose のサービス名（`azure-sage`）、フォルダ名、`TRACE_PORT` などの設定名は、既存の運用を壊さないため変えない。
- **会話の相手を動的にする**（`dashboard/targets.mjs`）: リクエストのたびに次を組み立てる。
  - `nekogamisama`（猫神さま。cwd は `nekogamisama/`）、`azure-sage`（cwd はプロジェクトのルート）は常にある。
  - `nekogamisama/suborchestrators.json` の各項目: `session` 型は `dir` のフォルダで会話（**プロジェクト配下の既存フォルダだけ**。外のフォルダは出さない）。`agent` 型はルートで、SDK の `agent` オプションにそのエージェントを渡し、メインスレッドをその定義（`.claude/agents/`）にして会話。
  - 名前は `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` のみ。猫神さまの名前の上書きは無視。壊れた JSON のときは、既定の 2 つだけ。
  - 委任先の編集（ADR 0018）に自動で追随する（再起動不要）。
- **API**: `GET /api/targets`、`POST /api/chat` と `POST /api/reset` の `agent`（相手の名前。一覧にないものは 400）。SSE の `hello` に相手の一覧を載せる。ブラウザにはフォルダのパスを渡さない。
- **画面**: ヘッダーに「相手」の選択。会話は相手ごとに別（セッション ID も別）。切り替えると、その相手の会話を再表示する（クライアントがイベントを相手ごとに溜めておく）。「新しい会話」は選んでいる相手だけをリセットする。選択は `localStorage` に保存。
- **フロー図は相手ごと**: `GET /api/targets` と `hello` の各相手に、フロー図用の `team`（名前・モデル・役割。パスは含まない）を付ける。猫神さまは委任先の一覧、ほかは `.claude/agents/<相手の名前>/` の定義（agent 型は、呼ぶエージェントのフォルダ）。画面は、タイトルと指揮役のカードを相手の名前にし、チームを待機カードとして並べ、動いたものを実行中・完了にする。委任先の名前と、実際に動く `agent` は 1 枚にまとめる。`delegate.sh` による別セッションへの委任（`route` の `via=session`）は、委任先のカードを、その Bash の完了まで実行中にする。
- **トレースも相手ごと**: 応答中に届いたフック・許可・サブエージェントの発話に、相手の印（`chat`）を付け、クライアントが相手ごとに溜める。相手を切り替えると、フロー図とタイムラインをその相手のイベントで組み直す。印のないもの（CLI など）は既定の相手の扱い。
- **ポータルのダイアログ**: ポータルの一覧のサブオーケストレーターの行に「🖥 Console」。`<dialog>` の iframe に `<CONSOLE_URL>/?target=<名前>` を表示する（Console は `?target=` で相手を選ぶ）。閉じると iframe を `about:blank` にして、常時接続を切る。`GET /api/chat/targets`（ポータルのバックエンドが Console の相手の名前だけを中継）で、委任設定にない行のボタンを無効にする。iframe の `sandbox` は `allow-scripts allow-same-origin allow-forms allow-popups`。
- 既定の相手: 従来の `CHAT_PROJECT_DIR` に加え、`CHAT_TARGET=<名前>`。ポータルのチャット（ADR 0015）は猫神さま固定のまま。
- Bash（委任コマンド）の許可は、従来どおり猫神さまの会話だけ。

## 理由・検討した代替案
- ポータルのチャットも相手を選べるようにする案: ポータルは猫神さまの窓口（委任の可視化もそこ）。他の相手と直接話すのは Agent Console の役割にした。
- 相手の一覧を台帳（ポータル）から取る案: Agent Console は Node で単独でも動く。委任設定（ファイル）を直接読む方が、ポータルなしでも使え、設定との一貫性が保てる。

## 影響
- 良い点: 追加したサブオーケストレーターと、そのまま Agent Console で話せる。トレース画面は従来どおり（猫神さま経由の委任も、直接の会話も同じ画面）。
- 制約・注意:
  - `agent` 型の相手は、プロジェクトのルートで動くので、ルートの `CLAUDE.md`（Azure Sage 用）も読み込まれる。役割はそのエージェントの定義が優先になるよう書く。
  - 応答は同時に 1 つ。相手を切り替えても、応答中は別の相手には送れない（409）。
  - 実際の Claude との会話は、偽の SDK で経路を確認した（実機での `agent` オプションの動作は未確認）。
- 関連: `dashboard/server.mjs`・`targets.mjs`・`public/index.html`、[ADR 0015](0015-portal-chat-with-nekogamisama.md)・[0017](0017-suborchestrator-as-agent-definition.md)・[0018](0018-delegation-editing-contextmenu-rename.md)
