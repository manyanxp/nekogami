// node --test dashboard/route.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOf } from './route.mjs';

const pre = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input });

test('Agent ツールの subagent_type（依頼文が長くても取れる）', () => {
  const long = 'あ'.repeat(5000);
  assert.deepEqual(routeOf(pre('Agent', { description: 'ニュース', prompt: long, subagent_type: 'news-agent' })), { to: 'news-agent', via: 'agent', description: 'ニュース' });
  assert.equal(routeOf(pre('Task', { subagent_type: 'azure-reviewer' })).to, 'azure-reviewer');
});
test('delegate.sh による別セッションへの委任（コマンドが長くても取れる）', () => {
  const r = routeOf(pre('Bash', { command: `nekogamisama/bin/delegate.sh azure-sage '${'長い依頼'.repeat(1000)}'` }));
  assert.deepEqual(r, { to: 'azure-sage', via: 'session', description: '' });
});
test('関係ないものは null（PreToolUse 以外、ほかのツール、不正な名前、入力なし）', () => {
  assert.equal(routeOf({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'x' } }), null);
  assert.equal(routeOf(pre('Read', { file_path: 'a' })), null);
  assert.equal(routeOf(pre('Bash', { command: 'ls' })), null);
  assert.equal(routeOf(pre('Agent', { subagent_type: '../evil' })), null);
  assert.equal(routeOf(pre('Agent', undefined)), null);
  assert.equal(routeOf(undefined), null);
});
