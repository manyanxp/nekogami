# 20261024-26 ポータルの LAN 公開モード（WSL2 + 別 PC のブラウザ）

- 症状: WSL2（Mirrored）で起動した画面が、Mac のブラウザから開けない。原因は `web/package.json` が `-H 127.0.0.1` 固定で、`PORTAL_BIND` が効いていなかったこと。
- `scripts/portal.sh lan` を追加。画面を 0.0.0.0 で待ち受け、API 用の `PORTAL_ALLOWED_HOSTS` を自動設定する。既定は従来どおり localhost のみ。
- `web/package.json`: `-H ${PORTAL_BIND:-127.0.0.1}` に変更。
- `dashboard/server.mjs`: `/` のリダイレクト先を、`WEB_URL` 未指定ならアクセスされたホスト名の :4400 にした。
