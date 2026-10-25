// node --test dashboard/targets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTargets, publicTargets } from './targets.mjs';

function project(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'targets-'));
  fs.mkdirSync(path.join(root, 'nekogamisama'));
  fs.mkdirSync(path.join(root, 'side'));
  if (entries !== undefined) fs.writeFileSync(path.join(root, 'nekogamisama', 'suborchestrators.json'), typeof entries === 'string' ? entries : JSON.stringify(entries));
  return root;
}

test('既定は猫神さまと Azure Sage', () => {
  const t = buildTargets(project());
  assert.deepEqual([...t.keys()], ['nekogamisama', 'azure-sage']);
});
test('委任先一覧の session 型と agent 型が相手に加わる', () => {
  const root = project({ 'azure-sage': { type: 'session', dir: '..' }, side: { type: 'session', dir: '../side', description: '別' }, 'news-sub': { type: 'agent', agent: 'news-agent' } });
  const t = buildTargets(root);
  assert.deepEqual([...t.keys()], ['nekogamisama', 'azure-sage', 'side', 'news-sub']);
  assert.equal(t.get('side').cwd, path.join(root, 'side'));
  assert.deepEqual([t.get('news-sub').type, t.get('news-sub').agent, t.get('news-sub').cwd], ['agent', 'news-agent', root]);
  assert.equal(t.get('azure-sage').cwd, root);
});
test('不正な項目は出さない（プロジェクトの外、無いフォルダ、不正な名前、猫神さまの上書き）', () => {
  const t = buildTargets(project({ out: { type: 'session', dir: '../..' }, missing: { type: 'session', dir: 'nope' }, 'bad name': { type: 'agent', agent: 'x' },
    'x-agent': { type: 'agent', agent: '../evil' }, nekogamisama: { type: 'session', dir: '..' }, '..': { type: 'session', dir: '..' } }));
  assert.deepEqual([...t.keys()], ['nekogamisama', 'azure-sage']);
  assert.equal(t.get('nekogamisama').type, 'orchestrator');
});
test('壊れた JSON でも既定の相手は残る / 公開用にパスを含めない', () => {
  const t = buildTargets(project('{broken'));
  assert.deepEqual([...t.keys()], ['nekogamisama', 'azure-sage']);
  assert.ok(publicTargets(t).every((x) => !('cwd' in x)));
});

test('チーム: 猫神さまは委任先、ほかは自分のフォルダの定義（自分自身は除く）', () => {
  const root = project({ 'azure-sage': { type: 'session', dir: '..' }, 'news-sub': { type: 'agent', agent: 'news-agent' } });
  const agents = (dir, files) => { fs.mkdirSync(path.join(root, '.claude', 'agents', dir), { recursive: true }); for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(root, '.claude', 'agents', dir, f), body); };
  agents('azure-sage', { 'a.md': '---\nname: azure-a\nmodel: opus\n---\nx', 'b.md': '---\nname: azure-b\n---\nx', 'azure-sage.md': '---\nname: azure-sage\n---\nx', 'note.txt': 'no' });
  agents('news-agent', { 'h.md': '---\nname: news-helper\nmodel: haiku\n---\nx' });
  const t = Object.fromEntries(publicTargets(buildTargets(root), root).map((x) => [x.name, x.team]));
  assert.deepEqual(t.nekogamisama.map((x) => [x.name, x.role, x.agent]), [['azure-sage', '別セッション', undefined], ['news-sub', 'Agent', 'news-agent']]);
  assert.deepEqual(t['azure-sage'], [{ name: 'azure-a', model: 'opus' }, { name: 'azure-b', model: '' }]);
  assert.deepEqual(t['news-sub'], [{ name: 'news-helper', model: 'haiku' }]);   // agent 型は、呼ぶエージェントのフォルダ
  assert.equal(publicTargets(buildTargets(root))[0].team, undefined);
});
test('.claude/agents/ の定義ファイルも agent 型の相手になる（既存の名前は上書きしない）', () => {
  const root = project({ 'news-sub': { type: 'agent', agent: 'news-agent' } });
  const dir = path.join(root, '.claude', 'agents', 'grp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.md'), '---\nname: helper-a\ndescription: 手伝い\n---\n本文');
  fs.writeFileSync(path.join(dir, 'b.md'), '---\nname: news-sub\n---\n');
  fs.writeFileSync(path.join(dir, 'c.md'), '---\nname: ../bad\n---\n');
  const t = buildTargets(root);
  assert.deepEqual([...t.keys()], ['nekogamisama', 'azure-sage', 'news-sub', 'helper-a']);
  assert.deepEqual([t.get('helper-a').type, t.get('helper-a').agent, t.get('helper-a').cwd, t.get('helper-a').description], ['agent', 'helper-a', root, '手伝い']);
  assert.equal(t.get('news-sub').agent, 'news-agent');
});
