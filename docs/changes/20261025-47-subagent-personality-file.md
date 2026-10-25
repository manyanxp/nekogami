# 2026-10-25 サブオーケストレーターごとの personality.md（rev3 追加分）

- 関連 ADR: 0046（0044 の保存先を更新）
- 影響範囲: `portal/backend/portal_api/{personality,registry}.py`、`web/src/components/AdminCards.tsx`

## 変更前
サブオーケストレーターの性格は、定義ファイルの本文の「性格・話し方」の節に直接書いていた。

## 変更後
`nekogamisama/personalities/<名前>/personality.md` を正とし、保存・手編集・起動時に、定義の節へ自動同期する。名前の変更でフォルダが付いてくる。削除で trash へ退避する。ファイルがない既存のものは、従来どおり定義の節を読む。

## 移行・注意点
- `docker compose up -d --build api web`。既存の節は、性格を保存したときにファイルへ移る。
