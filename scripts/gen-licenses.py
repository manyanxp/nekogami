#!/usr/bin/env python3
"""dashboard/ と web/ の package-lock.json から docs/licenses/third-party-npm.md を生成する。
使い方: python3 scripts/gen-licenses.py
"""
import collections
import datetime
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
APPS = [('dashboard', 'Agent Console のサーバー（Node.js）'), ('web', '画面（Next.js）')]


def load(app):
    lock = json.loads((root / app / 'package-lock.json').read_text(encoding='utf-8'))
    pkg = json.loads((root / app / 'package.json').read_text(encoding='utf-8'))
    direct = set(pkg.get('dependencies', {})) | set(pkg.get('devDependencies', {}))
    rows = []
    for key, v in lock['packages'].items():
        if not key:
            continue
        name = key.split('node_modules/')[-1]
        rows.append({
            'name': name, 'version': v.get('version', ''), 'license': str(v.get('license', '未記載')),
            'direct': key.count('node_modules/') == 1 and name in direct,
            'dev': bool(v.get('dev')), 'optional': bool(v.get('optional')),
        })
    rows.sort(key=lambda r: (not r['direct'], r['name']))
    return rows


def table(rows):
    return [
        '| パッケージ | バージョン | ライセンス | 種別 | 備考 |', '|---|---|---|---|---|',
        *[f"| {r['name']} | {r['version']} | {r['license']} | {'direct' if r['direct'] else 'transitive'} | {'optional（OS別バイナリ）' if r['optional'] else ''} |" for r in rows],
        '',
    ]


def summary(rows):
    cnt = collections.Counter(r['license'] for r in rows)
    return ['| ライセンス | 件数 |', '|---|---|', *[f'| {lic} | {n} |' for lic, n in cnt.most_common()], f'| **合計** | **{len(rows)}** |', '']


out = [
    '# npm 依存パッケージのライセンス一覧', '',
    f'> 自動生成: `python3 scripts/gen-licenses.py`（{datetime.date.today()} 時点の各 `package-lock.json`）。手で編集しない。', '',
]
for app, desc in APPS:
    rows = load(app)
    prod = [r for r in rows if not r['dev']]
    dev = [r for r in rows if r['dev']]
    out += [f'## {app}/ — {desc}', '', f'### 実行時の依存（{len(prod)} 件）', '', *summary(prod), *table(prod)]
    if dev:
        out += [f'### 開発・ビルド時のみ（{len(dev)} 件。配布物には含まれない）', '', *summary(dev), *table(dev)]
(root / 'docs' / 'licenses' / 'third-party-npm.md').write_text('\n'.join(out), encoding='utf-8')
print({app: len(load(app)) for app, _ in APPS})
