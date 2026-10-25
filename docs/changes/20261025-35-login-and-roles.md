# 2026-10-25 ログインと管理者／利用者のロールを導入

- 関連 ADR: 0035、0008、0034
- 影響範囲: `portal/backend/portal_api/{auth,app,chat,config,__main__}.py`、`dashboard/server.mjs`、`web/`（ログイン画面・Gate・ユーザー管理）、`docker-compose.yml`

## 変更前
共有トークン（`PORTAL_TOKEN`）だけ。全員が同じ権限で、猫神さまとの会話も 1 つを共有していた。

## 変更後
- ログイン画面 `/login`、ローカルアカウント、管理者／利用者のロール。管理ページにユーザー管理カード。
- 会話は利用者ごとに分離（Agent Console が `user` を受け取り、`相手@ユーザー名` で管理）。
- `/console-api`・`/console-events` を廃止。`/api/console/*`・`/api/console-events`（管理者のみ）に変更。
- 検証: バックエンド 50 件、vitest 40 件、dashboard 22 件が成功。LAN の IP 越しに、未ログイン拒否、利用者の 403、他の利用者の会話が見えないこと、リセット、削除を確認した。

## 移行・注意点
- `.env` の `PORTAL_TOKEN` を `PORTAL_ADMIN_USER` / `PORTAL_ADMIN_PASSWORD` に替える。ユーザー作成後はパスワードを `.env` から消してよい。
- `docker compose up -d --build`。既存のブラウザのタブは再読み込みでログイン画面になる。
- 依存の追加なし（`docs/licenses/` の更新は不要）。

## 追記: Compose のサービス名 `azure-sage` → `neko-brain`
- Agent Console のサービスを、役割（猫神さまの脳）に合わせて改名した。エージェント名の `azure-sage` は変えていない。
- 台帳はサービス名を参照しないので影響なし。ボリューム `claude-config` も引き継がれる（Claude のログイン状態は残る）。
- `docker compose up -d --build --remove-orphans` で旧コンテナを片付ける。`docker compose exec neko-brain claude` に変わる。
