# 2026-10-24 考え中の GIF を太陽の猫神さまにする

- 関連 ADR: 0028（追記）
- 影響範囲: 画面

## 変更前
ポータルのチャットの考え中は、`scripts/gen-neko-gif.py` で作った小さな走る猫の GIF（64px、ドット絵）。

## 変更後
`icons/sun-cat-loading/sun-cat-running-256.gif` を `web/public/sun-cat-running.gif` にコピーして使う（96px 表示）。Agent Console のチャットは従来のまま。

## 差分（箇条書き）
- 追加: `web/public/sun-cat-running.gif`
- 変更: `web/src/components/Chat.tsx`、`web/src/styles/portal.css`（`pixelated` を外した）、ライセンス台帳（要確認で追記）

## 移行・注意点
- 画像の利用条件は要確認（生成ツールの規約）。
