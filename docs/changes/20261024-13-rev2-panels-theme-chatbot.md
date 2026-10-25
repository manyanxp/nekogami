# 2026-10-24 パネル配置・テーマ・チャットボットと / コマンド（rev2）

- 関連 ADR: 0024, 0025, 0026（0022 の画面配置を置き換え）
- 要件: [20261024-rev2-ui-chatbot.md](../requirements/20261024-rev2-ui-chatbot.md)
- 影響範囲: `portal/`、`dashboard/`、`nekogamisama/`、`.claude/agents/nekogamisama/`、`docs/`

## 変更前
ポータルは「一覧」と「チャット」の 2 ペインで、委任フロー（SVG）とトレースは、チャットの下のタブだった。一覧にランタイムの列があった。色は固定（OS のモードに追従）。チャットでは、猫神さまにだけ話しかけられ、特定の相手を指名する方法はなかった。

## 変更後
- 一覧・チャット・委任フロー・トレースが、独立した 4 つのパネルになり、左の列・右の列・下の行へ、ドラッグで移動・サイズ変更できる。既定は、左に 一覧 → 委任フロー → トレース、右にチャット。
- 委任フローは、参考画像と同じ流れのカード型（進捗バー・x/y 完了・ツール数・配下の点）。トレースはセッションログ風の表。
- 一覧の「ランタイム」の列を削除。
- 管理ページの「🎨 テーマ」で、ポータルと Agent Console のモードとアクセント色を設定できる。
- チャットボット `neko-chat` を追加（猫神さまの性格で、雑談・使い方の説明）。チャットの `/` で、委任先とエージェントを候補から選んで指名できる。

## 差分
- 追加:
  - `portal/frontend/js/`: `layout-model.js`（置き換え）・`layout.js`（置き換え）・`flow-model.js`（置き換え）・`flow.js`（置き換え）・`trace-model.js`・`theme.js`
  - `portal/backend/portal_api/theme.py`、`dashboard/theme.mjs`・`theme.test.mjs`
  - `.claude/agents/nekogamisama/neko-chat.md`
  - ADR 0024〜0026、要件資料
- 変更:
  - ポータル: `index.html`・`css/style.css`・`css/admin.css`・`js/chat.js`・`js/app.js`・`js/admin.js`・`js/api.js`・`admin.html`・`server.py`（`/api/theme`、`/api/chat/commands`、`/` の展開）・`config.py`
  - Agent Console: `server.mjs`（`/api/theme`）、`public/index.html`（テーマの適用）
  - 猫神さま: `CLAUDE.md`（指名と、おしゃべりの任せ方）
  - テスト: バックエンド 35 件、ブラウザ内 86 項目、Node 18 件
- 変更なし: 委任設定、既存のエージェントの定義、ライセンス（新規依存なし）。
- 移動（ドキュメント）: `docs/add_requirement/2026-10-24.add_requirement.md` が `docs/add_requirement/2026-10-24/` に移っていたので、要件資料のリンクを直した。

## 移行・注意点
- ポータルは再起動済み。**Agent Console を再起動する**（テーマの配信に必要）。
- パネルの配置は、新しいキーで保存される（以前の配置は引き継がない。既定の配置から始まる）。
- 起動時の同期で、`neko-chat` が台帳に登録される（猫神さま直下のエージェント）。
- 未確認: 実際の Claude の会話で、猫神さまが `[指名: …]` を守り、おしゃべりを `neko-chat` に任せるか。
