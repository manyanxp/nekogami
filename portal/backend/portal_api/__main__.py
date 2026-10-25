import argparse
import getpass
import sys

import uvicorn

from . import auth, config
from .app import create_app
from .registry import Forbidden, NotFound, ValidationError


def users_cli(argv):
    """ユーザー管理（コンテナ内: docker compose exec api python -m portal_api users add 名前 --role admin）"""
    ap = argparse.ArgumentParser(prog='portal_api users')
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('list')
    for name in ('add', 'passwd'):
        p = sub.add_parser(name)
        p.add_argument('username')
        if name == 'add':
            p.add_argument('--role', choices=auth.ROLES, default='user')
    for name in ('delete', 'disable', 'enable'):
        sub.add_parser(name).add_argument('username')
    a = ap.parse_args(argv)
    store = auth.UserStore(config.USERS_FILE)
    try:
        if a.cmd == 'list':
            for u in store.list():
                print(f"{u['username']}\t{u['role']}\t{'無効' if u.get('disabled') else '有効'}")
        elif a.cmd in ('add', 'passwd'):
            pw = getpass.getpass('パスワード: ')
            if pw != getpass.getpass('もう一度: '):
                sys.exit('一致しません')
            print(store.create(a.username, pw, a.role) if a.cmd == 'add' else store.update(a.username, password=pw))
        elif a.cmd == 'delete':
            store.delete(a.username)
        else:
            store.update(a.username, disabled=(a.cmd == 'disable'))
    except (ValidationError, Forbidden, NotFound) as e:
        sys.exit(f'エラー: {e}')


if __name__ == '__main__':
    if sys.argv[1:2] == ['users']:
        users_cli(sys.argv[2:])
        sys.exit(0)
    app = create_app()
    created = app.state.registry.sync_builtin(config.CONSOLE_URL)
    if config.AUTH_ENABLED:
        first = auth.bootstrap(app.state.users)
        if first:
            print('最初の管理者を作りました:', first)
        elif not app.state.users.count():
            print('ユーザーがいません。PORTAL_ADMIN_USER / PORTAL_ADMIN_PASSWORD を設定するか、python -m portal_api users add 名前 --role admin で作ってください')
    print(f'猫神さま Portal API: http://{config.HOST}:{config.PORT}  (login={"on" if config.AUTH_ENABLED else "off"}, token={"on" if config.TOKEN else "off"}, docker={config.DOCKER_ENABLED})')
    if created:
        print('registered builtin:', ', '.join(created))
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level='warning')
