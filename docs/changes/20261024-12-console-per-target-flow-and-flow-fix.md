# 2026-10-24 Agent Console のフローを相手ごとに、Console のダイアログ、フロー図が光らない不具合の修正（Phase 5 変更）

- 関連 ADR: 0020（追記）, 0019（修正の追記）, 0022（追記）
- 要件: [20261024-nekogamisama-phase5.md](../requirements/20261024-nekogamisama-phase5.md)（F6・F7）
- 影響範囲: `dashboard/`、`portal/`、`nekogamisama/.claude/settings.json`、`docs/`

## 変更前
Agent Console のフロー図は Azure Sage 固定（「AZURE SAGE」、全エージェントの定義を並べる）で、相手を切り替えても変わらなかった。Console をポータルから開く方法はなかった。ポータルのフロー図は、猫神さまが `Agent` ツールに**長い依頼文**を渡したときなどに、選ばれたエージェントが光らなかった。

## 変更後
- Agent Console のフロー図とタイムラインは、選んだ「相手」ごとに変わる（猫神さま: 委任先、ほかの相手: その相手のチーム）。
- ポータルの一覧のサブオーケストレーターの行の「🖥 Console」で、その相手を選んだ Agent Console がダイアログで開く。
- 選ばれたエージェント・委任先が、依頼文の長さに関わらずフロー図で光る。

## 原因（フロー図が光らない）
1. ツールの入力はイベントに載せる前に 2000 文字で切られる。`Agent` ツールの `subagent_type` は入力の末尾（`prompt` の後）にあるので、依頼文が長いと切り捨てられ、ポータルは選ばれた相手を判定できなかった（実際の履歴 5 件中 1 件で確認）。`delegate.sh` のコマンドも同様。
2. 猫神さまの設定に `SubagentStart` / `SubagentStop` のフックがなく、`Agent` ツールで呼んだ相手の開始・完了が届かなかった。
3. 委任先（サブオーケストレーター）の状態が、自分自身のイベントだけで決まり、配下だけが動いた場合や配下が完了した場合に光らなかった。

## 差分
- 追加: `dashboard/route.mjs`・`route.test.mjs`。
- 変更:
  - Agent Console: `server.mjs`（フックに `route`、許可・発話に相手の印、チームを相手に付ける）、`targets.mjs`（チーム）、`public/index.html`（フロー図とタイムラインを相手ごとに、`?target=`、別セッション委任のカード、委任先と実エージェントのカードを統合）。
  - ポータル: `server.py`（`route` を使う、`/api/chat/targets`）、`index.html`・`js/app.js`・`css/style.css`・`js/api.js`（Console のダイアログ）、`js/flow-model.js`（委任先の状態を配下から決める）。
  - 猫神さま: `.claude/settings.json`（`SubagentStart` / `SubagentStop`）。
  - テスト: バックエンド 32 件（中継テストを拡張）、ブラウザ内 68 項目、Node 15 件（`route` 3、`targets` 5、`nya` 7）。
- 変更なし: 委任設定、`.claude/agents/`、ライセンス（新規依存なし）。

## 移行・注意点
- **Agent Console を再起動する**（`route` の取り出し、相手ごとのフロー図、`?target=` に必要）。ポータルは再起動済み。
- Console のダイアログは、Console が起動していないと空になる（別タブのエラーと同じ）。
- 未確認: 実際の Claude の会話でのフロー図の光り方（偽の SDK とフックで、実際に起きた長い依頼文の形を再現して確認した）。
