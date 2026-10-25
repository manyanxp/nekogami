import http.server
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from portal_api import auth, chat, config
from portal_api.app import create_app
from portal_api.registry import Forbidden, NotFound, Registry, ValidationError

config.AUTH_ENABLED = False   # 既存のテストはログインなしで呼ぶ。ログインのテストは AuthTest で有効にする


def make_call(reg):
    """API を、プロセス内（TestClient）で呼ぶ。(ステータス, JSON) を返す"""
    client = TestClient(create_app(reg), base_url='http://127.0.0.1', raise_server_exceptions=False)

    def call(method, path, body=None, headers=None):
        r = client.request(method, path, json=body, headers=headers)
        return r.status_code, (r.json() if r.content and 'json' in r.headers.get('content-type', '') else None)
    call.client = client
    return call


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        (self.root / '.claude' / 'agents').mkdir(parents=True)
        (self.root / '.claude' / 'agents' / 'x.md').write_text('---\nname: azure-x\nmodel: haiku\ndescription: テスト\ntools: mcp__microsoft-learn__docs_search, WebSearch, Read, Unknown\n---\nbody')
        (self.root / '.mcp.json').write_text(json.dumps({'mcpServers': {'microsoft-learn': {}}}))
        (self.root / 'agents').mkdir()
        (self.root / 'agents' / 'c.yml').write_text('services: {}')
        self.reg = Registry(self.root / 'data.json', self.root)

    def tearDown(self):
        self.tmp.cleanup()


class RegistryTest(Base):
    def test_hierarchy_and_uuid(self):
        o = self.reg.create({'kind': 'orchestrator', 'name': 'o1'})
        a = self.reg.create({'kind': 'agent', 'name': 'a1', 'parent_id': o['id']})
        s = self.reg.create({'kind': 'subagent', 'name': 's1', 'parent_id': a['id']})
        self.assertEqual(len({o['id'], a['id'], s['id']}), 3)
        with self.assertRaises(ValidationError):
            self.reg.create({'kind': 'agent', 'name': 'bad', 'parent_id': s['id']})
        with self.assertRaises(ValidationError):
            self.reg.create({'kind': 'orchestrator', 'name': 'o1'})  # 重複
        with self.assertRaises(ValidationError):
            self.reg.delete(o['id'])  # 子あり
        self.assertEqual(len(self.reg.delete(o['id'], cascade=True)), 3)

    def test_persist_and_sync_idempotent(self):
        self.assertEqual(self.reg.sync_builtin('http://x'), ['nekogamisama', 'azure-sage', 'azure-x'])
        self.assertEqual(self.reg.sync_builtin('http://x'), [])
        self.assertEqual(len(Registry(self.root / 'data.json', self.root).list()), 3)

    def test_nekogamisama_tree(self):
        self.reg.sync_builtin('http://x')
        by = {e['name']: e for e in self.reg.list()}
        self.assertEqual(by['nekogamisama']['kind'], 'orchestrator')
        self.assertIsNone(by['nekogamisama']['parent_id'])
        self.assertEqual((by['azure-sage']['kind'], by['azure-sage']['parent_id']), ('suborchestrator', by['nekogamisama']['id']))
        self.assertEqual(by['azure-x']['parent_id'], by['azure-sage']['id'])
        # suborchestrator は orchestrator 直下のみ
        with self.assertRaises(ValidationError):
            self.reg.create({'kind': 'suborchestrator', 'name': 'no-parent'})
        with self.assertRaises(ValidationError):
            self.reg.create({'kind': 'suborchestrator', 'name': 'nested', 'parent_id': by['azure-sage']['id']})
        # 他のエージェントも猫神さま配下に置ける
        self.reg.create({'kind': 'agent', 'name': 'cat-helper', 'parent_id': by['nekogamisama']['id']})

    def test_migrate_phase1_registry(self):
        import uuid
        from portal_api.registry import SEED_NS
        old_id = str(uuid.uuid5(SEED_NS, 'orchestrator:azure-sage'))
        legacy = {'id': old_id, 'kind': 'orchestrator', 'name': 'azure-sage', 'parent_id': None, 'description': '', 'model': 'sonnet',
                  'enabled': True, 'tags': ['builtin'], 'runtime': {'type': 'builtin', 'url': ''}, 'created_at': 'x', 'updated_at': 'x'}
        (self.root / 'legacy.json').write_text(json.dumps({'version': 1, 'entities': [legacy]}))
        reg = Registry(self.root / 'legacy.json', self.root)
        self.assertEqual(reg.sync_builtin('http://x'), ['nekogamisama', 'azure-sage (migrated)', 'azure-x'])
        e = reg.get(old_id)  # ID は変わらない
        self.assertEqual(e['kind'], 'suborchestrator')
        self.assertEqual(reg.get(e['parent_id'])['name'], 'nekogamisama')
        self.assertEqual(reg.sync_builtin('http://x'), [])

    def test_admin_is_protected(self):
        self.reg.sync_builtin('http://x')
        neko = next(e for e in self.reg.list() if e['name'] == 'nekogamisama')
        self.assertTrue(neko['protected'])
        with self.assertRaises(Forbidden):
            self.reg.delete(neko['id'])
        with self.assertRaises(Forbidden):
            self.reg.delete(neko['id'], cascade=True)  # 子ごとでも不可
        self.assertEqual(len(self.reg.list()), 3)      # 何も消えていない
        with self.assertRaises(Forbidden):
            self.reg.update(neko['id'], {'enabled': False})
        with self.assertRaises(Forbidden):
            self.reg.update(neko['id'], {'name': 'other'})
        with self.assertRaises(ValidationError):  # protected はクライアントから変えられない
            self.reg.update(neko['id'], {'protected': False, 'kind': 'agent'})
        self.assertTrue(self.reg.update(neko['id'], {'description': 'd', 'protected': False})['protected'])
        self.assertTrue(self.reg.create({'kind': 'agent', 'name': 'a', 'parent_id': neko['id'], 'protected': True})['protected'] is False)

    def test_tools_and_connections(self):
        self.reg.sync_builtin('http://x')
        tools = {t['name']: t for t in self.reg.list_tools()}
        self.assertIn('microsoft-learn', tools); self.assertEqual(tools['microsoft-learn']['kind'], 'mcp')
        x = next(e for e in self.reg.list() if e['name'] == 'azure-x')
        # frontmatter の tools から初期接続（未知のツールは無視）
        self.assertEqual(set(x['tool_ids']), {tools['microsoft-learn']['id'], tools['WebSearch']['id'], tools['Read']['id']})
        mine = self.reg.create_tool({'name': 'my-tool'})
        self.assertEqual(mine['kind'], 'custom')
        with self.assertRaises(ValidationError):
            self.reg.create_tool({'name': 'my-tool'})
        e = self.reg.update(x['id'], {'tool_ids': x['tool_ids'] + [mine['id'], mine['id']]})
        self.assertEqual(e['tool_ids'].count(mine['id']), 1)
        with self.assertRaises(ValidationError):
            self.reg.update(x['id'], {'tool_ids': ['00000000-0000-0000-0000-000000000000']})
        self.reg.delete_tool(mine['id'])  # 接続も外れる
        self.assertNotIn(mine['id'], self.reg.get(x['id'])['tool_ids'])
        self.reg.sync_builtin('http://x')  # 冪等で、利用者が外した接続を復活させない
        self.reg.update(x['id'], {'tool_ids': []})
        self.reg.sync_builtin('http://x')
        self.assertEqual(self.reg.get(x['id'])['tool_ids'], [])

    def test_pos_validation(self):
        o = self.reg.create({'kind': 'orchestrator', 'name': 'o', 'pos': {'x': 10, 'y': 20.55}})
        self.assertEqual(o['pos'], {'x': 10.0, 'y': 20.6})
        for bad in ({'x': 'a', 'y': 1}, {'x': 1}, {'x': float('nan'), 'y': 0}, {'x': 1e9, 'y': 0}, 5):
            with self.assertRaises(ValidationError):
                self.reg.update(o['id'], {'pos': bad})

    def test_migrate_phase2_registry(self):
        import uuid
        from portal_api.registry import SEED_NS
        ids = {n: str(uuid.uuid5(SEED_NS, k)) for n, k in (('neko', 'orchestrator:nekogamisama'), ('sage', 'orchestrator:azure-sage'), ('x', 'subagent:azure-x'))}
        base = {'description': '', 'model': '', 'enabled': True, 'tags': ['builtin'], 'runtime': {'type': 'builtin', 'url': ''}, 'created_at': 'x', 'updated_at': 'x'}
        ents = [{**base, 'id': ids['neko'], 'kind': 'orchestrator', 'name': 'nekogamisama', 'parent_id': None},
                {**base, 'id': ids['sage'], 'kind': 'suborchestrator', 'name': 'azure-sage', 'parent_id': ids['neko']},
                {**base, 'id': ids['x'], 'kind': 'subagent', 'name': 'azure-x', 'parent_id': ids['sage']}]
        (self.root / 'p2.json').write_text(json.dumps({'version': 1, 'entities': ents}))
        reg = Registry(self.root / 'p2.json', self.root)
        self.assertEqual(reg.sync_builtin('http://x'), [])
        self.assertTrue(reg.get(ids['neko'])['protected'])
        self.assertEqual(len(reg.get(ids['x'])['tool_ids']), 3)
        with self.assertRaises(Forbidden):
            reg.delete(ids['neko'], cascade=True)
        self.assertEqual(json.loads((self.root / 'p2.json').read_text())['version'], 2)

    def _agent_text(self, rel):
        return (self.root / rel).read_text(encoding='utf-8')

    def test_edit_writes_definition_file(self):
        self.reg.sync_builtin('http://x')
        x = next(e for e in self.reg.list() if e['name'] == 'azure-x')
        rel = x['definition']['path']
        self.assertEqual(rel, '.claude/agents/x.md')
        before = self._agent_text(rel)
        tools = {t['name']: t for t in self.reg.list_tools()}
        # モデル・説明・ツールの変更がファイルに入る。ほかの行（effort など）と本文は変わらない
        e = self.reg.update(x['id'], {'model': 'opus', 'description': 'こんな: 説明 # です', 'tool_ids': [tools['Read']['id'], tools['microsoft-learn']['id']]})
        text = self._agent_text(rel)
        self.assertIn('model: opus', text)
        self.assertIn('description: "こんな: 説明 # です"', text)       # YAML として壊れないよう引用符で囲む
        self.assertIn('tools: mcp__microsoft-learn__docs_search, Read, Unknown', text)  # 残る項目は元の順・元の書き方のまま。グラフにないツール（Unknown）も残す
        self.assertNotIn('WebSearch', text)
        self.assertTrue(text.endswith('---\nbody'))   # 本文は変わらない
        self.assertEqual(self.reg.get_definition(x['id'])['tools_other'], ['Unknown'])
        self.assertEqual(len(list((self.root / 'backups').glob('*'))), 1)   # 書き換え前の退避（データフォルダ = 台帳と同じ場所）
        # 同期で台帳がファイルの内容に戻る（ファイルが正）
        self.reg.sync_builtin('http://x')
        self.assertEqual(self.reg.get(x['id'])['model'], 'opus')
        self.assertNotEqual(before, text)

    def test_dangerous_tools_need_confirmation(self):
        self.reg.sync_builtin('http://x')
        x = next(e for e in self.reg.list() if e['name'] == 'azure-x')
        tools = {t['name']: t for t in self.reg.list_tools()}
        ids = x['tool_ids'] + [tools['Bash']['id']]
        with self.assertRaises(ValidationError):
            self.reg.update(x['id'], {'tool_ids': ids})
        self.assertNotIn('Bash', self._agent_text('.claude/agents/x.md'))          # 失敗したらファイルも台帳も変わらない
        self.assertNotIn(tools['Bash']['id'], self.reg.get(x['id'])['tool_ids'])
        self.reg.update(x['id'], {'tool_ids': ids, 'allow_dangerous': True})
        self.assertIn('Bash', self._agent_text('.claude/agents/x.md'))

    def test_directory_nodes(self):
        """ディレクトリのノード: 場所の検証、権限（既定はすべてオフ）、担当への接続は定義ファイルの tools に反映（ADR 0037）"""
        self.reg.sync_builtin('http://x')
        x = next(e for e in self.reg.list() if e['name'] == 'azure-x')
        d = self.reg.create_tool({'name': 'docs', 'kind': 'directory', 'path': 'notes/docs/'})
        self.assertEqual((d['path'], d['perms']), ('notes/docs', {'list': False, 'read': False, 'write': False, 'delete': False, 'exec': False}))
        for bad in ('', '..', '../x', '/etc', 'a/../b', '.hidden', 'a//b', 'a b', 'x' * 65, '/'.join(['a'] * 9), None, 5):
            with self.assertRaises(ValidationError, msg=repr(bad)):
                self.reg.create_tool({'name': 'bad', 'kind': 'directory', 'path': bad})
        with self.assertRaises(ValidationError):
            self.reg.create_tool({'name': 'bad2', 'kind': 'directory', 'path': 'a', 'perms': {'sudo': True}})
        for bad_name in ('my.docs', 'my_docs', 'a__b'):   # MCP のサーバー名にする。記号は不可
            with self.assertRaises(ValidationError, msg=bad_name):
                self.reg.create_tool({'name': bad_name, 'kind': 'directory', 'path': 'a'})
        with self.assertRaises(ValidationError):
            self.reg.update_tool(next(t['id'] for t in self.reg.list_tools() if t['name'] == 'Read'), {'path': 'a'})   # 他の種類は不可
        # 参照・読み込みだけなら確認なしで接続でき、定義ファイルの tools に mcp__dir-docs__* が入る
        self.reg.update_tool(d['id'], {'perms': {'list': True, 'read': True}})
        self.reg.update(x['id'], {'tool_ids': x['tool_ids'] + [d['id']]})
        self.assertIn('mcp__dir-docs__*', self._agent_text('.claude/agents/x.md'))
        self.assertIn(d['id'], self.reg.get(x['id'])['tool_ids'])
        # 書き込み・削除つきのディレクトリを新しく足すには確認が要る。失敗したらファイルも台帳も変わらない
        w = self.reg.create_tool({'name': 'out', 'kind': 'directory', 'path': 'out', 'perms': {'write': True}})
        ids = self.reg.get(x['id'])['tool_ids'] + [w['id']]
        with self.assertRaises(ValidationError):
            self.reg.update(x['id'], {'tool_ids': ids})
        self.assertNotIn('dir-out', self._agent_text('.claude/agents/x.md'))
        self.reg.update(x['id'], {'tool_ids': ids, 'allow_dangerous': True})
        self.assertIn('mcp__dir-out__*', self._agent_text('.claude/agents/x.md'))
        # Python 実行（exec）も、書き込み・削除と同じく確認が要る
        e = self.reg.create_tool({'name': 'calc', 'kind': 'directory', 'path': 'calc', 'perms': {'read': True, 'exec': True}})
        with self.assertRaises(ValidationError):
            self.reg.update(x['id'], {'tool_ids': ids + [e['id']]})
        self.reg.delete_tool(e['id'])
        # 台帳に戻しても、ディレクトリのノードとの対応が保たれる（再取り込み）
        self.reg.sync_builtin('http://x')
        self.assertEqual(set(self.reg.get(x['id'])['tool_ids']) >= {d['id'], w['id']}, True)
        # ノードを消すと、担当との接続も外れる
        self.reg.delete_tool(d['id'])
        self.assertNotIn(d['id'], self.reg.get(x['id'])['tool_ids'])
        self.assertNotIn('dir-docs', self._agent_text('.claude/agents/x.md'))   # 定義ファイルからも外れる
        # 同じ名前で作り直しても、確認なしでつながったりしない
        again = self.reg.create_tool({'name': 'docs', 'kind': 'directory', 'path': 'other', 'perms': {'write': True}})
        self.assertNotIn(again['id'], self.reg.get(x['id'])['tool_ids'])
        self.assertNotIn('dir-docs', self._agent_text('.claude/agents/x.md'))
        self.assertIn('mcp__dir-out__*', self._agent_text('.claude/agents/x.md'))   # 他のノードの接続は残る

    def test_llm_nodes(self):
        self.reg.sync_builtin('http://x')
        x = next(e for e in self.reg.list() if e['name'] == 'azure-x')   # 定義ファイル（x.md）のある担当
        node = self.reg.create_tool({'name': 'local-qwen', 'kind': 'llm', 'model': 'qwen3:8b', 'prompt': '短く答える'})
        self.assertEqual((node['model'], node['prompt'], node['temperature'], node['max_tokens']), ('qwen3:8b', '短く答える', 0.7, 1024))
        for bad in ({'model': ''}, {'model': 'a b'}, {'model': 'x;y'}, {'model': 'm', 'temperature': 3}, {'model': 'm', 'temperature': True},
                    {'model': 'm', 'max_tokens': 8}, {'model': 'm', 'max_tokens': 99999}, {'model': 'm', 'max_tokens': 1.5}, {'model': 'm', 'prompt': 'x' * 8001}, {'model': 'm', 'prompt': 5}):
            with self.assertRaises(ValidationError, msg=str(bad)):
                self.reg.create_tool({'name': 'bad-llm', 'kind': 'llm', **bad})
        with self.assertRaises(ValidationError):
            self.reg.create_tool({'name': 'my.llm', 'kind': 'llm', 'model': 'm'})        # MCP のサーバー名にするので記号は不可
        # 編集: 指定した項目だけが変わる
        n2 = self.reg.update_tool(node['id'], {'prompt': '丁寧に', 'temperature': 0.2})
        self.assertEqual((n2['model'], n2['prompt'], n2['temperature'], n2['max_tokens']), ('qwen3:8b', '丁寧に', 0.2, 1024))
        with self.assertRaises(ValidationError):
            self.reg.update_tool(node['id'], {'model': 'bad model'})
        with self.assertRaises(ValidationError):
            self.reg.update_tool(next(t['id'] for t in self.reg.list_tools() if t['name'] == 'Read'), {'prompt': 'x'})      # 他の種類は不可
        # 接続: 確認なしで、定義ファイルに mcp__llm-<名前>__* が入る
        self.reg.update(x['id'], {'tool_ids': x['tool_ids'] + [node['id']]})
        self.assertIn('mcp__llm-local-qwen__*', self._agent_text('.claude/agents/x.md'))
        # 定義ファイルのない担当（猫神さま）には、つなげない
        neko = next(e for e in self.reg.list() if e['kind'] == 'orchestrator')
        with self.assertRaises(ValidationError):
            self.reg.update(neko['id'], {'tool_ids': [node['id']]})
        # 再取り込みでも保たれ、ノードを消すと定義ファイルからも外れる
        self.reg.sync_builtin('http://x')
        self.assertIn(node['id'], self.reg.get(x['id'])['tool_ids'])
        self.reg.delete_tool(node['id'])
        self.assertNotIn('llm-local-qwen', self._agent_text('.claude/agents/x.md'))

    def test_python_node_body_style(self):
        """処理だけを書く Python ノード: 入力ノードをつなぐと、引数が自動で決まり、関数が自動生成される（ADR 0045）"""
        py = self.reg.create_tool({'name': 'calc2', 'kind': 'python', 'code': 'return a * 2'})
        self.assertEqual((py['style'], py['params']), ('body', []))
        with self.assertRaises(ValidationError):
            self.reg.create_tool({'name': 'empty', 'kind': 'python', 'code': '  \n'})
        with self.assertRaises(ValidationError):
            self.reg.create_tool({'name': 'syn', 'kind': 'python', 'code': 'return ('})
        a = self.reg.create_tool({'name': 'in-a', 'kind': 'input', 'param': 'a', 'dtype': 'int', 'value': '21'})
        b = self.reg.create_tool({'name': 'in-b', 'kind': 'input', 'param': 'b', 'dtype': 'list', 'value': '[1, 2]'})
        # 関数の引数を持たなくても、つなげる。つなぐと引数と関数が自動で決まる
        self.reg.update_tool(py['id'], {'input_ids': [a['id'], b['id']]})
        got = next(t for t in self.reg.list_tools() if t['id'] == py['id'])
        self.assertEqual([(p['name'], p['type'], p['default']) for p in got['params']], [('a', 'int', 21), ('b', 'list', [1, 2])])
        self.assertEqual(got['source'], 'def main(a: int, b: list):\n    return a * 2\n')
        # 入力ノードの値・型を変えると、つなぎ先の引数も変わる
        self.reg.update_tool(a['id'], {'dtype': 'float', 'value': '1.5'})
        got = next(t for t in self.reg.list_tools() if t['id'] == py['id'])
        self.assertEqual((got['params'][0]['type'], got['params'][0]['default']), ('float', 1.5))
        self.assertIn('def main(a: float, b: list)', got['source'])
        # 処理を書き換えても、引数は入力ノードのまま。引数名の重複・予約語は断る
        self.reg.update_tool(py['id'], {'code': 'x = a + len(b)\nreturn x'})
        self.assertIn('    x = a + len(b)\n    return x\n', next(t for t in self.reg.list_tools() if t['id'] == py['id'])['source'])
        dup = self.reg.create_tool({'name': 'in-a2', 'kind': 'input', 'param': 'a', 'dtype': 'int', 'value': '1'})
        with self.assertRaises(ValidationError):
            self.reg.update_tool(py['id'], {'input_ids': [a['id'], b['id'], dup['id']]})
        kw = self.reg.create_tool({'name': 'in-kw', 'kind': 'input', 'param': 'class', 'dtype': 'int', 'value': '1'})
        with self.assertRaises(ValidationError):
            self.reg.update_tool(py['id'], {'input_ids': [kw['id']]})
        # 入力ノードを消すと、引数も消える
        self.reg.delete_tool(b['id'])
        got = next(t for t in self.reg.list_tools() if t['id'] == py['id'])
        self.assertEqual([p['name'] for p in got['params']], ['a'])
        self.assertIn('def main(a: float):', got['source'])

    def test_stale_delegation_is_hidden_and_pruned(self):
        """管理ページで消して定義ファイルがなくなった委任先は、一覧から外れる。別名の項目（news-sub → news-agent）も（ADR 0048）"""
        self.reg.sync_builtin('http://x')
        f = self.root / 'nekogamisama' / 'suborchestrators.json'
        f.parent.mkdir(exist_ok=True)
        neko = next(e for e in self.reg.list() if e['kind'] == 'orchestrator')
        ag = self.reg.create_claude({'kind': 'agent', 'name': 'st-agent', 'parent_id': neko['id']})
        f.write_text(json.dumps({'st-alias': {'type': 'agent', 'agent': 'st-agent', 'description': 'x'},
                                 'st-ghost': {'type': 'agent', 'agent': 'st-never', 'description': 'y'},
                                 'st-local': {'type': 'session', 'dir': 'st-local', 'description': 'z'}}))
        names = [r['name'] for r in self.reg.admin_overview()['delegation']]
        self.assertIn('st-alias', names)
        self.assertNotIn('st-ghost', names)          # 呼び先の定義がない項目は、画面に出さない
        self.assertIn('st-local', names)             # session 型は触らない
        self.assertEqual(self.reg.prune_delegation(), ['st-ghost'])
        self.assertEqual(sorted(json.loads(f.read_text())), ['st-alias', 'st-local'])
        self.reg.delete(ag['id'])                    # 呼び先を消すと、別名の項目も外れる
        self.assertEqual(sorted(json.loads(f.read_text())), ['st-local'])

    def test_shared_principles(self):
        """サブオーケストレーターの Shared Principles。使う子の定義へ、直下の子だけ自動生成する（ADR 0047）"""
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text('{}')
        neko = next(e for e in self.reg.list() if e['kind'] == 'orchestrator')
        sub = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'sh-sub', 'parent_id': neko['id']})
        a1 = self.reg.create_claude({'kind': 'agent', 'name': 'sh-a1', 'parent_id': sub['id']})
        a2 = self.reg.create_claude({'kind': 'agent', 'name': 'sh-a2', 'parent_id': sub['id']})
        grand = self.reg.create_claude({'kind': 'subagent', 'name': 'sh-g', 'parent_id': a1['id']})
        g = self.reg.get_shared(sub['id'])
        self.assertEqual((g['text'], [(c['name'], c['use'], c['eligible']) for c in g['children']]), ('', [('sh-a1', False, True), ('sh-a2', False, True)]))
        self.reg.set_shared(sub['id'], '- 日本語で答える\n- 出典を付ける')
        self.assertNotIn('Shared Principles', self.reg.get_definition(a1['id'])['prompt'])   # 使うと決めるまで、渡さない
        r = self.reg.set_use_shared(a1['id'], True)
        self.assertTrue(r['as_child']['use'])
        p = self.reg.get_definition(a1['id'])['prompt']
        self.assertIn('## Shared Principles', p)
        self.assertIn('- 出典を付ける', p)
        self.assertEqual(p.count('## Shared Principles'), 1)
        self.assertNotIn('Shared Principles', self.reg.get_definition(a2['id'])['prompt'])    # チェックしていない子には渡さない
        self.assertNotIn('Shared Principles', self.reg.get_definition(grand['id'])['prompt'])  # 孫には渡さない
        # 親の本文を変えると、使っている子の節が追従する
        self.reg.set_shared(sub['id'], '- 簡潔に')
        p = self.reg.get_definition(a1['id'])['prompt']
        self.assertIn('- 簡潔に', p)
        self.assertNotIn('出典を付ける', p)
        # 外すと節が消え、元のプロンプトは残る
        self.reg.set_use_shared(a1['id'], False)
        self.assertNotIn('Shared Principles', self.reg.get_definition(a1['id'])['prompt'])
        self.assertIn('あなたは', self.reg.get_definition(a1['id'])['prompt'])
        # 付け替えで、新しい親がサブオーケストレーターでなければ節が外れる
        self.reg.set_use_shared(a1['id'], True)
        self.reg.update(a1['id'], {'parent_id': neko['id']})
        self.assertNotIn('Shared Principles', self.reg.get_definition(a1['id'])['prompt'])
        # 検査: 見出し・長さ・サブオーケストレーター以外・猫神さまの直下は不可
        for bad in ('# 見出し', 'あ' * 4001):
            with self.assertRaises(ValidationError):
                self.reg.set_shared(sub['id'], bad)
        with self.assertRaises(ValidationError):
            self.reg.set_shared(a2['id'], 'x')
        with self.assertRaises(ValidationError):
            self.reg.set_use_shared(a1['id'], True)
        # 名前の変更でフォルダが付いてくる
        self.reg.update(sub['id'], {'name': 'sh-sub2'})
        self.assertEqual(self.reg.get_shared(sub['id'])['text'], '- 簡潔に')

    def test_suborchestrator_personality(self):
        """サブオーケストレーターの性格・口調は、定義の本文の「性格・話し方」の節に書く（ADR 0044）"""
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text('{}')
        neko = next(e for e in self.reg.list() if e['kind'] == 'orchestrator')
        sub = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'ps-sub', 'parent_id': neko['id'], 'prompt': '# 役割\n調べる。\n\n## 守ること\n- 事実を書く\n'})
        ag = self.reg.create_claude({'kind': 'agent', 'name': 'ps-ag', 'parent_id': neko['id']})
        self.assertFalse(self.reg.get_persona(sub['id'])['exists'])
        r = self.reg.set_persona(sub['id'], {'first_person': 'わし', 'address': '小僧', 'tone': '〜じゃ', 'traits': '落ち着いている'})
        self.assertEqual((r['exists'], r['first_person'], r['address'], r['tone'], r['traits']), (True, 'わし', '小僧', '〜じゃ', '落ち着いている'))
        text = self.reg.get_definition(sub['id'])['prompt']
        self.assertIn('## 性格・話し方', text)
        self.assertIn('## 守ること', text)                                    # ほかの節は残る
        self.reg.set_persona(sub['id'], {'first_person': 'ぼく', 'address': 'きみ', 'tone': 'です', 'traits': ''})
        self.assertEqual(self.reg.get_definition(sub['id'])['prompt'].count('## 性格'), 1)   # 置き換えで、節は増えない
        self.assertEqual(self.reg.get_persona(sub['id'])['first_person'], 'ぼく')
        # personality.md が正（ADR 0046）: 保存でファイルができ、定義の節は自動生成になる。ファイルを手で直すと、同期で節に反映される
        pf = self.root / 'nekogamisama' / 'personalities' / 'ps-sub' / 'personality.md'
        self.assertIn('- 一人称: ぼく', pf.read_text(encoding='utf-8'))
        self.assertIn('自動生成', self.reg.get_definition(sub['id'])['prompt'])
        pf.write_text(pf.read_text(encoding='utf-8').replace('ぼく', 'おれ'), encoding='utf-8')
        self.assertEqual(self.reg.get_persona(sub['id'])['first_person'], 'おれ')
        self.assertIn('- 一人称: おれ', self.reg.get_definition(sub['id'])['prompt'])
        pf.write_text(pf.read_text(encoding='utf-8').replace('おれ', 'わが'), encoding='utf-8')
        self.reg.sync_personas()   # 起動時の同期
        self.assertIn('- 一人称: わが', self.reg.get_definition(sub['id'])['prompt'])
        # 名前の変更でフォルダが付いてくる。削除で退避される
        self.reg.update(sub['id'], {'name': 'ps-sub2'})
        self.assertFalse(pf.parent.exists())
        self.assertEqual(self.reg.get_persona(sub['id'])['first_person'], 'わが')
        # ファイルがないものは、手で書いた「## 性格」の箇条書きを性格の文章として読む。保存するとファイルができ、節は置き換わる
        hand = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'ps-hand', 'parent_id': neko['id']})
        self.reg.set_prompt(hand['id'], '# 役割\nx\n\n## 性格\n- 長女\n- 緑茶が好き\n')
        p = self.reg.get_persona(hand['id'])
        self.assertTrue(p['exists'] and not p['file'])
        self.assertIn('緑茶が好き', p['traits'])
        self.reg.set_persona(hand['id'], {**p})
        self.assertIn('緑茶が好き', self.reg.get_definition(hand['id'])['prompt'])
        self.assertEqual(self.reg.get_definition(hand['id'])['prompt'].count('## 性格'), 1)
        self.assertTrue(self.reg.get_persona(hand['id'])['file'])
        self.reg.delete(hand['id'])
        self.assertFalse((self.root / 'nekogamisama' / 'personalities' / 'ps-hand').exists())
        for bad in ({'tone': ''}, {'traits': '# 見出し'}, {'first_person': 'あ' * 17}):
            with self.assertRaises(ValidationError):
                self.reg.set_persona(sub['id'], {'first_person': 'わし', 'address': '小僧', 'tone': 'です', 'traits': '', **bad})
        with self.assertRaises(ValidationError):
            self.reg.set_persona(ag['id'], {})                                 # サブオーケストレーター以外は不可

    def test_callees_and_auto_spawn(self):
        """担当 → 担当の「呼ぶ」接続と、担当の自動作成のスイッチ（ADR 0043）。どちらも定義ファイルの tools に反映される"""
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text('{}')
        neko = next(e for e in self.reg.list() if e['kind'] == 'orchestrator')
        sub = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'sp-sub', 'parent_id': neko['id']})
        ag = self.reg.create_claude({'kind': 'agent', 'name': 'sp-ag', 'parent_id': neko['id']})
        tools_of = lambda eid: self.reg.get_definition(eid)['tools']
        # 自動作成のスイッチ: サブオーケストレーターだけ。入れると tools に入り、切ると消える
        with self.assertRaises(ValidationError):
            self.reg.update(ag['id'], {'auto_spawn': True})
        self.reg.update(sub['id'], {'auto_spawn': True})
        self.assertIn('mcp__neko-spawn__*', tools_of(sub['id']))
        self.assertTrue(self.reg.get(sub['id'])['auto_spawn'])
        self.reg.update(sub['id'], {'auto_spawn': False})
        self.assertNotIn('mcp__neko-spawn__*', tools_of(sub['id']))
        # 担当を呼ぶ接続: 呼ぶ側に Agent ツールが入る（読み取り専用の担当でも）。自分自身・猫神さま・輪は拒否
        self.assertNotIn('Agent', tools_of(ag['id']))
        self.reg.update(ag['id'], {'callee_ids': [sub['id']]})
        self.assertIn('Agent', tools_of(ag['id']))
        self.assertEqual(self.reg.get(ag['id'])['callee_ids'], [sub['id']])
        for bad in ([ag['id']], [neko['id']], ['no-such']):
            with self.assertRaises(ValidationError):
                self.reg.update(ag['id'], {'callee_ids': bad})
        with self.assertRaises(ValidationError):
            self.reg.update(sub['id'], {'callee_ids': [ag['id']]})          # ag → sub → ag の輪
        # 定義ファイルのない担当には使えない
        bare = self.reg.create({'kind': 'agent', 'name': 'bare-ag', 'parent_id': neko['id']})
        with self.assertRaises(ValidationError):
            self.reg.update(bare['id'], {'callee_ids': [sub['id']]})
        # 呼ばれる側を消すと、接続も外れる
        self.reg.delete(sub['id'])
        self.assertEqual(self.reg.get(ag['id'])['callee_ids'], [])

    def test_nested_suborchestrators(self):
        """サブオーケストレーターの入れ子（ADR 0042）: 置き場所、委任先、深さ、循環、条件"""
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text('{}')
        neko = next(e for e in self.reg.list() if e['kind'] == 'orchestrator')
        a = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'sub-a', 'parent_id': neko['id']})
        b = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'sub-b', 'parent_id': a['id']})
        self.assertEqual(b['definition']['path'], '.claude/agents/sub-a/sub-b.md')               # 親のフォルダに置く
        c = self.reg.create_claude({'kind': 'agent', 'name': 'work-c', 'parent_id': b['id']})
        self.assertEqual(c['definition']['path'], '.claude/agents/sub-b/work-c.md')               # 自分の配下は、自分の名前のフォルダ
        dj = json.loads((self.root / 'nekogamisama' / 'suborchestrators.json').read_text())
        self.assertIn('sub-a', dj)
        self.assertNotIn('sub-b', dj)                                                              # 委任先に載るのは、猫神さま直下だけ
        self.assertEqual(sorted(r['name'] for r in self.reg.admin_overview()['delegation'] if r['registered']), ['azure-sage', 'sub-a'])
        self.assertEqual([m['name'] for m in self.reg.admin_overview()['misplaced'] if m['name'] != 'azure-x'], [])
        # 深さの上限（猫神さまの下を 1 として 4 階層）
        d = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'sub-d', 'parent_id': b['id']})
        deep = self.reg.create_claude({'kind': 'agent', 'name': 'deep-ok', 'parent_id': d['id']})   # 猫神さま → a → b → d → 担当 = 4 階層
        with self.assertRaises(ValidationError):
            self.reg.create_claude({'kind': 'subagent', 'name': 'too-deep', 'parent_id': deep['id']})
        # 循環と、Agent のない親
        with self.assertRaises(ValidationError):
            self.reg.update(a['id'], {'parent_id': d['id']})
        self.reg.update(d['id'], {'tool_ids': self.reg.get(d['id'])['tool_ids'][:0]})
        with self.assertRaises(ValidationError):
            self.reg.create_claude({'kind': 'suborchestrator', 'name': 'sub-e', 'parent_id': d['id']})
        # 付け替え: 猫神さま直下へ戻すと、ファイルが自分のフォルダに移り、委任先に載る。配下は付いてくる
        self.reg.update(b['id'], {'parent_id': neko['id']})
        self.assertEqual(self.reg.get(b['id'])['definition']['path'], '.claude/agents/sub-b/sub-b.md')
        self.assertIn('sub-b', json.loads((self.root / 'nekogamisama' / 'suborchestrators.json').read_text()))
        self.assertEqual([m['name'] for m in self.reg.admin_overview()['misplaced'] if m['name'] != 'azure-x'], [])
        # 名前の変更でも、配下のファイルが付いてくる
        self.reg.update(a['id'], {'parent_id': neko['id'], 'name': 'sub-a2'})
        self.reg.update(b['id'], {'parent_id': a['id']})
        self.assertEqual(self.reg.get(b['id'])['definition']['path'], '.claude/agents/sub-a2/sub-b.md')
        self.reg.update(b['id'], {'name': 'sub-b2'})
        self.assertEqual(self.reg.get(c['id'])['definition']['path'], '.claude/agents/sub-b2/work-c.md')
        self.assertEqual([m['name'] for m in self.reg.admin_overview()['misplaced'] if m['name'] != 'azure-x'], [])
        # 定義ファイルのないものは、入れ子にできない
        with self.assertRaises(ValidationError):
            self.reg.create({'kind': 'suborchestrator', 'name': 'bare', 'parent_id': a['id']})

    def test_python_and_input_nodes(self):
        """Python ノード（関数のコード）と入力ノード（引数の既定値）。コードは実行せず検証する（ADR 0041）"""
        code = 'def main(n: int, tags: list = None):\n    """合計"""\n    return n\n'
        self.reg.sync_builtin('http://x')
        py = self.reg.create_tool({'name': 'calc', 'kind': 'python', 'code': code, 'func': 'main'})
        self.assertEqual([(p['name'], p['type'], p['required']) for p in py['params']], [('n', 'int', True), ('tags', 'list', False)])
        self.assertEqual(py['doc'], '合計')
        self.assertEqual(py['style'], 'function')   # 関数ごと書いた旧形式は、そのまま動く（ADR 0045）
        for bad in ({'code': 'def main(n): pass'}, {'code': 'def main(:'}):
            with self.assertRaises(ValidationError):
                self.reg.update_tool(py['id'], bad)
        with self.assertRaises(ValidationError):   # 処理が空なら断る。`x = 1` のような処理だけは、新形式として受け付ける
            self.reg.create_tool({'name': 'p2', 'kind': 'python', 'code': '  '})
        self.assertEqual(self.reg.create_tool({'name': 'p3', 'kind': 'python', 'code': 'x = 1'})['style'], 'body')
        i = self.reg.create_tool({'name': 'n-in', 'kind': 'input', 'param': 'n', 'dtype': 'int', 'value': '42'})
        with self.assertRaises(ValidationError):
            self.reg.create_tool({'name': 'bad-in', 'kind': 'input', 'param': 'n', 'dtype': 'int', 'value': '4.2'})
        self.reg.update_tool(py['id'], {'input_ids': [i['id']]})
        self.assertEqual(self.reg.list_tools()[-2]['kind'] in ('python', 'input'), True)
        # つないだ後に、合わなくなる変更は受け付けない（入力ノード側も、Python ノード側も）
        with self.assertRaises(ValidationError):
            self.reg.update_tool(i['id'], {'dtype': 'str'})
        with self.assertRaises(ValidationError):
            self.reg.update_tool(py['id'], {'code': 'def main(m: int): pass'})
        self.reg.update_tool(i['id'], {'value': '7'})
        # 入力ノードは担当につなげない。Python ノードは、ディレクトリ・LLM と同じく担当につなぐ
        ent = next(e for e in self.reg.list() if e['name'] == 'azure-x')
        with self.assertRaises(ValidationError):
            self.reg.update(ent['id'], {'tool_ids': [i['id']]})
        self.reg.update(ent['id'], {'tool_ids': [py['id']]})
        self.assertIn('mcp__py-calc__*', self._agent_text('.claude/agents/x.md'))
        self.reg.delete_tool(i['id'])
        self.assertEqual(next(t for t in self.reg.list_tools() if t['id'] == py['id'])['input_ids'], [])
        self.reg.delete_tool(py['id'])
        self.assertNotIn('py-calc', self._agent_text('.claude/agents/x.md'))

    def test_nodes_on_suborchestrator_apply_to_its_delegate(self):
        """サブオーケストレーターへの接続は、委任先（type=agent）の担当の定義ファイルに反映される（ADR 0040）"""
        self.reg.sync_builtin('http://x')
        neko = next(e for e in self.reg.list() if e['kind'] == 'orchestrator')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        dj = self.root / 'nekogamisama' / 'suborchestrators.json'
        dj.write_text(json.dumps({'sx': {'type': 'agent', 'agent': 'azure-x', 'description': ''}}))
        sx = self.reg.create({'kind': 'suborchestrator', 'name': 'sx', 'parent_id': neko['id']})
        lone = self.reg.create({'kind': 'suborchestrator', 'name': 'lone', 'parent_id': neko['id']})            # 委任先なし
        node = self.reg.create_tool({'name': 'qwen', 'kind': 'llm', 'model': 'qwen3:8b'})
        with self.assertRaises(ValidationError):
            self.reg.update(lone['id'], {'tool_ids': [node['id']]})
        self.reg.update(sx['id'], {'tool_ids': [node['id']]})
        self.assertIn('mcp__llm-qwen__*', self._agent_text('.claude/agents/x.md'))                              # 実体（azure-x）のツールになる
        host = next(e for e in self.reg.list() if e['name'] == 'azure-x')
        self.assertEqual((node['id'] in host['tool_ids'], node['id'] in self.reg.get(sx['id'])['tool_ids']), (True, True))
        # 書き込みのあるディレクトリは、ここでも確認が要る。失敗したら、定義ファイルも台帳も変わらない
        w = self.reg.create_tool({'name': 'out', 'kind': 'directory', 'path': 'out', 'perms': {'write': True}})
        ids = self.reg.get(sx['id'])['tool_ids'] + [w['id']]
        with self.assertRaises(ValidationError):
            self.reg.update(sx['id'], {'tool_ids': ids})
        self.assertNotIn('dir-out', self._agent_text('.claude/agents/x.md'))
        self.assertNotIn(w['id'], self.reg.get(sx['id'])['tool_ids'])
        self.reg.update(sx['id'], {'tool_ids': ids, 'allow_dangerous': True})
        self.assertIn('mcp__dir-out__*', self._agent_text('.claude/agents/x.md'))
        # 外すと、定義ファイルからも消える。他の項目（元からのツール）は残る
        self.reg.update(sx['id'], {'tool_ids': [w['id']]})
        text = self._agent_text('.claude/agents/x.md')
        self.assertNotIn('llm-qwen', text)
        self.assertIn('mcp__dir-out__*', text)
        self.assertIn('WebSearch', text)

    def test_create_claude_agents_and_tree(self):
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        dj = self.root / 'nekogamisama' / 'suborchestrators.json'
        dj.write_text(json.dumps({'azure-sage': {'dir': '..', 'description': 'a'}}))
        neko = self.reg.list(kind='orchestrator')[0]
        so = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'cost-sage', 'parent_id': neko['id'], 'description': 'コスト担当', 'model': 'sonnet'})
        self.assertEqual(so['definition']['path'], '.claude/agents/cost-sage/cost-sage.md')
        text = self._agent_text(so['definition']['path'])
        self.assertIn('role: suborchestrator', text); self.assertIn('tools: Agent, Read, Glob, Grep', text); self.assertIn('model: sonnet', text)
        d = json.loads(dj.read_text())
        self.assertEqual(d['cost-sage'], {'type': 'agent', 'agent': 'cost-sage', 'description': 'コスト担当'})
        self.assertEqual(d['azure-sage']['dir'], '..')                           # session 型の項目には触れない
        ag = self.reg.create_claude({'kind': 'subagent', 'name': 'cost-calc', 'parent_id': so['id'], 'description': '計算', 'prompt': 'あなたは計算係です。'})
        self.assertEqual(ag['definition']['path'], '.claude/agents/cost-sage/cost-calc.md')
        self.assertIn('あなたは計算係です。', self._agent_text(ag['definition']['path']))
        self.assertNotIn('Bash', self._agent_text(ag['definition']['path']))   # 既定は読み取り中心
        # プロンプト編集
        r = self.reg.set_prompt(ag['id'], '新しいプロンプト')
        self.assertEqual(r['prompt'], '新しいプロンプト')
        self.assertIn('tools: Read, Glob, Grep, WebSearch, WebFetch', self._agent_text(ag['definition']['path']))  # frontmatter は残る
        # 親の付け替えでフォルダも移る
        moved = self.reg.update(ag['id'], {'parent_id': neko['id']})
        self.assertEqual(moved['definition']['path'], '.claude/agents/nekogamisama/cost-calc.md')
        self.assertTrue((self.root / moved['definition']['path']).is_file())
        self.assertFalse((self.root / '.claude/agents/cost-sage/cost-calc.md').exists())
        # 削除: ファイルは trash へ、委任先一覧からも消える
        self.reg.delete(so['id'], cascade=True)
        self.assertFalse((self.root / '.claude/agents/cost-sage').exists())
        self.assertEqual(len(list((self.root / 'trash').glob('*cost-sage*'))), 1)
        self.assertEqual(list(json.loads(dj.read_text())), ['azure-sage'])
        # 検証
        for bad in ({'kind': 'subagent', 'name': '../evil', 'parent_id': neko['id']}, {'kind': 'orchestrator', 'name': 'o2'},
                    {'kind': 'subagent', 'name': 'x-bash', 'parent_id': neko['id'], 'tool_ids': [{t['name']: t['id'] for t in self.reg.list_tools()}['Bash']]},
                    {'kind': 'subagent', 'name': 'azure-x', 'parent_id': neko['id']}):
            with self.assertRaises(ValidationError):
                self.reg.create_claude(bad)

    def test_rename_moves_files_and_delegation(self):
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        dj = self.root / 'nekogamisama' / 'suborchestrators.json'
        dj.write_text(json.dumps({'azure-sage': {'type': 'session', 'dir': '..', 'description': 'a'}}))
        neko = self.reg.list(kind='orchestrator')[0]
        so = self.reg.create_claude({'kind': 'suborchestrator', 'name': 'old-sub', 'parent_id': neko['id'], 'description': 'd'})
        ag = self.reg.create_claude({'kind': 'subagent', 'name': 'old-ag', 'parent_id': so['id'], 'description': 'd'})
        # サブエージェントの改名: name とファイル名が変わり、フォルダは同じ
        ag = self.reg.update(ag['id'], {'name': 'new-ag'})
        self.assertEqual(ag['definition']['path'], '.claude/agents/old-sub/new-ag.md')
        self.assertIn('name: new-ag', self._agent_text(ag['definition']['path']))
        self.assertFalse((self.root / '.claude/agents/old-sub/old-ag.md').exists())
        # サブオーケストレーターの改名: 自分のファイルと子のフォルダ、委任先一覧が追随する
        so = self.reg.update(so['id'], {'name': 'new-sub'})
        self.assertEqual(so['definition']['path'], '.claude/agents/new-sub/new-sub.md')
        self.assertEqual(self.reg.get(ag['id'])['definition']['path'], '.claude/agents/new-sub/new-ag.md')
        self.assertFalse((self.root / '.claude/agents/old-sub').exists())
        self.assertEqual(json.loads(dj.read_text())['new-sub'], {'type': 'agent', 'agent': 'new-sub', 'description': 'd'})
        self.assertNotIn('old-sub', json.loads(dj.read_text()))
        self.assertEqual({a['name'] for a in self.reg.defs.scan()} >= {'new-sub', 'new-ag'}, True)
        # 衝突（定義の name、エンティティ名）は、何も動かさずに拒否
        before = sorted(p.as_posix() for p in (self.root / '.claude/agents').rglob('*.md'))
        for bad in ('azure-x', 'azure-sage', 'bad name', '../x'):
            with self.assertRaises(ValidationError):
                self.reg.update(so['id'], {'name': bad})
        self.assertEqual(before, sorted(p.as_posix() for p in (self.root / '.claude/agents').rglob('*.md')))
        # 猫神さまは改名できない。session 型（azure-sage）の改名は、子のフォルダと委任先のキーが追随する
        with self.assertRaises(Forbidden):
            self.reg.update(neko['id'], {'name': 'nekochan'})
        sage = next(e for e in self.reg.list() if e['name'] == 'azure-sage')
        (self.root / '.claude/agents/azure-sage').mkdir(exist_ok=True)
        (self.root / '.claude/agents/azure-sage/z.md').write_text('---\nname: az-z\ndescription: z\n---\n\nb\n')
        self.reg.sync_builtin('http://x')
        self.reg.update(sage['id'], {'name': 'sage2'})
        self.assertTrue((self.root / '.claude/agents/sage2/z.md').is_file())
        self.assertEqual(self.reg.get(next(e['id'] for e in self.reg.list() if e['name'] == 'az-z'))['definition']['path'], '.claude/agents/sage2/z.md')
        d = json.loads(dj.read_text())
        self.assertEqual((d['sage2']['type'], d['sage2']['dir']), ('session', '..'))

    def test_delegation_editing(self):
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        dj = self.root / 'nekogamisama' / 'suborchestrators.json'
        dj.write_text(json.dumps({'azure-sage': {'type': 'session', 'dir': '..', 'description': 'a'}}))
        (self.root / 'tools-dir').mkdir()
        r = self.reg.delegation_put('azure-x-route', {'type': 'agent', 'agent': 'azure-x', 'description': '経路'})
        self.assertEqual(r, {'type': 'agent', 'agent': 'azure-x', 'description': '経路'})
        r = self.reg.delegation_put('side', {'type': 'session', 'dir': '../tools-dir', 'description': 's'})
        self.assertEqual(r['dir'], '../tools-dir')
        self.assertEqual(self.reg.delegation_put('azure-sage', {'type': 'session', 'dir': '..', 'description': '更新'})['description'], '更新')
        self.assertEqual(sorted(json.loads(dj.read_text())), ['azure-sage', 'azure-x-route', 'side'])
        self.assertEqual(len(list((self.root / 'backups').glob('nekogamisama__suborchestrators.json.*'))), 3)   # 書き換えごとに退避
        for name, bad in (('x', {'type': 'agent', 'agent': 'no-such-agent'}),            # 定義のない agent
                          ('x', {'type': 'session', 'dir': '../..'}),                      # プロジェクトの外
                          ('x', {'type': 'session', 'dir': '/etc'}),
                          ('x', {'type': 'session', 'dir': 'missing-dir'}),
                          ('x', {'type': 'session'}),
                          ('Bad_Name', {'type': 'session', 'dir': '..'}),                  # delegate.sh が受け付けない名前
                          ('x', {'type': 'shell', 'dir': '..'}),
                          ('x', 'str')):
            with self.assertRaises(ValidationError, msg=str((name, bad))):
                self.reg.delegation_put(name, bad)
        # env と args（ローカル LLM の担当など。ADR 0039）: 許可リストにあるものだけ。指定がなければ今の値を保つ
        env = {'ANTHROPIC_BASE_URL': 'http://ollama:11434', 'ANTHROPIC_MODEL': 'qwen3:8b', 'ANTHROPIC_API_KEY': ''}
        args = ['--tools', 'Read,Glob,Grep', '--strict-mcp-config', '--max-turns', '8']
        r = self.reg.delegation_put('side', {'type': 'session', 'dir': '../tools-dir', 'env': env, 'args': args})
        self.assertEqual((r['env'], r['args']), (env, args))
        r = self.reg.delegation_put('side', {'type': 'session', 'dir': '../tools-dir', 'description': '画面から編集'})
        self.assertEqual((r['env'], r['args']), (env, args))
        for bad in ({'env': {'PATH': '/tmp'}}, {'env': {'ANTHROPIC_MODEL': 'a b'}}, {'env': {'ANTHROPIC_MODEL': 'x;rm'}}, {'env': ['A']},
                    {'args': ['--dangerously-skip-permissions']}, {'args': ['--tools']}, {'args': ['--tools', '--max-turns']}, {'args': ['--model', 'a b']}, {'args': 'x'}):
            with self.assertRaises(ValidationError, msg=str(bad)):
                self.reg.delegation_put('side', {'type': 'session', 'dir': '../tools-dir', **bad})
        self.reg.delegation_delete('side')
        with self.assertRaises(NotFound):
            self.reg.delegation_delete('side')
        self.assertEqual(sorted(json.loads(dj.read_text())), ['azure-sage', 'azure-x-route'])
        dj.write_text('{broken')
        with self.assertRaises(ValidationError):                                         # 壊れたファイルは上書きしない
            self.reg.delegation_put('side', {'type': 'session', 'dir': '..'})
        self.assertEqual(dj.read_text(), '{broken')

    def test_sync_discovers_files_by_folder(self):
        base = self.root / '.claude' / 'agents'
        (base / 'azure-sage').mkdir()
        (base / 'azure-sage' / 'a.md').write_text('---\nname: grp-a\ndescription: d\n---\n\nbody\n')
        (base / 'newgrp').mkdir()
        (base / 'newgrp' / 'newgrp.md').write_text('---\nname: newgrp\ndescription: 新\nrole: suborchestrator\ntools: Agent, Read\n---\n\nbody\n')
        (base / 'newgrp' / 'w.md').write_text('---\nname: worker\ndescription: w\ntools: Read\n---\n\nbody\n')
        (base / 'broken.md').write_text('no frontmatter')
        self.reg.sync_builtin('http://x')
        by = {e['name']: e for e in self.reg.list()}
        self.assertEqual(self.reg.get(by['grp-a']['parent_id'])['name'], 'azure-sage')
        self.assertEqual((by['newgrp']['kind'], self.reg.get(by['newgrp']['parent_id'])['name']), ('suborchestrator', 'nekogamisama'))
        self.assertEqual((by['worker']['kind'], self.reg.get(by['worker']['parent_id'])['name']), ('subagent', 'newgrp'))
        self.assertNotIn('broken', by)
        self.assertEqual(self.reg.sync_builtin('http://x'), [])
        ov = self.reg.admin_overview()
        self.assertEqual(ov['misplaced'], [{'id': by['azure-x']['id'], 'name': 'azure-x', 'path': '.claude/agents/x.md', 'expected': '.claude/agents/azure-sage/azure-x.md'}])

    def test_claude_md_prompt_and_model(self):
        (self.root / 'nekogamisama' / '.claude').mkdir(parents=True)
        (self.root / 'nekogamisama' / 'CLAUDE.md').write_text('# 猫神さま\n')
        raw = '{\n  "model": "sonnet",\n  "hooks": {\n    "A":   [1]\n  }\n}\n'
        (self.root / 'nekogamisama' / '.claude' / 'settings.json').write_text(raw)
        self.reg.sync_builtin('http://x')
        neko = self.reg.list(kind='orchestrator')[0]
        self.assertEqual(neko['definition'], {'kind': 'claude-md', 'path': 'nekogamisama/CLAUDE.md'})
        self.reg.update(neko['id'], {'model': 'opus'})
        self.assertEqual((self.root / 'nekogamisama/.claude/settings.json').read_text(), raw.replace('"sonnet"', '"opus"'))   # 他の整形はそのまま
        self.reg.set_prompt(neko['id'], '# 新しい猫神さま')
        self.assertEqual((self.root / 'nekogamisama/CLAUDE.md').read_text(), '# 新しい猫神さま\n')
        with self.assertRaises(ValidationError):
            self.reg.update(neko['id'], {'model': '"; rm -rf'})
        self.assertEqual(self.reg.get(neko['id'])['model'], 'opus')

    def test_admin_overview(self):
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir()
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text(json.dumps({'azure-sage': {'dir': '..'}, 'ghost': {'dir': 'g'},
                                                                              'loc': {'type': 'session', 'dir': '..', 'env': {'ANTHROPIC_BASE_URL': 'http://o:1', 'ANTHROPIC_MODEL': 'qwen3:8b'}}}))
        self.reg.create({'kind': 'suborchestrator', 'name': 'unwired', 'parent_id': self.reg.list(kind='orchestrator')[0]['id']})
        ov = self.reg.admin_overview()
        self.assertEqual(ov['admin']['name'], 'nekogamisama')
        d = {x['name']: x for x in ov['delegation']}
        self.assertEqual((d['azure-sage']['registered'], d['azure-sage']['wired']), (True, True))
        self.assertEqual((d['unwired']['registered'], d['unwired']['wired']), (True, False))
        self.assertEqual((d['ghost']['registered'], d['ghost']['wired']), (False, True))
        self.assertEqual((d['loc']['local_model'], d['azure-sage']['local_model']), ('qwen3:8b', None))   # ローカル LLM の委任先は、Claude のモデルではなく、そのモデル名を出す

    def test_docker_runtime_validation(self):
        base = {'kind': 'orchestrator', 'name': 'd'}
        self.reg.create({**base, 'runtime': {'type': 'docker', 'compose_file': 'agents/c.yml', 'service': 'svc'}})
        for rt in ({'type': 'docker', 'compose_file': '../etc/x.yml', 'service': 'svc'},
                   {'type': 'docker', 'compose_file': 'agents/c.yml', 'service': 'a; rm -rf /'},
                   {'type': 'docker', 'compose_file': 'agents/c.txt', 'service': 'svc'}):
            with self.assertRaises(ValidationError):
                self.reg.create({'kind': 'orchestrator', 'name': 'e', 'runtime': rt})


class DefinitionsTest(unittest.TestCase):
    def test_doc_roundtrip_and_edit(self):
        from portal_api.definitions import Doc
        t = '---\nname: a\ndescription: d\ntools:\n  - Read\n  - Grep\neffort: low\n---\n\n本文\n'
        self.assertEqual(Doc(t).dump(), t)
        d = Doc(t)
        self.assertEqual(d.tools(), ['Read', 'Grep'])
        d.set('tools', 'Read')
        self.assertEqual(d.dump(), t.replace('tools:\n  - Read\n  - Grep', 'tools: Read'))

    def test_merge_tools(self):
        from portal_api.definitions import merge_tools, entry_node
        cat = {'Read': 'builtin', 'Bash': 'builtin', 'learn': 'mcp'}
        self.assertEqual(entry_node('mcp__learn__search'), 'learn')
        self.assertEqual(entry_node('Agent(a,b)'), 'Agent')
        self.assertEqual(merge_tools(['mcp__learn__search', 'Read', 'TodoWrite'], ['learn', 'Bash'], cat), ['mcp__learn__search', 'TodoWrite', 'Bash'])
        self.assertEqual(merge_tools(None, ['learn'], cat), ['mcp__learn__*'])
        self.assertEqual(merge_tools(['Read'], [], cat), [])

    def test_names_cannot_escape_agents_dir(self):
        from portal_api.definitions import DefinitionError, DefinitionStore
        st = DefinitionStore(Path(tempfile.mkdtemp()), Path(tempfile.mkdtemp()))
        for g, n in (('..', 'x'), ('a', '../x'), ('a/b', 'x'), ('', 'x')):
            with self.assertRaises(DefinitionError):
                st.agent_path(g, n)
        for rel in ('../outside.md', '.claude/agents/../../x.md', '.claude/settings.json', 'CLAUDE.md'):
            with self.assertRaises(DefinitionError):
                st._abs(rel)
        with self.assertRaises(DefinitionError):
            st.read({'kind': 'claude-md', 'path': '../../etc/passwd'})


class ThemeTest(unittest.TestCase):
    def test_clean_read_write(self):
        from portal_api import theme as th
        d = Path(tempfile.mkdtemp()); f = d / 'sub' / 'theme.json'
        self.assertEqual(th.read(f), {'mode': 'auto', 'accent': None, 'preset': 'default'})   # 無ければ既定
        self.assertEqual(th.write(f, {'mode': 'dark', 'accent': '#5BE3B0', 'preset': 'mint'}), {'mode': 'dark', 'accent': '#5be3b0', 'preset': 'mint'})
        self.assertEqual(th.read(f)['accent'], '#5be3b0')
        for bad in ({'mode': 'neon'}, {'accent': 'red'}, {'accent': '#12345'}, {'accent': 'red;background:url(x)'}, {'preset': 'A B'}, 'x'):
            with self.assertRaises(th.ThemeError):
                th.write(f, bad)
        self.assertEqual(th.read(f)['mode'], 'dark')                                            # 失敗しても保存済みの値は変わらない
        f.write_text('{broken'); self.assertEqual(th.read(f)['mode'], 'auto')                     # 壊れていれば既定

    def test_api(self):
        root = Path(tempfile.mkdtemp())
        old = config.THEME_FILE
        config.THEME_FILE = root / 'theme.json'; config.TOKEN = None
        call = make_call(Registry(root / 'd.json', root))
        try:
            self.assertEqual(call('GET', '/api/theme')[1]['mode'], 'auto')
            self.assertEqual(call('PUT', '/api/theme', {'mode': 'light', 'accent': '#0a6cd6'})[1]['accent'], '#0a6cd6')
            self.assertEqual(call('PUT', '/api/theme', {'accent': 'javascript:1'})[0], 400)
            self.assertEqual(call('GET', '/api/theme')[1]['mode'], 'light')
        finally:
            config.THEME_FILE = old


class PersonalityTest(Base):
    def setUp(self):
        super().setUp()
        (self.root / 'nekogamisama').mkdir()
        (self.root / 'nekogamisama' / 'CLAUDE.md').write_text('# 猫神さま\n\n本文\n')

    def test_roundtrip_and_import(self):
        from portal_api import personality as pe
        r = pe.read(self.root)
        self.assertEqual((r['exists'], r['imported'], r['first_person']), (False, False, 'わたし'))   # 既定値
        r = pe.write(self.root, {'first_person': 'わし', 'tone': '老猫のような「〜じゃ」口調', 'traits': '気まぐれ。\n\n- 日向ぼっこが好き'}, self.reg.defs)
        self.assertEqual((r['exists'], r['first_person'], r['address'], r['tone']), (True, 'わし', 'あなた', '老猫のような「〜じゃ」口調'))
        self.assertEqual(r['traits'], '気まぐれ。\n\n- 日向ぼっこが好き')
        self.assertEqual(pe.read(self.root)['traits'], r['traits'])                   # 手で開いても同じ形で読める
        r = pe.enable_import(self.root, self.reg.defs)
        self.assertTrue(r['imported'])
        text = (self.root / 'nekogamisama' / 'CLAUDE.md').read_text()
        self.assertEqual(text.count('@personality.md'), 1)
        pe.enable_import(self.root, self.reg.defs)                                     # 2 回目は足さない
        self.assertEqual((self.root / 'nekogamisama' / 'CLAUDE.md').read_text(), text)
        pe.write(self.root, {'tone': '変えた'}, self.reg.defs)
        names = sorted(p.name.split('.md.')[0] for p in (self.root / 'backups').glob('nekogamisama__*'))
        self.assertEqual(names, ['nekogamisama__CLAUDE', 'nekogamisama__personality'])   # 既存のファイルを書き換える前に退避

    def test_validation_and_no_import_injection(self):
        from portal_api import personality as pe
        r = pe.write(self.root, {'traits': '@/etc/passwd と @../CLAUDE.md を読む'}, self.reg.defs)
        self.assertNotIn('@', (self.root / 'nekogamisama' / 'personality.md').read_text())   # `@path` を import させない
        self.assertIn('＠', r['traits'])
        for bad in ({'first_person': 'あ' * 17}, {'tone': ''}, {'traits': 'x' * 1001}, {'traits': '# 見出し\n本文'}, {'tone': 5}):
            with self.assertRaises(pe.PersonalityError):
                pe.write(self.root, bad, self.reg.defs)

    def test_api(self):
        config.TOKEN = None
        call = make_call(self.reg)
        self.assertEqual(call('GET', '/api/admin/personality')[1]['exists'], False)
        self.assertEqual(call('PUT', '/api/admin/personality', {'first_person': 'ぼく'})[1]['first_person'], 'ぼく')
        self.assertEqual(call('PUT', '/api/admin/personality', {'tone': 'x' * 81})[0], 400)
        self.assertTrue(call('POST', '/api/admin/personality')[1]['imported'])


class FakeConsole(http.server.BaseHTTPRequestHandler):
    """Agent Console の代役。受け取った POST を記録し、/events には猫神さま・Azure Sage・フックの混在イベントを流す。"""
    posts = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        FakeConsole.posts.append((self.path, body))
        code = 409 if body.get('message') == 'busy' else 202
        data = json.dumps({'ok': code == 202} if code == 202 else {'error': '応答中です'}).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if self.path == '/api/targets':
            data = json.dumps({'default': 'azure-sage', 'running': ['nekogamisama'], 'runningChats': [{'target': 'nekogamisama'}], 'items': [{'name': 'nekogamisama', 'label': '猫神さま', 'type': 'orchestrator', 'cwd': '/secret'},
                                                                   {'name': 'news-sub', 'label': 'news-sub', 'type': 'agent', 'team': [{'name': 'x'}]}]}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        evs = [{'kind': 'hello', 'running': False, 'runningTargets': ['nekogamisama'], 'runningChats': [{'target': 'nekogamisama'}], 'sessionId': 'secret', 'agents': {}},
               {'kind': 'hook', 'event': 'PreToolUse'},
               {'kind': 'chat', 'agent': 'azure-sage', 'type': 'user', 'text': 'azure の会話'},
               {'kind': 'chat', 'agent': 'nekogamisama', 'type': 'user', 'text': 'こんにちは'},
               {'kind': 'chat', 'agent': 'nekogamisama', 'type': 'delta', 'text': 'やあ'},
               {'kind': 'hook', 'event': 'PreToolUse', 'chat': 'nekogamisama', 'toolName': 'Agent', 'sessionId': 'abcdef123456', 'ts': 1,
                'input': json.dumps({'subagent_type': 'news-agent', 'description': 'ニュース収集', 'prompt': '長い依頼文' * 100})},
               {'kind': 'hook', 'event': 'PreToolUse', 'chat': 'nekogamisama', 'toolName': 'Agent', 'ts': 2,   # 依頼文が長く、入力が途中で切られた（subagent_type が消えた）場合
                'input': '{\n  "description": "精査",\n  "prompt": "' + 'あ' * 1900 + '…(+464 chars)',
                'route': {'to': 'azure-reviewer', 'via': 'agent', 'description': '精査'}},
               {'kind': 'hook', 'event': 'PreToolUse', 'chat': 'nekogamisama', 'toolName': 'Bash',
                'input': json.dumps({'command': "nekogamisama/bin/delegate.sh azure-sage 'Foundry の料金'"})},
               {'kind': 'hook', 'event': 'SubagentStart', 'chat': 'nekogamisama', 'agentType': 'news-agent', 'agentId': 'a1', 'prompt': 'x' * 1000},
               {'kind': 'hook', 'event': 'PreToolUse', 'chat': 'nekogamisama', 'toolName': 'Read', 'agentId': 'a1', 'input': json.dumps({'file_path': '/etc/hosts'})},
               {'kind': 'hook', 'event': 'PostToolUse', 'chat': 'nekogamisama', 'toolName': 'Read', 'output': 'とても長い出力' * 1000},
               {'kind': 'hook', 'event': 'UserPromptSubmit', 'chat': 'nekogamisama', 'prompt': 'ユーザーの入力'},
               {'kind': 'hook', 'event': 'PreToolUse', 'chat': 'azure-sage', 'toolName': 'Read'},
               {'kind': 'hook', 'event': 'PreToolUse', 'chat': None, 'toolName': 'Read'},
               {'kind': 'reset', 'agent': 'azure-sage'},
               {'kind': 'reset', 'agent': 'nekogamisama'}]
        self.wfile.write(b': ping\n\n')
        for ev in evs:
            self.wfile.write(f'data: {json.dumps(ev, ensure_ascii=False)}\n\n'.encode())
        self.wfile.flush()


class ApiTest(Base):
    def setUp(self):
        super().setUp()
        config.TOKEN = None
        self._call = make_call(self.reg)

    def tearDown(self):
        config.TOKEN = None
        super().tearDown()

    def call(self, method, path, body=None, headers=None):
        return self._call(method, path, body, headers)

    def test_crud(self):
        c, o = self.call('POST', '/api/entities', {'kind': 'orchestrator', 'name': 'o'})
        self.assertEqual(c, 201)
        c, r = self.call('PATCH', f"/api/entities/{o['id']}", {'description': 'd', 'enabled': False})
        self.assertEqual((c, r['description'], r['enabled']), (200, 'd', False))
        self.assertEqual(self.call('GET', '/api/entities?kind=orchestrator')[1]['items'][0]['id'], o['id'])
        self.assertEqual(self.call('POST', '/api/entities', {'kind': 'x', 'name': 'a'})[0], 400)
        self.assertEqual(self.call('GET', '/api/entities/' + '0' * 8 + '-0000-0000-0000-' + '0' * 12)[0], 404)
        self.assertEqual(self.call('POST', f"/api/entities/{o['id']}/start")[0], 400)  # builtin/external は起動不可
        self.assertEqual(self.call('DELETE', f"/api/entities/{o['id']}")[0], 200)

    def test_auth_token_and_host(self):
        config.TOKEN, config.AUTH_ENABLED = 'secret', True
        try:
            self.assertEqual(self.call('GET', '/api/entities')[0], 401)
            self.assertEqual(self.call('GET', '/api/health')[0], 200)
            self.assertEqual(self.call('GET', '/api/entities', headers={'Authorization': 'Bearer secret'})[0], 200)
        finally:
            config.TOKEN, config.AUTH_ENABLED = None, False
        self.assertEqual(self.call('GET', '/api/entities', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.call('GET', '/api/entities', headers={'Origin': 'http://evil.example'})[0], 403)

    def test_host_ok_container(self):
        """0.0.0.0 で待ち受ける（コンテナ）とき: 中継で Host が変わっても、Origin が X-Forwarded-Host と同じなら通す"""
        from portal_api.app import host_ok
        old = config.HOST
        config.HOST = '0.0.0.0'
        try:
            self.assertTrue(host_ok('api:4401', None))
            self.assertTrue(host_ok('api:4401', 'http://192.168.1.5:4400', '192.168.1.5:4400'))
            self.assertFalse(host_ok('api:4401', 'http://evil.example', '192.168.1.5:4400'))
            self.assertFalse(host_ok('api:4401', 'http://192.168.1.5:4400'))
        finally:
            config.HOST = old

    def test_admin_api(self):
        self.reg.sync_builtin('http://x')
        neko = self.reg.list(kind='orchestrator')[0]
        self.assertEqual(self.call('DELETE', f"/api/entities/{neko['id']}?cascade=1")[0], 403)
        self.assertEqual(self.call('PATCH', f"/api/entities/{neko['id']}", {'enabled': False})[0], 403)
        c, ov = self.call('GET', '/api/admin/overview')
        self.assertEqual((c, ov['admin']['protected'], ov['counts']['suborchestrator']), (200, True, 1))
        c, t = self.call('POST', '/api/tools', {'name': 'api-tool', 'kind': 'custom'})
        self.assertEqual(c, 201)
        sub = self.reg.list(kind='suborchestrator')[0]
        c, e = self.call('PATCH', f"/api/entities/{sub['id']}", {'tool_ids': [t['id']], 'pos': {'x': 5, 'y': 6}})
        self.assertEqual((c, e['tool_ids'], e['pos']), (200, [t['id']], {'x': 5.0, 'y': 6.0}))
        self.assertEqual(self.call('PATCH', f"/api/entities/{sub['id']}", {'tool_ids': ['x']})[0], 400)
        self.assertEqual(self.call('DELETE', f"/api/tools/{t['id']}")[0], 200)
        self.assertEqual(self.call('GET', f"/api/entities/{sub['id']}")[1]['tool_ids'], [])
        self.assertEqual(self.call('GET', '/api/tools')[0], 200)

    def test_agents_api(self):
        self.reg.sync_builtin('http://x')
        neko = self.reg.list(kind='orchestrator')[0]
        c, e = self.call('POST', '/api/agents', {'kind': 'suborchestrator', 'name': 'api-sub', 'parent_id': neko['id'], 'description': 'テスト', 'model': 'haiku'})
        self.assertEqual((c, e['definition']['path']), (201, '.claude/agents/api-sub/api-sub.md'))
        c, d = self.call('GET', f"/api/entities/{e['id']}/definition")
        self.assertEqual((c, d['model'], d['tools'][:1]), (200, 'haiku', ['Agent']))
        self.assertIn('api-sub', d['prompt'])
        c, d = self.call('PUT', f"/api/entities/{e['id']}/prompt", {'prompt': 'API から更新'})
        self.assertEqual((c, d['prompt']), (200, 'API から更新'))
        self.assertEqual(self.call('PUT', f"/api/entities/{e['id']}/prompt", {'prompt': 5})[0], 400)
        self.assertEqual(self.call('PUT', f"/api/entities/{e['id']}/prompt", {'prompt': 'x' * 50001})[0], 400)
        self.assertEqual(self.call('POST', '/api/agents', {'kind': 'subagent', 'name': '../x', 'parent_id': e['id']})[0], 400)
        c, r = self.call('PATCH', f"/api/entities/{e['id']}", {'model': 'opus'})
        self.assertEqual(c, 200); self.assertIn('model: opus', (self.root / e['definition']['path']).read_text())
        self.assertEqual(self.call('PATCH', f"/api/entities/{e['id']}", {'definition': {'kind': 'agent-md', 'path': '../../x.md'}})[0], 200)  # 無視される
        self.assertEqual(self.reg.get(e['id'])['definition']['path'], '.claude/agents/api-sub/api-sub.md')
        plain = self.call('POST', '/api/entities', {'kind': 'orchestrator', 'name': 'plain'})[1]
        self.assertEqual(self.call('GET', f"/api/entities/{plain['id']}/definition")[0], 400)   # 定義ファイルのないもの
        self.assertEqual(self.call('DELETE', f"/api/entities/{e['id']}")[0], 200)
        self.assertFalse((self.root / '.claude/agents/api-sub').exists())

    def test_delegation_api(self):
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text('{}')
        self.assertEqual(self.call('PUT', '/api/delegation/route-x', {'type': 'agent', 'agent': 'azure-x', 'description': 'd'})[0], 200)
        self.assertEqual(self.call('PUT', '/api/delegation/x', {'type': 'session', 'dir': '/etc'})[0], 400)
        c, r = self.call('GET', '/api/delegation')
        self.assertEqual((c, list(r['items'])), (200, ['route-x']))
        c, ov = self.call('GET', '/api/admin/overview')
        row = next(d for d in ov['delegation'] if d['name'] == 'route-x')
        self.assertEqual((row['type'], row['agent'], row['description'], row['wired']), ('agent', 'azure-x', 'd', True))
        self.assertIsNone(row['entity'])                                              # 台帳にない（委任設定だけ）
        self.assertEqual((row['target']['name'], row['target']['kind']), ('azure-x', 'subagent'))
        c, e = self.call('POST', '/api/entities', {'kind': 'suborchestrator', 'name': 'route-x', 'description': '台帳側', 'model': 'haiku',
                                                    'parent_id': self.reg.list(kind='orchestrator')[0]['id']})
        self.assertEqual(c, 201)                                                       # 台帳に登録（定義ファイルなし）
        row = next(d for d in self.call('GET', '/api/admin/overview')[1]['delegation'] if d['name'] == 'route-x')
        self.assertEqual((row['entity']['id'], row['entity']['description'], row['entity']['has_definition'], row['entity']['children']), (e['id'], '台帳側', False, 0))
        self.assertEqual(self.call('PATCH', f"/api/entities/{e['id']}", {'description': '更新', 'enabled': False})[0], 200)
        self.assertEqual(self.call('DELETE', f"/api/entities/{e['id']}")[0], 200)     # 台帳から外す
        self.assertEqual(self.call('DELETE', '/api/delegation/route-x')[0], 200)
        self.assertEqual(self.call('DELETE', '/api/delegation/route-x')[0], 404)
        self.assertEqual(self.call('PUT', '/api/delegation/..%2Fx', {'type': 'agent'})[0], 404)

    def test_slash_commands(self):
        from portal_api.chat import chat_commands, expand_command
        self.reg.sync_builtin('http://x')
        (self.root / 'nekogamisama').mkdir(exist_ok=True)
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text(json.dumps({
            'azure-sage': {'type': 'session', 'dir': '..', 'description': 'Azure'}, 'news-sub': {'type': 'agent', 'agent': 'azure-x', 'description': 'ニュース'}}))
        cmds = {c['name']: c for c in chat_commands(self.reg)}
        self.assertEqual((cmds['azure-sage']['kind'], cmds['azure-sage']['how']), ('delegate', 'bin/delegate.sh'))
        self.assertEqual(cmds['news-sub']['how'], 'Agent ツール、subagent_type=azure-x')
        self.assertEqual((cmds['azure-x']['kind'], cmds['azure-x']['how']), ('agent', 'Agent ツール、subagent_type=azure-x'))   # 定義のあるエージェントも呼べる
        self.assertNotIn('nekogamisama', cmds)
        # 指名つきの依頼に展開する
        self.assertEqual(expand_command(self.reg, '/azure-sage Foundry の料金\n詳しく'), '[指名: azure-sage（bin/delegate.sh）]\nFoundry の料金\n詳しく')
        self.assertEqual(expand_command(self.reg, '/news-sub  ニュース  ').split('\n')[1], 'ニュース')
        self.assertEqual(expand_command(self.reg, 'ただの文章'), 'ただの文章')
        self.assertEqual(expand_command(self.reg, ' /azure-sage それっぽい文'), ' /azure-sage それっぽい文')   # 先頭が空白ならそのまま
        for bad in ('/', '/nope 依頼', '/azure-sage', '/azure-sage   ', '/../etc/passwd x', '/etc/hosts を読んで'):
            with self.assertRaises(ValidationError, msg=bad):
                expand_command(self.reg, bad)
        # 壊れた委任設定でも、エージェントのコマンドは出る
        (self.root / 'nekogamisama' / 'suborchestrators.json').write_text('{broken')
        self.assertIn('azure-x', {c['name'] for c in chat_commands(self.reg)})

    def test_chat_proxy(self):
        fake = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FakeConsole)
        threading.Thread(target=fake.serve_forever, daemon=True).start()
        FakeConsole.posts.clear()
        old = config.CONSOLE_URL
        try:
            config.CONSOLE_URL = f'http://127.0.0.1:{fake.server_address[1]}'
            c, r = self.call('POST', '/api/chat', {'message': ' こんにちは '})
            self.assertEqual((c, r), (202, {'ok': True}))
            self.assertEqual(FakeConsole.posts[-1], ('/api/chat', {'message': 'こんにちは', 'agent': 'nekogamisama'}))  # 相手は固定
            self.assertEqual(self.call('POST', '/api/chat', {'message': 'x', 'agent': 'azure-sage'})[0], 202)
            self.assertEqual(FakeConsole.posts[-1][1]['agent'], 'nekogamisama')                                        # 指定しても変えられない
            self.assertEqual(self.call('POST', '/api/chat', {'message': 'busy'})[0], 409)                              # 上流のステータスを中継
            for bad in ({}, {'message': '  '}, {'message': 5}, {'message': 'a' * 8001}):
                self.assertEqual(self.call('POST', '/api/chat', bad)[0], 400, bad)
            self.assertEqual(self.call('POST', '/api/chat/reset', {})[0], 202)
            self.assertEqual(FakeConsole.posts[-1], ('/api/reset', {'agent': 'nekogamisama'}))
            # スラッシュコマンドは、指名つきの依頼として Console に渡る
            (self.root / 'nekogamisama').mkdir(exist_ok=True)
            (self.root / 'nekogamisama' / 'suborchestrators.json').write_text(json.dumps({'azure-sage': {'type': 'session', 'dir': '..', 'description': 'Azure'}}))
            self.assertEqual(self.call('POST', '/api/chat', {'message': '/azure-sage 料金を調べて'})[0], 202)
            self.assertEqual(FakeConsole.posts[-1][1], {'message': '[指名: azure-sage（bin/delegate.sh）]\n料金を調べて', 'agent': 'nekogamisama'})
            n = len(FakeConsole.posts)
            self.assertEqual(self.call('POST', '/api/chat', {'message': '/unknown x'})[0], 400)
            self.assertEqual(len(FakeConsole.posts), n)                                   # 不明なコマンドは Console に送らない
            c, cm = self.call('GET', '/api/chat/commands')
            self.assertEqual((c, 'azure-sage' in [x['name'] for x in cm['items']]), (200, True))
            c, t = self.call('GET', '/api/chat/targets')
            self.assertEqual((c, t['default'], [x['name'] for x in t['items']]), (200, 'azure-sage', ['nekogamisama', 'news-sub']))
            self.assertNotIn('/secret', json.dumps(t)); self.assertNotIn('team', t['items'][1])                       # 名前・種別だけを渡す
            self.assertEqual(self.call('GET', '/api/chat/status'), (200, {'running': True}))                          # 画面が idle を受け損ねたときの照合用
            self.assertEqual(self.call('POST', '/api/chat/stop', {})[0], 202)
            with self._call.client.stream('GET', '/api/chat/stream') as r:
                text = ''.join(r.iter_text())
            events = [json.loads(l[5:]) for l in text.splitlines() if l.startswith('data:')]
            kinds = [(e['kind'], e.get('type') or e.get('event')) for e in events]
            self.assertEqual(kinds, [('hello', None), ('chat', 'user'), ('chat', 'delta'), ('trace', 'PreToolUse'), ('trace', 'PreToolUse'), ('trace', 'PreToolUse'),
                                     ('trace', 'SubagentStart'), ('trace', 'PreToolUse'), ('trace', 'PostToolUse'), ('reset', None)])
            tr = [e for e in events if e['kind'] == 'trace']
            self.assertEqual(tr[0]['route'], {'to': 'news-agent', 'via': 'agent', 'description': 'ニュース収集'})   # どのエージェントが選ばれたか
            self.assertEqual(tr[0]['sessionId'], 'abcdef12')
            self.assertEqual(tr[1]['route'], {'to': 'azure-reviewer', 'via': 'agent', 'description': '精査'})        # 入力が切られても route は残る
            self.assertEqual(tr[2]['route'], {'to': 'azure-sage', 'via': 'session', 'description': ''})            # delegate.sh による別セッション委任
            self.assertEqual((tr[3]['agentType'], len(tr[3]['prompt'])), ('news-agent', 301))                       # 長い依頼文は切る
            self.assertNotIn('route', tr[4]); self.assertEqual(tr[4]['input'], '/etc/hosts')
            self.assertNotIn('output', tr[5]); self.assertNotIn('とても長い出力', text)                              # ツールの出力は流さない
            self.assertNotIn('ユーザーの入力', text)
            self.assertNotIn('secret', text)          # セッション ID などは中継しない
            self.assertNotIn('azure の会話', text)     # 他のエージェントの会話・フックは流さない
            self.assertIn(': ping', text)
            config.CONSOLE_URL = 'http://127.0.0.1:9'  # 接続できない
            self.assertEqual(self.call('POST', '/api/chat', {'message': 'x'})[0], 502)
            self.assertEqual(self.call('GET', '/api/chat/stream')[0], 502)
        finally:
            config.CONSOLE_URL = old
            fake.shutdown(); fake.server_close()

    def test_chat_requires_token(self):
        config.TOKEN, config.AUTH_ENABLED = 'secret', True
        self.addCleanup(lambda: (setattr(config, 'TOKEN', None), setattr(config, 'AUTH_ENABLED', False)))
        self.assertEqual(self.call('POST', '/api/chat', {'message': 'x'})[0], 401)
        self.assertEqual(self.call('GET', '/api/chat/stream')[0], 401)

    def test_host_forms(self):
        for host in ('127.0.0.1:4401', 'localhost:4400', '[::1]:4401'):
            self.assertEqual(self.call('GET', '/api/health', headers={'Host': host})[0], 200, host)
        self.assertEqual(self.call('GET', '/api/health', headers={'Host': 'myhost:4401'})[0], 403)
        # 画面（Next.js）経由では、ブラウザの Origin（localhost:4400）が付く。ローカルの Origin は通す
        self.assertEqual(self.call('GET', '/api/health', headers={'Origin': 'http://localhost:4400'})[0], 200)
        self.assertEqual(self.call('GET', '/api/health', headers={'Origin': 'http://[::1]:4400'})[0], 200)
        config.ALLOWED_HOSTS = ('portal.example',)
        try:
            self.assertEqual(self.call('GET', '/api/health', headers={'Host': 'portal.example'})[0], 200)   # 許可リストにあるホスト
        finally:
            config.ALLOWED_HOSTS = ()

    def test_error_shapes(self):
        self.assertEqual(self.call('GET', '/api/nope')[0], 404)
        self.assertEqual(self.call('GET', '/api/entities/not-a-uuid')[0], 404)
        self.assertEqual(self.call('PUT', '/api/theme', ['x'])[0], 400)                    # JSON オブジェクト以外
        c, r = self.call('POST', '/api/entities', {'kind': 'x', 'name': 'a'})
        self.assertEqual((c, 'error' in r), (400, True))                                     # エラーは {error: ...}
        self.assertEqual(self.call('POST', '/api/entities', {'kind': 'agent', 'name': 'a' * (128 * 1024)})[0], 400)   # 大きすぎる


class IconTest(Base):
    PNG = b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + (64).to_bytes(4, 'big') * 2 + b'\x08\x06\x00\x00\x00' + b'0' * 20

    def setUp(self):
        super().setUp()
        config.TOKEN = None
        d = self.root / 'portal' / 'assets' / 'icons'
        d.mkdir(parents=True)
        (d / 'miko_cat_goddess.png').write_bytes(self.PNG)
        self.reg = Registry(self.root / 'data.json', self.root)
        self.call = make_call(self.reg)

    def upload(self, data, ctype='image/png'):
        r = self.call.client.post('/api/icons', content=data, headers={'content-type': ctype})
        return r.status_code, (r.json() if r.content else None)

    def test_upload_serve_and_assign(self):
        c, r = self.upload(self.PNG + b'1')
        self.assertEqual(c, 201)
        ref = r['icon']
        self.assertRegex(ref, r'^upload:[0-9a-f]{16}\.png$')
        self.assertEqual(self.upload(self.PNG + b'1')[1]['icon'], ref)       # 同じ内容は同じ参照
        got = self.call.client.get(f'/api/icons/{ref}')
        self.assertEqual((got.status_code, got.headers['content-type'], got.content), (200, 'image/png', self.PNG + b'1'))
        self.assertIn("default-src 'none'", got.headers['content-security-policy'])
        self.assertEqual(self.call('GET', '/api/icons')[1]['uploads'], [ref])
        self.assertEqual(self.call('GET', '/api/icons')[1]['builtin'], ['builtin:miko_cat_goddess'])
        c, o = self.call('POST', '/api/entities', {'kind': 'orchestrator', 'name': 'o', 'icon': ref})
        self.assertEqual((c, o['icon']), (201, ref))
        self.assertEqual(self.call('PATCH', f"/api/entities/{o['id']}", {'icon': 'builtin:miko_cat_goddess'})[1]['icon'], 'builtin:miko_cat_goddess')
        self.assertIsNone(self.call('PATCH', f"/api/entities/{o['id']}", {'icon': None})[1]['icon'])      # 既定に戻す
        self.assertIsNone(self.call('PATCH', f"/api/entities/{o['id']}", {'name': 'p'})[1]['icon'])        # 他の項目の更新で壊れない

    def test_rejects_bad_images_and_refs(self):
        self.assertEqual(self.upload(b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'image/svg+xml')[0], 400)
        self.assertEqual(self.upload(b'GIF89a' + (16).to_bytes(2, 'little') * 2 + b'<script>')[0], 201)   # 中身が GIF なら通る（Content-Type は信用しない）
        self.assertEqual(self.upload(b'')[0], 400)
        self.assertEqual(self.upload(b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + (9000).to_bytes(4, 'big') * 2 + b'0' * 20)[0], 400)   # 大きすぎる寸法
        self.assertEqual(self.upload(self.PNG + b'0' * (icons_max() + 1))[0], 400)
        self.assertEqual(self.call('POST', '/api/entities', {'kind': 'orchestrator', 'name': 'o', 'icon': 'upload:../../etc/passwd'})[0], 400)
        self.assertEqual(self.call('POST', '/api/entities', {'kind': 'orchestrator', 'name': 'o', 'icon': 'builtin:nothing'})[0], 400)
        self.assertEqual(self.call('POST', '/api/entities', {'kind': 'orchestrator', 'name': 'o', 'icon': 5})[0], 400)
        for bad in ('upload:..%2F..%2Fdata.json', 'builtin:..', 'nothing'):
            self.assertEqual(self.call.client.get(f'/api/icons/{bad}').status_code, 404)

    def test_delete_only_unused_uploads(self):
        ref = self.upload(self.PNG + b'2')[1]['icon']
        c, o = self.call('POST', '/api/entities', {'kind': 'orchestrator', 'name': 'o', 'icon': ref})
        self.assertEqual(self.call('DELETE', f'/api/icons/{ref}')[0], 400)             # 使用中
        self.call('PATCH', f"/api/entities/{o['id']}", {'icon': None})
        self.assertEqual(self.call('DELETE', f'/api/icons/{ref}')[0], 200)
        self.assertEqual(self.call.client.get(f'/api/icons/{ref}').status_code, 404)
        self.assertEqual(self.call('DELETE', '/api/icons/builtin:miko_cat_goddess')[0], 400)   # 組み込みは消せない

    def test_icon_images_are_readable_without_token(self):
        ref = self.upload(self.PNG + b'3')[1]['icon']
        config.TOKEN, config.AUTH_ENABLED = 'secret', True
        try:
            self.assertEqual(self.call.client.get(f'/api/icons/{ref}').status_code, 200)            # <img> は Authorization を送れない
            self.assertEqual(self.call.client.get('/api/icons').status_code, 401)                    # 一覧とアップロードは認証が要る
            self.assertEqual(self.call.client.post('/api/icons', content=self.PNG).status_code, 401)
        finally:
            config.TOKEN, config.AUTH_ENABLED = None, False


def icons_max():
    from portal_api import icons
    return icons.MAX_UPLOAD


class AuthTest(Base):
    def setUp(self):
        super().setUp()
        self.users = auth.UserStore(self.root / 'users.json')
        self.users.create('boss', 'correct-horse-1', 'admin')
        self.users.create('alice', 'alice-password-1', 'user')
        config.AUTH_ENABLED = True
        self.old_secret = config.SECRET_FILE
        config.SECRET_FILE = self.root / 'secret.key'
        self.client = TestClient(create_app(self.reg, self.users), base_url='http://127.0.0.1', raise_server_exceptions=False)

    def tearDown(self):
        config.AUTH_ENABLED = False
        config.SECRET_FILE = self.old_secret
        super().tearDown()

    def login(self, name, pw, client=None):
        return (client or self.client).post('/api/auth/login', json={'username': name, 'password': pw})

    def as_user(self, name, pw):
        c = TestClient(create_app(self.reg, self.users), base_url='http://127.0.0.1', raise_server_exceptions=False)
        self.assertEqual(self.login(name, pw, c).status_code, 200)
        return c

    def test_password_hash(self):
        h = auth.hash_password('abc-def-ghij')
        self.assertTrue(auth.verify_password('abc-def-ghij', h))
        self.assertFalse(auth.verify_password('abc-def-ghik', h))
        self.assertNotIn('abc-def', (self.root / 'users.json').read_text())
        self.assertEqual((self.root / 'users.json').stat().st_mode & 0o777, 0o600)

    def test_login_required_and_roles(self):
        self.assertEqual(self.client.get('/api/entities').status_code, 401)
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        self.assertEqual(self.login('alice', 'wrong-password').status_code, 401)
        self.assertEqual(self.login('nobody', 'whatever-pass').status_code, 401)
        user = self.as_user('alice', 'alice-password-1')
        self.assertEqual(user.get('/api/entities').status_code, 200)
        self.assertEqual(user.get('/api/auth/me').json()['user'], {'username': 'alice', 'role': 'user'})
        for method, path in (('GET', '/api/admin/overview'), ('GET', '/api/users'), ('POST', '/api/entities'),
                             ('PUT', '/api/theme'), ('GET', '/api/console/targets')):
            self.assertEqual(user.request(method, path, json={} if method != 'GET' else None).status_code, 403, (method, path))
        admin = self.as_user('boss', 'correct-horse-1')
        self.assertEqual(admin.get('/api/admin/overview').status_code, 200)
        self.assertEqual(admin.get('/api/users').status_code, 200)

    def test_logout_and_cookie_flags(self):
        r = self.login('boss', 'correct-horse-1')
        cookie = r.headers['set-cookie'].lower()
        self.assertIn('httponly', cookie)
        self.assertIn('samesite=strict', cookie)
        self.assertEqual(self.client.get('/api/entities').status_code, 200)
        self.client.post('/api/auth/logout')
        self.assertEqual(self.client.get('/api/entities').status_code, 401)

    def test_forged_and_revoked_session(self):
        c = TestClient(create_app(self.reg, self.users), base_url='http://127.0.0.1', raise_server_exceptions=False)
        c.cookies.set(auth.COOKIE, 'x.1.9999999999.deadbeef')
        self.assertEqual(c.get('/api/entities').status_code, 401)
        user = self.as_user('alice', 'alice-password-1')
        self.users.update('alice', disabled=True)   # 無効化すると既存のセッションも使えない
        self.assertEqual(user.get('/api/entities').status_code, 401)

    def test_throttle(self):
        for _ in range(5):
            self.assertEqual(self.login('alice', 'bad-password-x').status_code, 401)
        self.assertEqual(self.login('alice', 'alice-password-1').status_code, 429)

    def test_user_management_rules(self):
        admin = self.as_user('boss', 'correct-horse-1')
        self.assertEqual(admin.post('/api/users', json={'username': 'bob', 'password': 'bob-password-1', 'role': 'user'}).status_code, 201)
        self.assertEqual(admin.post('/api/users', json={'username': 'bob', 'password': 'bob-password-1'}).status_code, 400)   # 重複
        self.assertEqual(admin.post('/api/users', json={'username': 'Bad Name', 'password': 'bob-password-1'}).status_code, 400)
        self.assertEqual(admin.post('/api/users', json={'username': 'carol', 'password': 'short'}).status_code, 400)
        self.assertEqual(admin.patch('/api/users/boss', json={'role': 'user'}).status_code, 403)   # 自分は降格できない
        self.assertEqual(admin.delete('/api/users/boss').status_code, 403)
        self.assertEqual(admin.patch('/api/users/bob', json={'role': 'admin'}).status_code, 200)
        self.assertEqual(admin.delete('/api/users/bob').status_code, 200)
        self.assertNotIn('pw', admin.get('/api/users').json()['items'][0])

    def test_last_admin_protected(self):
        with self.assertRaises(Exception):
            self.users.update('boss', disabled=True)
        with self.assertRaises(Exception):
            self.users.delete('boss')

    def test_change_own_password(self):
        user = self.as_user('alice', 'alice-password-1')
        other = self.as_user('alice', 'alice-password-1')
        self.assertEqual(user.put('/api/auth/password', json={'current': 'nope-nope-nope', 'new': 'new-password-12'}).status_code, 401)
        self.assertEqual(user.put('/api/auth/password', json={'current': 'alice-password-1', 'new': 'new-password-12'}).status_code, 200)
        self.assertEqual(user.get('/api/entities').status_code, 200)    # この端末は続けて使える
        self.assertEqual(other.get('/api/entities').status_code, 401)   # 他の端末は入れ直し
        self.assertEqual(self.login('alice', 'new-password-12').status_code, 200)

    def test_bootstrap_admin(self):
        store = auth.UserStore(self.root / 'fresh.json')
        old = (config.ADMIN_USER, config.ADMIN_PASSWORD)
        config.ADMIN_USER, config.ADMIN_PASSWORD = 'root', 'initial-password-1'
        try:
            self.assertEqual(auth.bootstrap(store), 'root')
            self.assertIsNone(auth.bootstrap(store))   # 2 回目は作らない
        finally:
            config.ADMIN_USER, config.ADMIN_PASSWORD = old
        self.assertEqual(store.list()[0]['role'], 'admin')

    def test_chat_events_are_per_user(self):
        line = lambda ev: 'data: ' + json.dumps(ev)
        mine = {'kind': 'chat', 'agent': chat.CHAT_AGENT, 'user': 'alice', 'type': 'delta', 'text': 'hi'}
        self.assertIsNotNone(chat.filter_chat_event(line(mine), 'alice'))
        self.assertIsNone(chat.filter_chat_event(line(mine), 'bob'))
        self.assertIsNone(chat.filter_chat_event(line(mine), None))
        hook = {'kind': 'hook', 'event': 'PreToolUse', 'chat': chat.CHAT_AGENT, 'chatUser': 'alice'}
        self.assertIsNotNone(chat.filter_chat_event(line(hook), 'alice'))
        self.assertIsNone(chat.filter_chat_event(line(hook), 'bob'))
        hello = {'kind': 'hello', 'runningChats': [{'target': chat.CHAT_AGENT, 'user': 'alice'}]}
        self.assertIn('"running": true', chat.filter_chat_event(line(hello), 'alice'))
        self.assertIn('"running": false', chat.filter_chat_event(line(hello), 'bob'))

class DelegateScriptTests(unittest.TestCase):
    """nekogamisama/bin/delegate.sh が、台帳の env / args を、許可リストの範囲で claude に渡す（ADR 0039）。"""

    SCRIPT = Path(__file__).resolve().parents[3] / 'nekogamisama' / 'bin' / 'delegate.sh'

    def run_script(self, entry, name='loc'):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            (root / 'bin').mkdir()
            (root / 'bin' / 'delegate.sh').write_text(self.SCRIPT.read_text(encoding='utf-8'))
            (root / 'bin' / 'delegate.sh').chmod(0o755)
            (root / 'work').mkdir()
            (root / 'suborchestrators.json').write_text(json.dumps({name: {'type': 'session', 'dir': 'work', **entry}}))
            fake = root / 'fake-claude'
            fake.write_text('#!/bin/sh\necho "model=$ANTHROPIC_MODEL key=[$ANTHROPIC_API_KEY] args=$*"; cat\n')
            fake.chmod(0o755)
            return subprocess.run([str(root / 'bin' / 'delegate.sh'), name, '依頼'], capture_output=True, text=True, timeout=30,
                                  env={**os.environ, 'CLAUDE_BIN': str(fake)})

    def test_env_and_args_are_passed(self):
        r = self.run_script({'env': {'ANTHROPIC_MODEL': 'qwen3:8b', 'ANTHROPIC_API_KEY': ''}, 'args': ['--tools', 'Read,Glob', '--strict-mcp-config']})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, 'model=qwen3:8b key=[] args=-p --tools Read,Glob --strict-mcp-config\n依頼')

    def test_plain_entry_still_works(self):
        r = self.run_script({})
        self.assertEqual((r.returncode, r.stdout), (0, 'model= key=[] args=-p\n依頼'))

    def test_disallowed_values_are_refused(self):
        for entry in ({'env': {'PATH': '/x'}}, {'env': {'ANTHROPIC_MODEL': 'a b'}}, {'args': ['--dangerously-skip-permissions']}, {'args': ['--tools']}):
            r = self.run_script(entry)
            self.assertNotEqual(r.returncode, 0, str(entry))
            self.assertEqual(r.stdout, '', str(entry))   # claude は起動しない



if __name__ == '__main__':
    unittest.main()
