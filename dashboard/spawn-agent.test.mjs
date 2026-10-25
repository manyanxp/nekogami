import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { MAX_SPAWNS, READ_ONLY, buildSpawnServer, checkSpawnAccess, inheritTools, runSpawn } from './spawn-agent.mjs';

const fakeSdk = () => {
  const tools = [];
  return { tools, tool: (name, desc, schema, handler) => { tools.push({ name, handler }); return { name }; }, createSdkMcpServer: (o) => o };
};
// SDK の query の代わり: ツールを 1 回呼び、結果を返す
const fakeQuery = (result = '調べた結果', fail = false) => async function* () {
  yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.md' } }] } };
  yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } };
  yield fail ? { type: 'result', subtype: 'error_max_turns', is_error: true } : { type: 'result', subtype: 'success', result };
};

test('許可は、呼んだ担当が spawn を持つときだけ', () => {
  const base = { toolName: 'mcp__neko-spawn__spawn', callerName: 'a' };
  assert.equal(checkSpawnAccess({ ...base, callerTools: ['Agent', 'mcp__neko-spawn__*'] }).ok, true);
  assert.equal(checkSpawnAccess({ ...base, callerTools: ['Agent'] }).ok, false);
  assert.equal(checkSpawnAccess({ ...base, callerTools: null }).ok, false);
  assert.equal(checkSpawnAccess({ ...base, callerName: undefined, callerTools: ['mcp__neko-spawn__*'] }).ok, false);
});

test('引き継ぐのは、呼んだ担当がつないでいる読み取り系のツールだけ', () => {
  assert.deepEqual(inheritTools(['Agent', 'Read', 'Write', 'Bash', 'mcp__dir-x__*', 'Grep'], undefined), ['Read', 'Grep']);
  assert.deepEqual(inheritTools(null, undefined), READ_ONLY);
  assert.deepEqual(inheritTools(['Read', 'Grep'], ['Grep', 'Bash']), ['Grep']);
  assert.deepEqual(inheritTools(['Agent', 'Write'], undefined), []);
});

test('作って動かして消す: トレースに、自動作成の印つきで開始・ツール・完了が出る', async () => {
  const events = [];
  const r = await runSpawn({ name: 'doc-reader', role: '文書を読む', task: '読んで', tools: ['Read'], callerName: 'sub' },
    { query: fakeQuery(), emit: (e) => events.push(e), cwd: '/tmp', model: 'haiku' });
  assert.deepEqual(r, { ok: true, text: '調べた結果' });
  assert.deepEqual(events.map((e) => e.event), ['SubagentStart', 'PreToolUse', 'PostToolUse', 'SubagentStop']);
  assert.ok(events.every((e) => e.auto === true && e.agentType === '自動作成/doc-reader' && e.agentId.startsWith('auto-')));
  assert.match(events.at(-1).message, /削除しました/);
});

test('失敗しても例外にせず、削除したことを残す', async () => {
  const events = [];
  const r = await runSpawn({ name: 'x', role: 'r', task: 't', tools: ['Read'], callerName: 'sub' }, { query: fakeQuery('', true), emit: (e) => events.push(e), cwd: '/tmp', model: 'haiku' });
  assert.equal(r.ok, false);
  assert.match(events.at(-1).message, /削除しました/);
});

test('サーバー: 検査と、1 回の依頼で 3 体まで', async () => {
  const sdk = fakeSdk(), events = [];
  buildSpawnServer({ sdk, z, query: fakeQuery(), emit: (e) => events.push(e), cwd: '/tmp', model: 'haiku' });
  const spawn = sdk.tools[0].handler;
  const ok = { name: 'a', role: 'r', task: 't', _caller: 'sub', _caller_tools: ['Read', 'Agent'] };
  assert.equal((await spawn({ ...ok, name: 'Bad Name' })).isError, true);
  assert.equal((await spawn({ ...ok, _caller: undefined })).isError, true);
  assert.equal((await spawn({ ...ok, _caller_tools: ['Agent'] })).isError, true);   // 引き継げるツールがない
  for (let i = 0; i < MAX_SPAWNS; i++) assert.equal((await spawn({ ...ok, name: `a${i}` })).isError, false);
  const over = await spawn({ ...ok, name: 'a9' });
  assert.equal(over.isError, true);
  assert.match(over.content[0].text, /3 体まで/);
});
