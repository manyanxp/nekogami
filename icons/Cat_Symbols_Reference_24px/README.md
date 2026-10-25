# Cat Symbols – 添付画像ベース 24px SVG/PNGセット

- 参照: ユーザー添付の `image(2).png`
- 個別アイコン: 106 種類（機能アイコン 93 種 + 猫柄 8 種 + スタイル見本 5 種）
- 各アイコンは独立した SVG と 24×24px RGBA PNG
- SVG は path で構成。埋め込みラスター無し。
- 透過背景（ただし絵柄の白い部分は白として保持）。
- アイコン名と種別: `catalog.csv`

## 注意
このSVGは添付画像から色領域を輪郭追跡して**ベクター化したもの**です。元画像が小さいため、細部、細い線、アンチエイリアスの色と形には差異があります。元画像の完全なオリジナルベクターデータではありません。24pxで読みやすいように調整しています。

## 構成

```
svg/navigation/home.svg
png/navigation/home.png
svg/coats/calico.svg
png/coats/calico.png
...
```

## HTMLでの使用

```html
<img src="svg/navigation/home.svg" width="24" height="24" alt="ホーム">
<img src="png/coats/ginger_tabby.png" width="24" height="24" alt="茶トラ">
```
