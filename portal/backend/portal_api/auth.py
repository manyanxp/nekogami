"""ログイン（ローカルアカウント）: ユーザー台帳、パスワードのハッシュ、署名つきセッション Cookie、ロールの判定。"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid
from pathlib import Path

from . import config
from .registry import Forbidden, NotFound, ValidationError

USER_RE = re.compile(r'^[a-z0-9][a-z0-9_-]{0,31}$')   # Agent Console の user と同じ形式（会話の分離に使う）
ROLES = ('admin', 'user')
MIN_PASSWORD = 10
MAX_PASSWORD = 200
COOKIE = 'neko_session'
_SCRYPT = dict(n=2 ** 14, r=8, p=1, dklen=32)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split('$')
        got = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=len(_unb64(dk)))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, _unb64(dk))


_DUMMY = hash_password('dummy-password-for-timing')


def check_password_rule(password) -> str:
    if not isinstance(password, str) or not (MIN_PASSWORD <= len(password) <= MAX_PASSWORD):
        raise ValidationError(f'パスワードは {MIN_PASSWORD} 文字以上 {MAX_PASSWORD} 文字以下')
    return password


def _public(u: dict) -> dict:
    return {k: u[k] for k in ('id', 'username', 'role', 'disabled', 'created') if k in u}


class UserStore:
    """users.json（ハッシュ化したパスワードを含むので 0600）。変更のたびに `ver` を上げ、その利用者の既存セッションを無効にする"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()

    def _load(self) -> list[dict]:
        try:
            return json.loads(self.path.read_text(encoding='utf-8')).get('users', [])
        except (OSError, ValueError):
            return []

    def _save(self, users: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.tmp')
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump({'users': users}, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    def count(self) -> int:
        return len(self._load())

    def list(self) -> list[dict]:
        return [_public(u) for u in self._load()]

    def find(self, username: str):
        return next((u for u in self._load() if u['username'] == username), None)

    def get(self, uid: str):
        return next((u for u in self._load() if u['id'] == uid), None)

    def _active_admins(self, users, excluding=None):
        return [u for u in users if u['role'] == 'admin' and not u.get('disabled') and u['username'] != excluding]

    def create(self, username, password, role='user') -> dict:
        if not isinstance(username, str) or not USER_RE.match(username):
            raise ValidationError('ユーザー名は半角の英小文字・数字・_・- で 32 文字まで（先頭は英数字）')
        if role not in ROLES:
            raise ValidationError('role は admin か user')
        check_password_rule(password)
        with self._lock:
            users = self._load()
            if any(u['username'] == username for u in users):
                raise ValidationError('そのユーザー名は使われている')
            u = {'id': str(uuid.uuid4()), 'username': username, 'role': role, 'pw': hash_password(password), 'ver': 1,
                 'disabled': False, 'created': time.strftime('%Y-%m-%dT%H:%M:%S')}
            users.append(u)
            self._save(users)
            return _public(u)

    def update(self, username, *, role=None, disabled=None, password=None) -> dict:
        with self._lock:
            users = self._load()
            u = next((x for x in users if x['username'] == username), None)
            if u is None:
                raise NotFound(username)
            if role is not None:
                if role not in ROLES:
                    raise ValidationError('role は admin か user')
                u['role'] = role
            if disabled is not None:
                u['disabled'] = bool(disabled)
            if password is not None:
                u['pw'] = hash_password(check_password_rule(password))
            if not self._active_admins(users):
                raise Forbidden('有効な管理者が 1 人もいなくなる変更はできない')
            u['ver'] = u.get('ver', 1) + 1
            self._save(users)
            return _public(u)

    def delete(self, username) -> None:
        with self._lock:
            users = self._load()
            rest = [u for u in users if u['username'] != username]
            if len(rest) == len(users):
                raise NotFound(username)
            if not self._active_admins(rest):
                raise Forbidden('最後の管理者は削除できない')
            self._save(rest)


class Sessions:
    """署名つき Cookie（`uid.ver.期限.署名`）。サーバー側に状態を持たず、ユーザーの ver が変わると無効になる"""

    def __init__(self, secret: bytes):
        self.secret = secret

    @classmethod
    def load(cls, path: Path = None) -> 'Sessions':
        env = os.environ.get('PORTAL_SECRET')
        if env:
            return cls(env.encode())
        path = Path(path or config.SECRET_FILE)
        try:
            return cls(path.read_bytes())
        except OSError:
            path.parent.mkdir(parents=True, exist_ok=True)
            key = secrets.token_bytes(32)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'wb') as f:
                f.write(key)
            return cls(key)

    def _sig(self, body: str) -> str:
        return hmac.new(self.secret, body.encode(), hashlib.sha256).hexdigest()

    def issue(self, user: dict) -> str:
        body = f"{user['id']}.{user.get('ver', 1)}.{int(time.time()) + config.SESSION_HOURS * 3600}"
        return f'{body}.{self._sig(body)}'

    def user_of(self, cookie: str | None, users: UserStore):
        try:
            uid, ver, exp, sig = (cookie or '').split('.')
        except ValueError:
            return None
        if not hmac.compare_digest(sig, self._sig(f'{uid}.{ver}.{exp}')) or int(exp) < time.time():
            return None
        u = users.get(uid)
        if u is None or u.get('disabled') or str(u.get('ver', 1)) != ver:
            return None
        return u


class Throttle:
    """ログイン失敗の制限: 同じユーザー名で 5 回続けて失敗したら、60 秒ロックする（総当たり対策）"""
    LIMIT, LOCK = 5, 60

    def __init__(self):
        self._fails: dict[str, tuple[int, float]] = {}

    def locked(self, name: str) -> bool:
        n, until = self._fails.get(name, (0, 0.0))
        return n >= self.LIMIT and until > time.time()

    def fail(self, name: str) -> None:
        n, until = self._fails.get(name, (0, 0.0))
        n = 1 if until and until < time.time() and n >= self.LIMIT else n + 1
        self._fails[name] = (n, time.time() + self.LOCK)

    def ok(self, name: str) -> None:
        self._fails.pop(name, None)


def authenticate(users: UserStore, username, password):
    """正しければユーザー、違えば None。存在しないユーザー名でも同じだけ時間をかける"""
    u = users.find(username) if isinstance(username, str) else None
    ok = verify_password(password if isinstance(password, str) else '', u['pw'] if u else _DUMMY)
    return u if (u and ok and not u.get('disabled')) else None


def bootstrap(users: UserStore) -> str | None:
    """ユーザーが 1 人もいなければ、PORTAL_ADMIN_USER / PORTAL_ADMIN_PASSWORD で最初の管理者を作る"""
    if users.count() or not (config.ADMIN_USER and config.ADMIN_PASSWORD):
        return None
    users.create(config.ADMIN_USER, config.ADMIN_PASSWORD, 'admin')
    return config.ADMIN_USER


# ---- ロールの判定 ----
PUBLIC = {('GET', '/api/health'), ('POST', '/api/auth/login'), ('GET', '/api/auth/me')}
USER_WRITE = {('POST', '/api/chat'), ('POST', '/api/chat/stop'), ('POST', '/api/chat/reset'),
              ('POST', '/api/auth/logout'), ('PUT', '/api/auth/password')}
ADMIN_PREFIXES = ('/api/admin/', '/api/users', '/api/console')


def required_role(method: str, path: str) -> str | None:
    """必要なロール: None = ログイン不要 / 'user' = ログイン済み / 'admin' = 管理者。
    閲覧（GET）は利用者も可。チャットは利用者も可。台帳・定義・性格・テーマなどの変更と、ユーザー管理・Console の中継は管理者だけ"""
    if (method, path) in PUBLIC or (method == 'GET' and path.startswith('/api/icons/')):
        return None
    if path.startswith(ADMIN_PREFIXES):
        return 'admin'
    if method in ('GET', 'HEAD') or (method, path) in USER_WRITE:
        return 'user'
    return 'admin'
