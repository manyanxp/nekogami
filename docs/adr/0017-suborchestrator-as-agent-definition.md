# 0017. サブオーケストレーターをエージェント定義として追加し、Agent ツールで呼ぶ

- 状態: Accepted
- 日付: 2026-10-24

## 背景
Phase 4 の要求 S1: Claude を使うサブオーケストレーターを追加したい。[ADR 0011](0011-nekogamisama-hierarchy-and-delegation.md) は「サブエージェントはサブエージェントを起動できない」という理解（公式ドキュメント未確認）から、サブオーケストレーターを別セッション（`delegate.sh`、`claude -p`）で動かす方式にした。公式ドキュメント（code.claude.com/docs/en/sub-agents）を確認したところ、**サブエージェントも Agent ツールで別のサブエージェントを起動できる**（既定で、メインの会話の下に 3 層まで）。ADR 0011 の前提は誤りだった。

## 決定
- **追加するサブオーケストレーターは、エージェント定義ファイル**（`.claude/agents/<名前>/<名前>.md`、`role: suborchestrator`、`tools` に `Agent` を含む）として作り、猫神さまが **Agent ツール**で `subagent_type` に名前を指定して呼ぶ。配下のエージェントは同じフォルダの定義で、サブオーケストレーターが Agent ツールで起動する（猫神さま → サブオーケストレーター → エージェントの 3 層）。
- 猫神さまの委任先一覧 `nekogamisama/suborchestrators.json` に、種類（`type`）を持たせた。
  - `session`: 従来の別セッション型（`dir` を持つ。`delegate.sh` で委任）。`azure-sage` はこれ。サブオーケストレーターの追加・削除に伴う自動更新では触らない。管理ページの委任先の編集では、画面から明示的に操作したときだけ、プロジェクト配下のフォルダに限って変更できる（[ADR 0018](0018-delegation-editing-contextmenu-rename.md)）。
  - `agent`: エージェント定義型（`agent` に名前）。ポータルがサブオーケストレーターの追加・削除に合わせて書き換える。`delegate.sh` は `agent` 型を拒否し、Agent ツールを使うよう案内する。
- 猫神さまの `CLAUDE.md` に、2 つの呼び方を書いた。
- **Azure Sage は変えない**（`session` 型のまま）。動いている構成を壊さないため。将来、`.claude/agents/azure-sage/azure-sage.md` として `agent` 型へ移すこともできる。

## 理由・検討した代替案
- 追加するものも `session` 型（フォルダ + `CLAUDE.md` + `delegate.sh`）にする案: 追加のたびにフォルダ・設定・信頼設定が要り、ポータルがフォルダを指す設定を書くことになって安全面で不利。定義ファイル 1 つで済む `agent` 型の方が、体系的な管理（ADR 0016）とも合う。
- 全部を `agent` 型にして `delegate.sh` をやめる案: 動作確認済みの Azure Sage を作り直すことになる。別セッション型にも、コンテキストを分けられる利点がある。

## 追記（2026-10-24）: azure-sage も agent 型にそろえた
`suborchestrators.json` の `azure-sage` は、`type: agent`・`agent: azure-architect` になっている（実際の設定を正とした）。上の「Azure Sage は変えない（`session` 型のまま）」は、この時点では古い。`azure-architect` は `Agent` ツールを持たないため、調査（`azure-researcher`）と精査（`azure-reviewer`）は猫神さま（呼ぶ側）が Agent ツールで行い、精査済みの結果を渡して提案させる。`nekogamisama/CLAUDE.md` とルートの `CLAUDE.md` にこの手順を書いた。`azure-architect` に調査も任せたいときは、`tools` に `Agent` を足す（その場合、台帳上の位置づけも見直す）。

## 影響
- 良い点: ポータルから追加したサブオーケストレーターが、Bash を使わず Agent ツールで呼べる。トレース（`SubagentStart` / `SubagentStop`）に親子として出る。
- 制約・注意:
  - `agent` 型は同じセッション内で動くので、会話の文脈とトークンを猫神さまと共有する。入れ子は 3 層まで。
  - 猫神さまの権限設定（`nekogamisama/.claude/settings.json`）の `permissions.allow` は、**そのフォルダを信頼するまで `claude -p` では無視される**（確認済み: `Ignoring 4 permissions.allow entries … workspace has not been trusted`）。CLI で使うときは `cd nekogamisama && claude` を一度対話で起動して信頼してよいか確認に答える。Agent Console（SDK）は `canUseTool` で判定するので影響しない。
  - 実際に猫神さまが `agent` 型へ依頼して結果を統合する動作は未確認（Claude との会話が必要）。
- 関連: [ADR 0011](0011-nekogamisama-hierarchy-and-delegation.md)（前提の訂正を追記）、[ADR 0016](0016-agent-definition-files.md)、`nekogamisama/CLAUDE.md`・`bin/delegate.sh`・`suborchestrators.json`
