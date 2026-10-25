# 2026-10-24 Agent Console の汎用化・画面配置・フロー図・性格（Phase 5）

- 関連 ADR: 0020, 0021, 0022
- 要件: [20261024-nekogamisama-phase5.md](../requirements/20261024-nekogamisama-phase5.md)
- 影響範囲: `dashboard/`、`portal/`、`nekogamisama/`、`docs/`、README、`docker-compose.yml`

## 変更前
Agent Console は「Azure Sage Console」で、会話の相手は猫神さまと Azure Sage の 2 つに固定。ポータルは一覧とチャットの固定配置で、猫神さまの委任はトレースのログでしか見られなかった。猫神さまの性格は設定できなかった。

## 変更後
- 画面は「Agent Console」。ヘッダーの「相手」で、猫神さま・Azure Sage・委任先一覧の各項目と話せる（会話は相手ごとに別）。
- ポータルの一覧とチャットは、ヘッダーのドラッグで上下左右に配置換えでき、間のバーでサイズ変更できる。
- チャット欄の下に、猫神さまの委任のフロー図（会話中に選ばれたものが光る）とトレースログのタブ。
- 管理ページで猫神さまの性格（一人称・呼びかけ・口調・性格）を設定でき、返答に反映される。

## 差分
- 追加: `dashboard/targets.mjs`・`targets.test.mjs`、`portal/backend/portal_api/personality.py`、`portal/frontend/js/layout.js`・`layout-model.js`・`flow.js`・`flow-model.js`、`nekogamisama/personality.md`、ADR 0020〜0022、要件資料。
- 変更:
  - Agent Console: `server.mjs`（相手を動的に、`/api/targets`、`agent` オプション、改称）、`public/index.html`（相手の選択、相手ごとの会話の再表示、改称）、`package.json`・ロックファイルの名前。
  - ポータル: `index.html`・`css/style.css`・`js/chat.js`（配置換え、分割バー、フロー図とタブ）、`admin.html`・`js/admin.js`・`js/api.js`・`css/admin.css`（性格のカード）、`server.py`（`/api/admin/personality`）。
  - 猫神さま: `nekogamisama/CLAUDE.md`（末尾に「性格・話し方」の節と `@personality.md`）。
  - その他: `docker-compose.yml`（`CHAT_TARGET`）、README、各 ADR の索引。
  - テスト: バックエンド 29 → 32 件、ブラウザ内 50 → 67 項目、Node 7 → 11 件。
- 変更なし: `.claude/agents/` の定義、委任設定（`suborchestrators.json`）、ライセンス（新規依存なし）。

## 移行・注意点
- ポータルと Agent Console を再起動する（ポータルは反映済み）。Agent Console を再起動しないと、「相手」の選択が出ない。
- 保存済みの画面配置（localStorage）はない状態から始まる。既定は従来と同じ（チャットが右、幅 400px）。
- `nekogamisama/CLAUDE.md` の末尾に節が増えた。手で編集して `@personality.md` の行を消すと、性格は反映されない。
- Docker Compose のサービス名 `azure-sage` は据え置き（`docker compose exec azure-sage …` は従来どおり）。
- 未確認: 実際の Claude の会話でのフロー図の光り方、Agent Console で `agent` 型の相手と話す動作（偽の SDK で経路を確認）。
