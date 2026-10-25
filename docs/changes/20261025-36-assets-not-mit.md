# 2026-10-25 画像・アニメーション素材を MIT の対象外（このアプリ専用）にした

- 関連 ADR: 0010
- 影響範囲: `LICENSE`、`NOTICE.md`、`README.md`、`docs/licenses/README.md`、`icons/*/README.txt`

## 変更前
画像素材の扱いが「画像生成ツールで制作、要確認」とだけ書かれ、リポジトリ全体の MIT との関係が曖昧だった。

## 変更後
ChatGPT で生成した猫神さまのアイコン・走る GIF などを、MIT の対象外・このアプリ専用と明記した。対象の一覧は NOTICE.md。

## 残っている確認事項
- OpenAI の利用規約の原文（Terms of Use「Content」）は未確認（二次情報のみ）。台帳は「要確認」のまま。
- GIF の参照画像（`prompt.txt` の identity-preserve）の出どころの確認。
- `icons/Cat_Symbols_Reference_24px/`: 「ユーザー添付の画像」をベクター化したもので、出どころ不明。アプリからは参照されていない。公開を続けるか外すか要判断。
