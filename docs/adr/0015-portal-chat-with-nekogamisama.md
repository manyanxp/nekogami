# 0015. ポータルから猫神さまとチャットする方式

- 状態: Accepted
- 日付: 2026-10-24

## 背景
Phase 3 の要求 Q8: ポータル画面に、猫神さまと会話できる入力エリアを置く。会話の実行（Claude Agent SDK、委任、トレースのフック）は既存の Agent Console（Node、`dashboard/`、:4317）が持っている。ポータル（Python、:4400）はそれとは別プロセス。

## 決定
- **中継**: ブラウザはポータルのバックエンドだけと話し、バックエンドが Agent Console へ中継する。ブラウザから Agent Console へ直接つながない。
  - `POST /api/chat` `{message}` → Agent Console の `POST /api/chat`（`agent` は **`nekogamisama` に固定**。クライアントが指定しても変えない）。1〜8000 文字。上流のステータス（202、409 など）をそのまま返す。
  - `POST /api/chat/stop`、`POST /api/chat/reset`（猫神さまの会話だけを消す）。
  - `GET /api/chat/stream`: Agent Console の SSE（`/events`）を中継する。**猫神さまのチャットイベントとリセット、接続状態だけ**に絞り、トレース（フック）、他のエージェントの会話、セッション ID などは流さない。切れたらフロントが再接続し、サーバー側に保存された会話が再生される。
  - Agent Console に接続できないときは 502 と、起動方法を含むメッセージを返す。
- **Agent Console 側**: チャットの相手をリクエストの `agent`（`azure-sage` / `nekogamisama`、許可リスト）で選べるようにし、**セッションは相手ごとに別**にした。チャットのイベントに `agent` を付ける。`reset` は相手を指定すると、その相手の会話だけを消す。既定の相手は従来どおり（`CHAT_PROJECT_DIR`）で、Agent Console の画面には他の相手の会話を出さない。Bash（委任コマンド）の許可は `nekogamisama` の会話だけ。
- **画面**: 一覧の右にチャット欄（`js/chat.js`）。Ctrl+Enter で送信、停止、リセット、接続状態の表示。本文は `textContent` で描画し、HTML を解釈しない。SSE は `fetch` で読む（`EventSource` は `Authorization` ヘッダーを付けられず、`PORTAL_TOKEN` 設定時に使えないため）。
- 認証: ポータルの他の API と同じ（`PORTAL_TOKEN`、Host/Origin 検証）。

## 理由・検討した代替案
- ブラウザから Agent Console へ直接つなぐ案: クロスオリジンになり、Agent Console に CORS を許可する必要がある。認証のない Agent Console を他のサイトのページから叩けるようにするのは危険なので不採用。
- ポータルのバックエンドに Claude Agent SDK を入れて直接会話する案: Python 側にもう 1 つの実行基盤・認証・権限制御（ADR 0002）を持つことになる。既存の Agent Console を再利用する。
- チャット欄に `<iframe>` で Agent Console を埋め込む案: 要求は「ポータル画面の入力エリア」で、会話の相手が固定できず、見た目も分かれるので不採用。

## 影響
- 良い点: Agent Console の安全設計（`canUseTool`、許可リスト）をそのまま使える。ブラウザと Agent Console が直接つながらない。
- 制約・注意:
  - **Agent Console の再起動が必要**（`agent` を受け付ける新しい版）。古い版のままだと `agent` が無視されて Azure Sage が答え、イベントに `agent` が付かないため、ポータルのチャット欄には何も出ない。
  - 会話の実行には、Agent Console に `npm install` 済みであることと、Claude の認証（Agent Console の画面でログイン、または API キー）が必要。
  - 応答は 1 つずつ（Agent Console が同時に 1 つの応答だけ処理する）。Agent Console の画面と同時に使うと、片方が 409（応答中）になる。
  - ポータルのチャット欄には、どのエージェントが選ばれたかを示す最小限のトレースだけを出す（[ADR 0019](0019-chat-trace-in-portal.md)）。詳細（ツールの出力など）は Agent Console の画面で見る。
  - チャットの返答の本文には「にゃ」を付けない（ADR 0012）。
- 関連: `portal/backend/portal_api/server.py`（`filter_chat_event`、`console_call`、`_chat_stream`）、`portal/frontend/js/chat.js`・`api.js`、`dashboard/server.mjs`、[ADR 0003](0003-dashboard-trace-and-chat.md)・[0011](0011-nekogamisama-hierarchy-and-delegation.md)・[0013](0013-admin-agent-and-admin-page.md)
