import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProgram, callPy, checkPyAccess, resolveArgs } from './py-tools.mjs';

const node = {
  name: 'calc', func: 'main', code: 'def main(n: int, tags: list = None, s: set = None):\n    return n\n', description: '',
  params: [{ name: 'n', type: 'int', required: true }, { name: 'tags', type: 'list', required: false }, { name: 's', type: 'set', required: false }],
  inputs: [{ param: 'n', dtype: 'int', value: 7, node: 'n-in' }],
};

test('入力ノードの値は既定値で、担当が渡した値が優先される', () => {
  assert.deepEqual(resolveArgs(node, {}), { n: 7 });
  assert.deepEqual(resolveArgs(node, { n: 3, tags: ['a'] }), { n: 3, tags: ['a'] });
});

test('必須の欠け・型違い・未知の引数は拒否する', () => {
  assert.throws(() => resolveArgs({ ...node, inputs: [] }, {}), /引数 n/);
  assert.throws(() => resolveArgs(node, { n: 1.5 }), /int で渡す/);
  assert.throws(() => resolveArgs(node, { n: true }), /int で渡す/);
  assert.throws(() => resolveArgs(node, { x: 1 }), /にない引数: x/);
  assert.throws(() => resolveArgs(node, { tags: {} }), /list で渡す/);
});

test('プログラムは、コードの後に呼び出しを足し、set は配列から戻す', () => {
  const p = buildProgram(node, { n: 2, s: [1, 2] });
  assert.ok(p.startsWith(node.code));
  assert.match(p, /set\(__neko_args\[__k\]\)/);
  assert.match(p, /__neko_r = main\(\*\*__neko_args\)/);
  assert.match(p, /"\{\\"n\\":2,\\"s\\":\[1,2\]\}"/);
});

test('結果の整形: 戻り値・標準出力・失敗', async () => {
  const ok = await callPy(node, {}, async () => ({ stdout: 'hello\n__NEKO_PY_RESULT__7\n', stderr: '', exit: 0 }));
  assert.equal(ok.ok, true);
  assert.match(ok.text, /戻り値: 7/);
  assert.match(ok.text, /hello/);
  const ng = await callPy(node, {}, async () => ({ stdout: '', stderr: 'Traceback', exit: 1 }));
  assert.equal(ng.ok, false);
  assert.match(ng.text, /実行に失敗/);
  assert.match(ng.text, /Traceback/);
  const to = await callPy(node, {}, async () => ({ stdout: '', stderr: '', exit: -9, timed_out: true }));
  assert.match(to.text, /時間切れ/);
});

test('接続していない担当は使えない', () => {
  const base = { toolName: 'mcp__py-calc__run', nodes: [node], callerName: 'a' };
  assert.equal(checkPyAccess({ ...base, callerTools: ['mcp__py-calc__*'] }).ok, true);
  assert.equal(checkPyAccess({ ...base, callerTools: ['Read'] }).ok, false);
  assert.equal(checkPyAccess({ ...base, callerName: undefined, callerTools: ['mcp__py-calc__*'] }).ok, false);
  assert.equal(checkPyAccess({ ...base, toolName: 'mcp__py-none__run', callerTools: ['mcp__py-none__*'] }).ok, false);
});
