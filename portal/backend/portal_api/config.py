"""設定。環境変数で上書きできる。"""
import os
from pathlib import Path

PROJECT_DIR = Path(os.environ.get('PROJECT_DIR') or Path(__file__).resolve().parents[3]).resolve()
HOST = os.environ.get('PORTAL_HOST', '127.0.0.1')
PORT = int(os.environ.get('PORTAL_PORT', '4401'))   # API。画面（Next.js）は 4400 で、/api/* をここへ中継する
DATA_FILE = Path(os.environ.get('PORTAL_DATA') or PROJECT_DIR / 'portal' / 'data' / 'registry.json')
# ローカル以外から使うホスト名（DNS リバインディング対策の許可リスト。カンマ区切り）
ALLOWED_HOSTS = tuple(h.strip().lower() for h in os.environ.get('PORTAL_ALLOWED_HOSTS', '').split(',') if h.strip())
# 設定すると /api/*（health 以外）に `Authorization: Bearer <token>` が必要になる。未設定なら認証なし（個人利用の既定）
TOKEN = os.environ.get('PORTAL_TOKEN') or None
DOCKER_ENABLED = os.environ.get('PORTAL_DOCKER', '1') != '0'
# 既存の Agent Console（Node）。組み込みオーケストレーターの接続先
CONSOLE_URL = os.environ.get('CONSOLE_URL', 'http://127.0.0.1:4317')
# 猫神さまの委任先設定（管理ページで台帳との突き合わせに使う。読み取りのみ）
DELEGATE_FILE = PROJECT_DIR / 'nekogamisama' / 'suborchestrators.json'
# テーマ（管理ページで変更。Agent Console も同じファイルを読む）
THEME_FILE = Path(os.environ.get('THEME_FILE') or PROJECT_DIR / 'portal' / 'data' / 'theme.json')
# ログイン（ローカルアカウント。ADR 0035）。PORTAL_AUTH=0 で無効（個人利用・開発用。全員が管理者として扱われる）
AUTH_ENABLED = os.environ.get('PORTAL_AUTH', '1') != '0'
USERS_FILE = Path(os.environ.get('PORTAL_USERS') or DATA_FILE.parent / 'users.json')
SECRET_FILE = Path(os.environ.get('PORTAL_SECRET_FILE') or DATA_FILE.parent / 'secret.key')
SESSION_HOURS = int(os.environ.get('PORTAL_SESSION_HOURS', '168'))
# 初回の管理者。ユーザーが 1 人もいないときだけ、起動時に作る
ADMIN_USER = os.environ.get('PORTAL_ADMIN_USER') or None
ADMIN_PASSWORD = os.environ.get('PORTAL_ADMIN_PASSWORD') or None
