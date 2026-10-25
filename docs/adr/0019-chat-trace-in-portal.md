# 0019. ポータルのチャットで、選ばれたエージェントをトレースで見せる

- 状態: Accepted（Phase 5 以降、トレースはチャットの外の独立したパネル: [ADR 0024](0024-portal-panels-and-flow-view.md)）
- 日付: 2026-10-24

## 背景
Phase 4 の追記要求 S7: 猫神さまとのチャットで、どのエージェントが選ばれたかをポータルで見たい。トレース（フックのイベント）は Agent Console が受けており、ポータルのチャット中継（[ADR 0015](0015-portal-chat-with-nekogamisama.md)）は、トレースを流さない方針だった。

## 決定
- **印付け（Agent Console）**: チャットの応答中（`running`）に届いたフックイベントに、`chat: <相手>`（例: `nekogamisama`）を付ける。相手ごとの会話リセットでは、チャットのイベントと一緒に、その印のフックも消す。
- **中継（ポータルのバックエンド）**: `chat` が `nekogamisama` のフックだけを、最小限の `trace` イベントにして SSE に流す。
  - 対象: `PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `SubagentStart` / `SubagentStop` / `Stop`。ユーザーの入力、ツールの出力、他の相手の会話、応答の外のフックは流さない。
  - 選ばれたエージェントの抽出（`route`）: `Agent`（`Task`）ツールの `subagent_type` → `via=agent`、`Bash` の `delegate.sh <名前>` → `via=session`（別セッションへの委任）。
  - 長い文字列は切る（入力 200、メッセージ 400、依頼文 300 文字）。セッション ID は先頭 8 文字。
  - エージェントの発言（`message`）には、ADR 0012 の語尾「にゃ」が付いたものがそのまま出る。
- **画面（ポータル）**: チャット欄の下に折りたたみ式の「トレース」。
  - チップ: 選ばれたエージェントごとに 1 つ。台帳の種別で色分け（サブオーケストレーター・エージェント・サブエージェント）、稼働中（●）/ 完了（✓）、ツールの呼び出し回数、別セッションへの委任の印。
  - 時系列: 選択（→ 名前を選択）、開始（▶）、ツール呼び出し、完了（■）、失敗。サブエージェント内の動きはインデントする。
  - 新しい依頼ごとにトレースを切り替える（最新の依頼のトレース）。再読み込みでは、Agent Console が保存している履歴から再生される。

## 理由・検討した代替案
- セッション ID で絞る案: 委任した別セッション（`delegate.sh`）のフックはセッション ID が異なり、結び付けられない。応答中という時間窓で印を付ける方が、委任先の動きも含められる。
- トレース全体（出力を含む）を流す案: 量が多く、機微な内容（ファイルの中身、検索結果）をポータルに出すことになる。選択の可視化に必要な最小限にした。
- ポータルが Agent Console の画面（トレースの全体）を埋め込む案: 要求は、猫神さまのチャットでの選択の可視化で、見た目も分かれるので不採用。詳細は Agent Console の画面で見る。

## 影響
- 良い点: 猫神さまが誰を選んだか、委任先で何が起きたかが、チャットのすぐ下で分かる。
- 制約・注意:
  - **時間窓での印付けなので、応答中に別の Claude セッション（CLI など）が同じ Agent Console にフックを送ると、その動きも混ざる。** Agent Console は同時に 1 つの応答だけ処理する。
  - Agent Console を再起動すると、履歴（トレースを含む）は消える。
  - 実際の Claude の会話でのトレース表示は未確認（偽の SDK とフックで経路を確認した）。
- **不具合の修正（Phase 5 追記）**: ツールの入力は、イベントに載せるときに 2000 文字で切られる。`Agent` ツールの入力は `description` → `prompt` → `subagent_type` の順なので、**依頼文が長いと `subagent_type` が切り捨てられ**、どのエージェントが選ばれたか分からなくなっていた（実際の履歴で確認: 5 件中 1 件）。Agent Console が、切る前の生の入力から `route` を取り出して（`dashboard/route.mjs`）イベントに載せ、ポータルのバックエンドはそれを使う（古い Console のために、入力を読む従来の方法も残す）。`delegate.sh` のコマンドが長い場合も同じ。
- 併せて、猫神さまの設定（`nekogamisama/.claude/settings.json`）に `SubagentStart` / `SubagentStop` のフックがなかったので追加した（猫神さまが `Agent` ツールで呼んだ相手の「開始・完了」が届かず、完了にならなかった）。
- 関連: `dashboard/server.mjs`（`normalizeHook` の `chat`、`reset`）、`portal/backend/portal_api/server.py`（`trace_event`、`filter_chat_event`）、`portal/frontend/js/chat.js`、[ADR 0003](0003-dashboard-trace-and-chat.md)・[0012](0012-trace-nya-suffix.md)・[0015](0015-portal-chat-with-nekogamisama.md)
