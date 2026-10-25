# 0025. テーマ（ポータルと Agent Console の色）

- 状態: Accepted
- 日付: 2026-10-24

## 背景
rev2 の要求 G3: ポータルと Agent Console のテーマ色を、管理ページから変更できるようにする。

## 決定
- **設定の項目**: モード（`auto` / `dark` / `light`）とアクセント色（`#rrggbb`、または既定）、プリセットの ID。アクセント色以外の色（背景・文字・枠線）は、モードごとの既定のまま。
- **保存と共有**: `portal/data/theme.json`。ポータルの `GET/PUT /api/theme`（管理ページが書く）。Agent Console は同じファイルを `GET /api/theme` で配信する（`THEME_FILE` で場所を変えられる）。ファイルが無い・壊れているときは既定。**値は保存時と読み込み時の両方で検証する**: `mode` は 3 つのいずれか、`accent` は `#rrggbb` のみ、プリセット ID は `[a-z0-9-]{1,24}`。CSS に任意の文字列が入らないようにする。
- **適用**: ポータルの全ページは `theme.js` が、`data-theme`（`dark` / `light`、`auto` は指定なし = OS の設定）と、CSS 変数 `--accent` / `--accent-ink` を `<html>` に設定する。**文字色（`--accent-ink`）は、アクセント色の相対輝度から、黒か白を選ぶ**（明るい色の上は黒、暗い色の上は白）。直前のテーマを `localStorage` に控え、表示のちらつきを抑える。Agent Console は、同じ規則を画面内に持つ。`auto` のときは、Console の ◐ ボタンの選択（`localStorage`）を残す。
- **管理ページ**: 「🎨 テーマ」のカード。モード、プリセット 7 色（既定・ミント・ブルー・パープル・ピンク・オレンジ・グリーン・レッド）、自由な色、保存、既定に戻す。操作中は、その画面にすぐ反映して試せる（保存するまでは他の画面に影響しない）。保存した値は、ポータルと Agent Console の再読み込みで反映される。

## 理由・検討した代替案
- テーマを Agent Console 側（Node）に置く案: 管理ページはポータルにあり、保存はポータル（Python）が持つ。ファイルを共有すれば、2 つの画面が同じ値を読める。
- Agent Console がポータルの API を呼ぶ案: Console 単独でも動かせるよう、ポータルへの依存を作らず、ファイルを読む。
- 背景色・フォントまで変える案: 読みやすさ（コントラスト）の検証が増える。まずはアクセント色とモードに絞った。

## 影響
- 良い点: 1 か所の設定で、2 つの画面の見た目がそろう。不正な値は既定に落ちる。
- 制約・注意:
  - Docker で Console を動かす場合は、`portal/data/` を Console のコンテナからも見える場所にする（compose では、プロジェクトをまるごとコピーしているので、反映には再ビルドか、ボリュームの共有が要る）。
  - アクセント色が背景と近いと見えにくくなる（コントラストの警告は出さない）。
- 関連: `portal/backend/portal_api/theme.py`・`server.py`、`portal/frontend/js/theme.js`・`admin.js`、`dashboard/theme.mjs`・`server.mjs`・`public/index.html`
