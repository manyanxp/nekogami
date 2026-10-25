# 0048 猫神さまは委任だけ、テーマの追従、ポータルの連動

- 状態: Accepted
- 関連: [0011](0011-nekogamisama-hierarchy-and-delegation.md)、[0025](0025-theme-settings.md)、[0047](0047-shared-principles.md)、要件 [rev4](../requirements/20261025-rev4-shared-principles.md)

## 決定
### 猫神さまは、ツールを自分で使わず委任に任せる
- 猫神さま本人（メインスレッド）が使えるのは、次の 3 つだけ。**Agent / Task**（担当を呼ぶ）、**Bash**（`bin/delegate.sh` の形だけ。別セッション型を呼ぶ）、**Read**（委任先の一覧 `nekogamisama/suborchestrators.json` だけ。誰に任せるかを知るため）。
- Glob・Grep・WebSearch・WebFetch・TodoWrite・ToolSearch・書き込み・MCP などは使わせない。判定は Console の `canUseTool`（`dashboard/neko-policy.mjs`）。**配下の担当（agentID のある呼び出し）には適用しない**ので、担当は従来どおり調べられる。
- `nekogamisama/.claude/settings.json` の許可から `Read` / `Glob` / `Grep` を外し、`Read(./suborchestrators.json)` だけにした。`CLAUDE.md`（ルートと `nekogamisama/`）にも同じ方針を書いた。台帳の猫神さまに接続されたツールノードは、もともと 0 件。
- 注意: CLI（`cd nekogamisama && claude`）では、設定の許可から外したため、配下の担当の `Read` などが確認つきになる。ポータルのチャット（Console）では影響しない。

### Agent Console のフローをテーマに追従させる
- Console の「エージェント フロー」は、色が固定の暗色だった。背景・線・文字・カード・進捗バー・スクロールバーを、テーマ変数（`--panel` `--line` `--text` `--muted`）に置き換え、アクセント色（`--accent`）をタイトルと稼働中の線に使う。ライトでは、モデルの色分けだけ濃い色にする。
- 起動時は保存済みのテーマの控えを先に当ててから、サーバーの設定で更新する（ちらつき防止）。

### 管理ページの変更をポータルに連動させる
- 原因は 2 つ。(1) 委任先一覧（`suborchestrators.json`）の項目が、呼び先の定義ファイルが消えても残っていた（名前が違う `news-sub → news-agent` など）。(2) ポータルは開いたときに一度だけ読んでいた。
- (1) 呼び先の定義ファイルがない `type=agent` の項目を、画面に出さず、削除時と起動時に一覧から外す。`.claude/agents/` が空のとき（マウント失敗など）は何も外さない。session 型は触らない。
- (2) 画面に戻ったとき、見えている間は 20 秒ごとに、エンティティと委任先を読み直す。

### Bash は開けず、Python ノードに任せる
- 担当に Bash を許すと、`neko-brain` コンテナ（認証情報の環境変数あり・ネットワークあり・`nekogamisama/` に書き込める）の中で任意のコマンドが動き、権限の制限を迂回できる。そのため開けない。
- 計算・データ処理・スクリプトの実行は、隔離された Python ノード（ネットワークなし・30 秒・512 MB。[0041](0041-python-node.md)）に任せる。
- 専用の担当 `py-analyst` は削除した（定義ファイルは trash に退避）。Python 実行を許したディレクトリのノードと Python ノードは、そのまま使える。必要な担当につなぐ。

## 影響・注意
- 試験: 猫神さまの道具の判定（Console）、古い委任先の非表示・削除（API）。
