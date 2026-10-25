"""猫神さま Portal API（FastAPI）。画面は web/（Next.js）が配信し、/api/* をここへ中継する。"""
import hmac
import json
import re
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import auth, chat, config, docker_ctl, icons, personality, theme
from .chat import CHAT_AGENT, MAX_CHAT_CHARS, ConsoleDown, chat_commands, expand_command, filter_chat_event
from .registry import Forbidden, NotFound, Registry, ValidationError

MAX_BODY = 128 * 1024   # プロンプト（最大 5 万文字）を送れるように
MAX_ICON_BODY = icons.MAX_UPLOAD + 1024
UUID_RE = re.compile(r'^[0-9a-f-]{36}$')
NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
LOCAL_HOSTS = ('127.0.0.1', 'localhost', '::1')
Body_ = Body(default_factory=dict)   # JSON オブジェクト（検証は台帳側）


class ChatRequest(BaseModel):
    message: str


def _hostname(hostport: str) -> str:
    """Host / Origin の `host:port` から、ホスト名だけを小文字で取り出す（[::1]:4400 も扱う）"""
    hostport = (hostport or '').strip().lower()
    if hostport.startswith('['):
        return hostport[1:hostport.index(']')] if ']' in hostport else hostport
    return hostport.split(':')[0]


def host_ok(host: str, origin: str | None, forwarded_host: str | None = None) -> bool:
    """DNS リバインディング対策: ローカルに待ち受けているときは、想定外の Host / Origin を拒否する。
    コンテナなどで 0.0.0.0 に待ち受けるときは、画面（Next.js）の中継が Host を書き換えるので、
    Origin がブラウザの見ているホスト（X-Forwarded-Host）と同じであることを確かめる"""
    if config.HOST in LOCAL_HOSTS:
        allowed = LOCAL_HOSTS + config.ALLOWED_HOSTS
        if _hostname(host) not in allowed:
            return False
        return not origin or _hostname(urlparse(origin).netloc) in allowed
    if not origin:
        return True
    origin_host = urlparse(origin).netloc
    return origin_host == host or bool(forwarded_host) and origin_host.lower() == forwarded_host.split(',')[0].strip().lower()


def _err(code: int, msg: str) -> JSONResponse:
    return JSONResponse({'error': msg}, status_code=code)


def get_registry(request: Request) -> Registry:
    return request.app.state.registry


def entity_id(id: str) -> str:
    if not UUID_RE.match(id):
        raise NotFound(id)
    return id


def delegation_name(name: str) -> str:
    if not NAME_RE.match(name):
        raise NotFound(name)
    return name


router = APIRouter(prefix='/api')


def _chat_user(request: Request) -> dict:
    """Agent Console に渡す利用者。会話は利用者ごとに分かれる。ログイン無効・トークン認証のときは渡さない（Agent Console 自身の会話）"""
    u = getattr(request.state, 'user', None)
    return {'user': u['username']} if u and u.get('id') != 'token' else {}


@router.get('/health')
def health():
    return {'ok': True, 'auth': config.AUTH_ENABLED, 'docker': config.DOCKER_ENABLED, 'console': config.CONSOLE_URL}


# ---- 台帳 ----
@router.get('/entities')
def list_entities(kind: str | None = None, q: str | None = None, reg: Registry = Depends(get_registry)):
    return {'items': reg.list(kind, q)}


@router.post('/entities', status_code=201)
def create_entity(body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    return reg.create(body)


@router.get('/entities/{id}')
def get_entity(id: str = Depends(entity_id), reg: Registry = Depends(get_registry)):
    return reg.get(id)


@router.patch('/entities/{id}')
def update_entity(id: str = Depends(entity_id), body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    return reg.update(id, body)


@router.delete('/entities/{id}')
def delete_entity(id: str = Depends(entity_id), cascade: str | None = Query(None), reg: Registry = Depends(get_registry)):
    return {'deleted': reg.delete(id, cascade=cascade == '1')}


@router.get('/entities/{id}/definition')
def get_definition(id: str = Depends(entity_id), reg: Registry = Depends(get_registry)):
    return reg.get_definition(id)


@router.put('/entities/{id}/prompt')
def put_prompt(id: str = Depends(entity_id), body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    prompt = body.get('prompt')
    if not isinstance(prompt, str):
        raise ValidationError('prompt（文字列）が必要')
    return reg.set_prompt(id, prompt)


@router.get('/entities/{id}/status')
def entity_status(id: str = Depends(entity_id), reg: Registry = Depends(get_registry)):
    rt = reg.get(id)['runtime']
    if rt['type'] != 'docker':
        return {'state': 'n/a', 'detail': f"runtime={rt['type']}"}
    return docker_ctl.status(rt, reg.project_dir)


def _docker_op(op: str, id: str, reg: Registry):
    e = reg.get(id)
    rt = e['runtime']
    if rt['type'] != 'docker':
        raise ValidationError('起動・停止は runtime.type=docker のみ')
    if op == 'start' and not e['enabled']:
        raise ValidationError('無効化されているため起動できない')
    (docker_ctl.start if op == 'start' else docker_ctl.stop)(rt, reg.project_dir)
    return docker_ctl.status(rt, reg.project_dir)


@router.post('/entities/{id}/start')
def entity_start(id: str = Depends(entity_id), reg: Registry = Depends(get_registry)):
    return _docker_op('start', id, reg)


@router.post('/entities/{id}/stop')
def entity_stop(id: str = Depends(entity_id), reg: Registry = Depends(get_registry)):
    return _docker_op('stop', id, reg)


@router.post('/agents', status_code=201)
def create_agent(body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    """Claude のエージェント定義ファイルを作って登録する（ADR 0016）"""
    return reg.create_claude(body)


@router.post('/sync-builtin')
def sync_builtin(reg: Registry = Depends(get_registry)):
    return {'created': reg.sync_builtin(config.CONSOLE_URL)}


# ---- ツール・管理 ----
@router.get('/tools')
def list_tools(reg: Registry = Depends(get_registry)):
    return {'items': reg.list_tools()}


@router.post('/tools', status_code=201)
def create_tool(body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    return reg.create_tool(body)


@router.patch('/tools/{id}')
def update_tool(id: str = Depends(entity_id), body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    return reg.update_tool(id, body)


@router.delete('/tools/{id}')
def delete_tool(id: str = Depends(entity_id), reg: Registry = Depends(get_registry)):
    reg.delete_tool(id)
    return {'deleted': id}


@router.get('/admin/overview')
def admin_overview(reg: Registry = Depends(get_registry)):
    return reg.admin_overview()


@router.get('/delegation')
def delegation_list(reg: Registry = Depends(get_registry)):
    return {'items': reg.delegation_list()}


@router.put('/delegation/{name}')
def delegation_put(name: str = Depends(delegation_name), body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    return reg.delegation_put(name, body)


@router.delete('/delegation/{name}')
def delegation_delete(name: str = Depends(delegation_name), reg: Registry = Depends(get_registry)):
    reg.delegation_delete(name)
    return {'deleted': name}


# ---- テーマ・性格 ----
@router.get('/theme')
def get_theme():
    return theme.read(config.THEME_FILE)


@router.put('/theme')
def put_theme(body: dict[str, Any] = Body_):
    try:
        return theme.write(config.THEME_FILE, body)
    except theme.ThemeError as e:
        raise ValidationError(str(e))


@router.get('/entities/{id}/personality')
def get_entity_personality(id: str = Depends(entity_id), reg: Registry = Depends(get_registry)):
    """サブオーケストレーターの性格・口調（定義の本文の「性格・話し方」の節）"""
    return reg.get_persona(id)


@router.put('/entities/{id}/personality')
def put_entity_personality(id: str = Depends(entity_id), body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    return reg.set_persona(id, body)


@router.get('/admin/personality')
def get_personality(reg: Registry = Depends(get_registry)):
    return personality.read(reg.project_dir)


@router.put('/admin/personality')
def put_personality(body: dict[str, Any] = Body_, reg: Registry = Depends(get_registry)):
    try:
        return personality.write(reg.project_dir, body, reg.defs)
    except personality.PersonalityError as e:
        raise ValidationError(str(e))


@router.post('/admin/personality')
def enable_personality_import(reg: Registry = Depends(get_registry)):
    """CLAUDE.md に @personality.md の取り込みを足す"""
    try:
        return personality.enable_import(reg.project_dir, reg.defs)
    except personality.PersonalityError as e:
        raise ValidationError(str(e))


# ---- アイコン（ADR 0032）----
@router.get('/icons')
def list_icons(reg: Registry = Depends(get_registry)):
    return reg.icons.listing()


@router.post('/icons', status_code=201)
async def upload_icon(request: Request, reg: Registry = Depends(get_registry)):
    """画像のバイト列そのものを本文で送る（multipart にしない）。種類は中身で判定する"""
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > icons.MAX_UPLOAD:
            raise ValidationError(f'画像は {icons.MAX_UPLOAD // 1024}KB まで')
    try:
        return {'icon': reg.icons.add(bytes(data))}
    except icons.IconError as e:
        raise ValidationError(str(e))


@router.get('/icons/{ref}')
def get_icon(ref: str, reg: Registry = Depends(get_registry)):
    p, mt = reg.icons.path(ref), reg.icons.media_type(ref)
    if p is None or mt is None:
        raise NotFound(ref)
    # 内容のハッシュが名前なので、長くキャッシュしてよい。画像以外として解釈されないようにする
    return FileResponse(p, media_type=mt, headers={'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox"})


@router.delete('/icons/{ref}')
def delete_icon(ref: str, reg: Registry = Depends(get_registry)):
    users = reg.icon_users(ref)
    if users:
        raise ValidationError(f'使われているため削除できない: {", ".join(users[:5])}')
    try:
        reg.icons.remove(ref)
    except icons.IconError as e:
        raise ValidationError(str(e))
    return {'deleted': ref}


# ---- 猫神さまとのチャット（Agent Console への中継）----
@router.post('/chat')
async def post_chat(req: ChatRequest, request: Request, reg: Registry = Depends(get_registry)):
    msg = req.message
    if not msg.strip():
        raise ValidationError('message が必要')
    if len(msg) > MAX_CHAT_CHARS:
        raise ValidationError(f'message は {MAX_CHAT_CHARS} 文字まで')
    msg = expand_command(reg, msg)       # /コマンドは、猫神さまへの指名つきの依頼にする
    status, data = await chat.console_post('/api/chat', {'message': msg.strip(), 'agent': CHAT_AGENT, **_chat_user(request)})
    return JSONResponse(data, status_code=status)


@router.post('/chat/stop')
async def stop_chat(request: Request):
    status, data = await chat.console_post('/api/stop', {'agent': CHAT_AGENT, **_chat_user(request)})
    return JSONResponse(data, status_code=status)


@router.post('/chat/reset')
async def reset_chat(request: Request):
    status, data = await chat.console_post('/api/reset', {'agent': CHAT_AGENT, **_chat_user(request)})
    return JSONResponse(data, status_code=status)


@router.get('/chat/commands')
def get_chat_commands(reg: Registry = Depends(get_registry)):
    return {'items': chat_commands(reg)}


@router.get('/chat/targets')
async def chat_targets():
    """Agent Console の「相手」の名前だけ（ダイアログで開けるかの判定用）"""
    d = await chat.console_get('/api/targets')
    return {'default': d.get('default'), 'items': [{'name': t.get('name'), 'label': t.get('label'), 'type': t.get('type')} for t in d.get('items', [])]}


@router.get('/chat/status')
async def chat_status(request: Request):
    """猫神さまが今、応答中か（自分の会話だけ）。画面が `idle` を受け損ねたときの照合用"""
    d = await chat.console_get('/api/targets')
    me = _chat_user(request).get('user')
    return {'running': any(m.get('target') == chat.CHAT_AGENT and m.get('user') == me for m in d.get('runningChats') or [])}


@router.get('/chat/stream')
async def chat_stream(request: Request):
    """Agent Console の SSE を、猫神さまとの自分のチャットだけに絞って中継する"""
    me = _chat_user(request).get('user')
    client, resp = await chat.open_events()

    async def gen():
        try:
            async for line in resp.aiter_lines():
                out = filter_chat_event(line, me)
                if out is not None:
                    yield (out + '\n\n').encode('utf-8')
        except Exception:  # noqa: BLE001  ブラウザが閉じた / 上流が切れた
            pass
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(gen(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


# ---- ログイン・ユーザー管理（ADR 0035）----
class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordRequest(BaseModel):
    current: str
    new: str


def _me(request: Request):
    u = getattr(request.state, 'user', None)
    return {'username': u['username'], 'role': u['role']} if u else None


def _set_cookie(request: Request, resp: Response, user: dict) -> None:
    secure = request.headers.get('x-forwarded-proto') == 'https'
    resp.set_cookie(auth.COOKIE, request.app.state.sessions.issue(user), max_age=config.SESSION_HOURS * 3600, httponly=True,
                    samesite='strict', secure=secure, path='/')


@router.get('/auth/me')
def auth_me(request: Request):
    users: auth.UserStore = request.app.state.users
    return {'authEnabled': config.AUTH_ENABLED, 'user': _me(request), 'setup': config.AUTH_ENABLED and users.count() == 0}


@router.post('/auth/login')
def auth_login(req: LoginRequest, request: Request):
    app = request.app
    name = req.username.strip().lower()
    if app.state.throttle.locked(name):
        return _err(429, 'ログインに続けて失敗したため、しばらく待ってからやり直してください')
    u = auth.authenticate(app.state.users, name, req.password)
    if u is None:
        app.state.throttle.fail(name)
        return _err(401, 'ユーザー名かパスワードが違う')
    app.state.throttle.ok(name)
    resp = JSONResponse({'user': {'username': u['username'], 'role': u['role']}})
    _set_cookie(request, resp, u)
    return resp


@router.post('/auth/logout')
def auth_logout():
    resp = JSONResponse({'ok': True})
    resp.delete_cookie(auth.COOKIE, path='/')
    return resp


@router.put('/auth/password')
def auth_password(req: PasswordRequest, request: Request):
    me = getattr(request.state, 'user', None)
    if not me or me.get('id') == 'token':
        raise ValidationError('ログインしている利用者だけが変更できる')
    users: auth.UserStore = request.app.state.users
    if auth.authenticate(users, me['username'], req.current) is None:
        return _err(401, '現在のパスワードが違う')
    users.update(me['username'], password=req.new)
    resp = JSONResponse({'ok': True})
    _set_cookie(request, resp, users.find(me['username']))   # 他のセッションは無効になる。この端末は入れ直しなし
    return resp


@router.get('/users')
def users_list(request: Request):
    return {'items': request.app.state.users.list()}


@router.post('/users', status_code=201)
def users_create(request: Request, body: dict[str, Any] = Body_):
    return request.app.state.users.create(body.get('username'), body.get('password'), body.get('role', 'user'))


@router.patch('/users/{username}')
def users_update(username: str, request: Request, body: dict[str, Any] = Body_):
    me = getattr(request.state, 'user', None) or {}
    if me.get('username') == username and (body.get('disabled') or body.get('role', 'admin') != 'admin'):
        raise Forbidden('自分自身を無効化・降格することはできない')
    return request.app.state.users.update(username, role=body.get('role'), disabled=body.get('disabled'), password=body.get('password'))


@router.delete('/users/{username}')
async def users_delete(username: str, request: Request):
    me = getattr(request.state, 'user', None) or {}
    if me.get('username') == username:
        raise Forbidden('自分自身は削除できない')
    request.app.state.users.delete(username)
    try:   # その人の会話も消す（応答中などで消せなければそのまま）
        await chat.console_post('/api/reset', {'user': username})
    except ConsoleDown:
        pass
    return {'deleted': username}


# ---- Agent Console の中継（管理者のみ。/console 画面用）----
@router.api_route('/console/{path:path}', methods=['GET', 'POST'])
async def console_proxy(path: str, request: Request):
    """Agent Console の /api/* を、ログイン済みの管理者にだけ中継する。会話は管理者自身（利用者なし）のもの"""
    import httpx
    url = config.CONSOLE_URL.rstrip('/') + '/api/' + path + (f'?{request.url.query}' if request.url.query else '')
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.request(request.method, url, content=await request.body() if request.method == 'POST' else None,
                                headers={'content-type': request.headers.get('content-type', 'application/json')})
    except httpx.HTTPError as e:
        raise chat._down(e)
    return Response(r.content, status_code=r.status_code, media_type=r.headers.get('content-type'))


@router.get('/console-events')
async def console_events():
    """Agent Console の SSE（トレースと管理者自身の会話）。利用者ごとの会話は流さない"""
    client, resp = await chat.open_events()

    async def gen():
        try:
            async for line in resp.aiter_lines():
                if line.startswith('data:'):
                    try:
                        ev = json.loads(line[5:])
                    except ValueError:
                        continue
                    if ev.get('user') or ev.get('chatUser'):
                        continue
                    if ev.get('kind') == 'hello':
                        ev['runningChats'] = [m for m in ev.get('runningChats') or [] if not m.get('user')]
                        ev['runningTargets'] = [m['target'] for m in ev['runningChats']]
                        line = 'data: ' + json.dumps(ev, ensure_ascii=False)
                yield (line + '\n').encode('utf-8')
        except Exception:  # noqa: BLE001
            pass
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(gen(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


def create_app(registry: Registry | None = None, users: auth.UserStore | None = None) -> FastAPI:
    app = FastAPI(title='猫神さま Portal API', version='1.0.0', docs_url=None, redoc_url=None, openapi_url='/api/openapi.json')
    app.state.registry = registry or Registry(config.DATA_FILE, config.PROJECT_DIR)
    app.state.users = users or auth.UserStore(config.USERS_FILE)
    app.state.sessions = auth.Sessions.load()
    app.state.throttle = auth.Throttle()
    app.include_router(router)

    def _principal(request: Request):
        """ログイン中の利用者。Cookie のセッション、または PORTAL_TOKEN の Bearer（スクリプト用。管理者扱い）"""
        u = app.state.sessions.user_of(request.cookies.get(auth.COOKIE), app.state.users)
        if u:
            return u
        got = (request.headers.get('authorization') or '').removeprefix('Bearer ').strip()
        if config.TOKEN and got and hmac.compare_digest(got, config.TOKEN):
            return {'id': 'token', 'username': '(token)', 'role': 'admin'}
        return None

    @app.middleware('http')
    async def guard(request: Request, call_next):
        if not host_ok(request.headers.get('host', ''), request.headers.get('origin'), request.headers.get('x-forwarded-host')):
            return _err(403, 'forbidden host')
        path = request.url.path
        if path.startswith('/api/'):
            need = auth.required_role(request.method, path) if config.AUTH_ENABLED else None
            request.state.user = None
            if need is not None or path.startswith('/api/auth/'):
                request.state.user = _principal(request)
            if need is not None:
                u = request.state.user
                if u is None:
                    return _err(401, 'ログインが必要')
                if need == 'admin' and u['role'] != 'admin':
                    return _err(403, '管理者だけが行える操作')
            if path != '/api/health':
                limit = MAX_ICON_BODY if (request.method == 'POST' and path == '/api/icons') else MAX_BODY
                if int(request.headers.get('content-length') or 0) > limit:
                    return _err(400, 'リクエストが大きすぎる')
        resp = await call_next(request)
        resp.headers['X-Content-Type-Options'] = 'nosniff'
        resp.headers.setdefault('Cache-Control', 'no-store')
        return resp

    for exc, code in ((ValidationError, 400), (Forbidden, 403), (NotFound, 404), (ConsoleDown, 502), (docker_ctl.DockerError, 502)):
        def handler(request, e, code=code):
            return _err(code, 'not found' if code == 404 else str(e))
        app.add_exception_handler(exc, handler)

    @app.exception_handler(RequestValidationError)
    async def bad_request(request, e):
        return _err(400, 'リクエストが不正（JSON オブジェクトと、必要な項目を送る）')

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, e):
        return _err(e.status_code, 'not found' if e.status_code == 404 else str(e.detail))

    @app.exception_handler(Exception)
    async def unexpected(request, e):
        return _err(500, f'{type(e).__name__}: {e}')

    return app
