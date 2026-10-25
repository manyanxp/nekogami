import { describe, expect, it } from 'vitest';
import { MODEL_CHOICES, buildGraph, canConnect, isDescendant, isRiskyDir, modelOptions, parentChoices, permLabels } from './graph-model';
import type { Entity, Tool } from './types';

const E = (id: string, kind: Entity['kind'], name: string, parent_id: string | null = null, o: Partial<Entity> = {}): Entity =>
  ({ id, kind, name, parent_id, description: '', model: '', enabled: true, tags: [], runtime: { type: 'builtin' }, tool_ids: [], pos: null, ...o });
const ents = [E('n', 'orchestrator', 'nekogamisama', null, { protected: true }), E('s', 'suborchestrator', 'azure-sage', 'n'), E('a1', 'subagent', 'a1', 's'),
  E('a2', 'subagent', 'a2', 's', { tool_ids: ['t1'] }), E('g', 'agent', 'helper', 'n'), E('g1', 'subagent', 'g1', 'g')];
const tools: Tool[] = [{ id: 't1', name: 'Read', kind: 'builtin', pos: null }, { id: 't2', name: 'Bash', kind: 'builtin', pos: { x: 900, y: 10 } }];

describe('graph', () => {
  const g = buildGraph(ents, tools);
  it('ノードと辺', () => {
    expect(g.nodes).toHaveLength(ents.length + tools.length);
    expect(g.edges.filter((e) => e.type === 'tree')).toHaveLength(5);
    expect(g.edges.filter((e) => e.type === 'tool').map((e) => e.id)).toEqual(['tool:a2>t1']);
  });
  it('自動配置', () => {
    const pos = Object.fromEntries(g.nodes.map((n) => [n.id, [n.x, n.y]]));
    expect([pos.n[0], pos.s[0], pos.a1[0]]).toEqual([0, 270, 540]);
    expect(pos.s[1]).toBe((pos.a1[1] + pos.a2[1]) / 2);
    expect(pos.t2).toEqual([900, 10]);
  });
  it('canConnect', () => {
    const can = (f: string, t: string) => canConnect(ents, tools, f, t);
    expect(can('n', 's').ok).toBe(false);
    expect(can('s', 'g')).toMatchObject({ ok: true, action: 'reparent' });
    expect(can('s', 'n').ok).toBe(false);
    expect(can('s', 's').ok).toBe(false);
    expect(can('g1', 'g').ok).toBe(false);
    expect(can('s', 't1')).toMatchObject({ ok: true, action: 'tool' });
    expect(can('a2', 't1').ok).toBe(false);
    expect(can('t1', 's').ok).toBe(false);
  });
  it('子孫・親候補', () => {
    expect([isDescendant(ents, 'n', 'g1'), isDescendant(ents, 'g1', 'n')]).toEqual([true, false]);
    expect(parentChoices(ents, 'suborchestrator').map((e) => e.name)).toEqual(['nekogamisama']);
  });
  it('モデル選択肢', () => {
    expect(modelOptions('opus')).toHaveLength(MODEL_CHOICES.length);
    expect(modelOptions('my-model').at(-1)).toEqual(['my-model', 'my-model（現在の値）']);
  });
});

describe('LLM ノード（ローカル LLM）', () => {
  const llm: Tool = { id: 'l1', name: 'qwen', kind: 'llm', pos: null, model: 'qwen3:8b', prompt: '短く', temperature: 0.7, max_tokens: 1024 };
  it('グラフでは Claude のモデルではなく、ローカル LLM とモデル名を出し、担当と接続できる', () => {
    const a = E('a1', 'agent', 'ag', 'o1');
    expect(buildGraph([E('o1', 'orchestrator', 'neko'), a], [llm]).nodes.find((n) => n.id === 'l1')!.sub).toBe('ローカル LLM · qwen3:8b');
    expect(canConnect([a], [llm], 'a1', 'l1')).toMatchObject({ ok: true, action: 'tool' });
  });
  it('確認が要る（危険な）接続ではない', () => {
    expect(isRiskyDir(llm)).toBe(false);
  });
});

describe('ディレクトリのノード', () => {
  const dir = (perms: Tool['perms']): Tool => ({ id: 'd1', name: 'docs', kind: 'directory', pos: null, path: 'notes/docs', perms });
  it('権限の表示と、危険（書き込み・削除）の判定', () => {
    expect(permLabels({ list: true, read: true })).toEqual(['参照', '読み込み']);
    expect(permLabels(undefined)).toEqual([]);
    expect([isRiskyDir(dir({ read: true })), isRiskyDir(dir({ write: true })), isRiskyDir(dir({ delete: true })), isRiskyDir(dir({ exec: true })), isRiskyDir(undefined)]).toEqual([false, true, true, true, false]);
    expect(isRiskyDir({ id: 'x', name: 'Bash', kind: 'builtin', pos: null })).toBe(false);
  });
  it('グラフでは、場所と権限をノードの下に出し、担当と接続できる', () => {
    const a = E('a1', 'agent', 'ag', 'o1');
    const g = buildGraph([E('o1', 'orchestrator', 'neko'), a], [dir({ list: true, write: true })]);
    expect(g.nodes.find((n) => n.id === 'd1')!.sub).toBe('notes/docs · 参照・書き込み');
    expect(buildGraph([a], [dir({})]).nodes.find((n) => n.id === 'd1')!.sub).toBe('notes/docs · 権限なし');
    expect(canConnect([a], [dir({})], 'a1', 'd1')).toMatchObject({ ok: true, action: 'tool' });
  });
});
