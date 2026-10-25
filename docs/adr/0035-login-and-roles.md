# 0035. ログイン（ローカルアカウント）と管理者／利用者のロール

- 状態: Accepted（[0008](0008-authn-authz-decision.md) の「再検討の条件」に当たる。共有トークンだけの運用を置き換える）
- 日付: 2026-10-25

## 背景
複数の PC から使う（[0034](0034-frontend-backend-containers.md)）ようになり、共有トークンだけでは「誰が使ったか」も「できることの区別」もできない。会話も全員で 1 つだった。

## 決定
- **方式**: ローカルアカウント（ユーザー名 + パスワード）。外部の ID 基盤は使わない。将来 Entra ID を足せるよう、判定は FastAPI の 1 か所（`portal_api/auth.py` の `required_role`）に集める。
- **保存**: `portal/data/users.json`（0600）。パスワードは scrypt（標準ライブラリ。N=2^14, r=8, p=1）でソルト付きハッシュ。署名鍵は `portal/data/secret.key`（0600、無ければ作る。`PORTAL_SECRET` でも指定可）。
- **セッション**: 署名つき Cookie `neko_session`（`HttpOnly`、`SameSite=Strict`、HTTPS のとき `Secure`、既定 7 日）。中身は `ユーザーID.ver.期限.署名`。パスワード変更・ロール変更・無効化で `ver` が上がり、その人の既存セッションは無効になる。
- **ロール**:

  | | 管理者 `admin` | 利用者 `user` |
  |---|---|---|
  | ポータルの閲覧（GET） | ○ | ○ |
  | 猫神さまとのチャット | ○ | ○（自分の会話だけ） |
  | 自分のパスワード変更 | ○ | ○ |
  | 台帳・定義・性格・テーマ・アイコンの変更、Docker 起動・停止 | ○ | ×（403） |
  | 管理ページ `/admin`、Agent Console `/console`、ユーザー管理 | ○ | ×（403） |

- **会話の分離**: Agent Console の会話を「相手 × 利用者」ごとに持つ（キーは `相手@ユーザー名`）。FastAPI がログイン名を `user` として Console に渡し、SSE は自分の `user` のイベントだけを中継する。管理者の `/console` 画面には、利用者の会話は流れない（利用者なし = Console 自身の会話）。
- **Agent Console は FastAPI の背後に置く**: これまで Next.js が直接中継していた `/console-api/*`・`/console-events` を廃止し、`/api/console/*`・`/api/console-events`（管理者のみ）にした。Console にはブラウザから直接届かない。
- **最初の管理者**: ユーザーが 0 人のときだけ、`PORTAL_ADMIN_USER` / `PORTAL_ADMIN_PASSWORD` で起動時に作る。または `docker compose exec api python -m portal_api users add 名前 --role admin`（`list` / `passwd` / `disable` / `enable` / `delete` もある）。画面からの初回登録は作らない（先に開いた人が管理者になるのを避ける）。
- **守り**: パスワードは 10 文字以上。同じユーザー名で 5 回続けて失敗すると 60 秒ロック。存在しない名前でもハッシュ計算を行う（時間差で存在を探れない）。最後の有効な管理者は削除・無効化・降格できない。自分自身の削除・無効化・降格はできない。
- `PORTAL_TOKEN` は残す。スクリプトから `/api` を叩く用の Bearer で、管理者扱い。会話は利用者なし（Console 自身）の側に入る。
- `PORTAL_AUTH=0` でログインを無効にできる（個人利用・開発用。全員が管理者）。`api` と `web` の両方に同じ値を渡す。

## 影響・注意
- 通信は HTTP のまま。LAN 内でもパスワードと Cookie は平文で流れるので、信頼できない網では TLS のリバースプロキシを前置する（`X-Forwarded-Proto: https` で Cookie に `Secure` が付く）。
- 利用者ごとに `claude` を別セッションで動かすため、同時利用が増えると API 利用料も増える。猫神さまの認証（Claude のログイン）は全員で共有している。
- 監査ログ、パスワードのリセットメール、多要素認証は未対応。
- 利用者が猫神さまにさせられること（委任・書き込み先）は、従来どおり Console の `canUseTool` の許可リストで決まる。ロールで変えてはいない。
- 関連: `portal/backend/portal_api/auth.py`、`dashboard/server.mjs`、`web/src/components/Gate.tsx`
