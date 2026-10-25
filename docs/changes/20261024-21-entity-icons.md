# 2026-10-24 アイコンの変更・アップロード・既定

- 関連 ADR: 0032
- 影響範囲: 画面 / API / 台帳

## 変更前
アイコンは固定（チャットと Agent Console の猫神さまは `sun_cat_goddess`、ほかは絵文字・既存の猫の絵）。変更できなかった。

## 変更後
猫神さま・サブオーケストレーター・エージェントごとにアイコンを選べる。組み込みの画像から選ぶか、画像をアップロードする。未設定の既定は、猫神さま = `sun_cat_goddess`、ほか = `miko_cat_goddess`。

## 差分（箇条書き）
- 追加: `portal/backend/portal_api/icons.py`、`GET/POST /api/icons`・`GET/DELETE /api/icons/{参照}`、台帳の `icon`、`portal/assets/icons/`（192px の組み込み 5 種）、`web/src/lib/icons.ts`・`components/IconPicker.tsx`、バックエンドのテスト 4 件、vitest 3 件、ADR 0032
- 変更: `scripts/make-avatar.py`（組み込み 5 種も生成）、一覧・編集ダイアログ・委任フロー・チャット・猫神さま管理・ノードグラフ、`docs/licenses/README.md`（縮小版を「要確認」で追記）
- 追加（仕様更新）: 管理ページのノードの右クリックメニューに「編集…」「アイコンを変更…」、ノードの編集ダイアログ。左の「選択中」にもアイコンの選択を追加
- 削除: なし

## 移行・注意点
- 既存の台帳は、読み込み時に `icon: null`（既定）になる。移行は不要。
- アップロード画像は `portal/data/icons/`（git 管理外）。
- 検証: バックエンド 39 件、vitest 32 件、`tsc --noEmit`、`next build`、Console 22 件。ヘッドレス Chromium で、右クリック → 編集ダイアログ → 選択・アップロード → 一覧に反映、不正な画像と使用中の削除の拒否を確認。未確認: 実機のブラウザでの目視（この環境では日本語フォントが無く、文字が四角で表示された）。Agent Console は対象外（要求は、ポータルと管理ページ）。
