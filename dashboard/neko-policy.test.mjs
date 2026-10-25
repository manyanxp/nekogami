import assert from 'node:assert/strict';
import test from 'node:test';
import { checkNekoTool } from './neko-policy.mjs';

const nekoDir = '/proj/nekogamisama';
const ok = (toolName, input = {}) => checkNekoTool({ toolName, input, nekoDir }).ok;

test('委任の道具と、委任先の一覧の Read だけを許す', () => {
  assert.deepEqual(['Agent', 'Task', 'Bash'].map((t) => ok(t)), [true, true, true]);
  assert.equal(ok('Read', { file_path: '/proj/nekogamisama/suborchestrators.json' }), true);
  assert.equal(ok('Read', { file_path: 'suborchestrators.json' }), true);
});

test('それ以外の道具は、理由つきで断る', () => {
  for (const t of ['Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'ToolSearch', 'Write', 'Edit', 'mcp__dir-x__read', 'mcp__microsoft-learn__microsoft_docs_search']) {
    const r = checkNekoTool({ toolName: t, input: {}, nekoDir });
    assert.equal(r.ok, false, t);
    assert.match(r.reason, /任せる/);
  }
});

test('一覧以外のファイル・外へ抜けるパスは読ませない', () => {
  for (const f of ['/proj/nekogamisama/personality.md', '/proj/.env', '../.env', 'sub/../../secret', '', undefined]) assert.equal(ok('Read', { file_path: f }), false, String(f));
});
