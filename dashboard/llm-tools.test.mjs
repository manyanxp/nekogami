import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askLlm, buildLlmServers, checkLlmAccess, loadLlmNodes } from './llm-tools.mjs';

const node = { name: 'qwen', model: 'qwen3:8b', description: '', prompt: '短く答える', temperature: 0.2, max_tokens: 256 };
const reply = (content, init = {}) => async (url, opts) => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => init.body ?? { message: { content } }, _req: { url, body: JSON.parse(opts.body) } });

test('台帳から読む: LLM ノードだけ。不正な名前・モデル・範囲外の値は既定に直すか無視する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-'));
  const f = path.join(dir, 'registry.json');
  fs.writeFileSync(f, JSON.stringify({ tools: [
    { kind: 'llm', name: 'qwen', model: 'qwen3:8b', prompt: 'p', temperature: 9, max_tokens: 5 },
    { kind: 'llm', name: 'bad.name', model: 'qwen3:8b' }, { kind: 'llm', name: 'nomodel', model: 'a b' }, { kind: 'directory', name: 'd', path: 'a' },
  ] }));
  const nodes = loadLlmNodes(f);
  assert.deepEqual(nodes.map((n) => n.name), ['qwen']);
  assert.deepEqual([nodes[0].temperature, nodes[0].max_tokens], [0.7, 1024]);
  assert.deepEqual(loadLlmNodes(path.join(dir, 'none.json')), []);
});

test('checkLlmAccess: ノードと、呼んだ担当の接続の両方が要る', () => {
  const base = { nodes: [node], callerName: 'agent-a' };
  assert.equal(checkLlmAccess({ ...base, toolName: 'mcp__llm-qwen__ask', callerTools: ['Read', 'mcp__llm-qwen__*'] }).ok, true);
  assert.match(checkLlmAccess({ ...base, toolName: 'mcp__llm-qwen__ask', callerTools: ['Read'] }).reason, /接続されていない/);
  assert.match(checkLlmAccess({ ...base, toolName: 'mcp__llm-qwen__ask', callerTools: null }).reason, /接続されていない/);
  assert.match(checkLlmAccess({ ...base, callerName: undefined, toolName: 'mcp__llm-qwen__ask', callerTools: ['mcp__llm-qwen__*'] }).reason, /特定できない/);
  assert.match(checkLlmAccess({ ...base, toolName: 'mcp__llm-none__ask', callerTools: ['mcp__llm-none__*'] }).reason, /台帳にない/);
  assert.equal(checkLlmAccess({ ...base, toolName: 'mcp__llm-qwen__other', callerTools: ['mcp__llm-qwen__*'] }).ok, false);
  assert.equal(checkLlmAccess({ ...base, toolName: 'mcp__dir-qwen__read', callerTools: ['mcp__llm-qwen__*'] }).ok, false);
});

test('askLlm: システムプロンプトと設定を渡し、答えだけを返す（考える過程は取り除く）', async () => {
  const f = reply('<think>うーん</think>こんにちは');
  let seen;
  const out = await askLlm(node, { prompt: '挨拶して', context: '資料' }, { baseUrl: 'http://o:1', fetchFn: async (u, o) => { seen = { u, b: JSON.parse(o.body) }; return f(u, o); } });
  assert.equal(out, 'こんにちは');
  assert.equal(seen.u, 'http://o:1/api/chat');
  assert.deepEqual(seen.b.messages, [{ role: 'system', content: '短く答える' }, { role: 'user', content: '資料\n\n挨拶して' }]);
  assert.deepEqual([seen.b.model, seen.b.stream, seen.b.think, seen.b.options], ['qwen3:8b', false, false, { temperature: 0.2, num_predict: 256 }]);
  const noSys = await askLlm({ ...node, prompt: '' }, { prompt: 'q' }, { baseUrl: 'x', fetchFn: async (u, o) => { seen = JSON.parse(o.body); return reply('a')(u, o); } });
  assert.deepEqual(seen.messages, [{ role: 'user', content: 'q' }]);
  assert.equal(noSys, 'a');
});

test('askLlm: 入力と出力の上限、空の質問、Ollama のエラー、接続できないとき', async () => {
  const opt = (fetchFn) => ({ baseUrl: 'http://o:1', fetchFn });
  await assert.rejects(askLlm(node, { prompt: '  ' }, opt(reply('a'))), /prompt/);
  await assert.rejects(askLlm(node, { prompt: 'x'.repeat(24001) }, opt(reply('a'))), /24000/);
  const long = await askLlm(node, { prompt: 'q' }, opt(reply('あ'.repeat(30000))));
  assert.ok(long.length < 20100 && long.includes('先頭 20000'));
  await assert.rejects(askLlm(node, { prompt: 'q' }, opt(reply('', { ok: false, status: 404, body: { error: 'model not found' } }))), /404.*model not found.*ollama pull/s);
  await assert.rejects(askLlm(node, { prompt: 'q' }, opt(reply(''))), /空の答え/);
  await assert.rejects(askLlm(node, { prompt: 'q' }, opt(async () => { throw new Error('ECONNREFUSED'); })), /接続できない.*ECONNREFUSED/s);
});

test('buildLlmServers: ノードごとに ask を 1 つ公開する（本物の zod で、引数の定義が作れることも確かめる）', async () => {
  const { z } = await import('zod');
  const sdk = { tool: (name, _d, shape) => ({ name, shape }), createSdkMcpServer: (o) => ({ name: o.name, tools: o.tools }) };
  const s = buildLlmServers({ sdk, z, nodes: [node, { ...node, name: 'b' }], baseUrl: 'x' });
  assert.deepEqual(Object.keys(s), ['llm-qwen', 'llm-b']);
  assert.deepEqual(s['llm-qwen'].tools.map((t) => t.name), ['ask']);
  assert.deepEqual(Object.keys(s['llm-qwen'].tools[0].shape), ['prompt', 'context']);
  assert.equal(z.object(s['llm-qwen'].tools[0].shape).safeParse({ prompt: 'q' }).success, true);
  assert.equal(z.object(s['llm-qwen'].tools[0].shape).safeParse({}).success, false);
});
