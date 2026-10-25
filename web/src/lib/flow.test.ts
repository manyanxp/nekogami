import { describe, expect, it } from 'vitest';
import { buildFlowView, stateOf, statsOf } from './flow-model';
import { newTrace, reduce } from './trace-model';
import type { AgentTrace } from './trace-model';
import type { DelegationRow, Entity } from './types';

const E = (id: string, kind: Entity['kind'], name: string, parent_id: string | null = null, o: Partial<Entity> = {}): Entity =>
  ({ id, kind, name, parent_id, description: '', model: '', enabled: true, tags: [], runtime: { type: 'builtin' }, tool_ids: [], pos: null, ...o });
const A = (o: Partial<AgentTrace>): AgentTrace => ({ starts: 0, stops: 0, subStarts: 0, subStops: 0, tools: 0, via: null, ...o });
const deleg = [
  { name: 'azure-sage', type: 'session', wired: true, registered: true, description: 'Azure' },
  { name: 'news-sub', type: 'agent', agent: 'news-agent', wired: true, registered: false },
  { name: 'test-sub', type: 'session', wired: false, registered: true },
] as unknown as DelegationRow[];
const ents = [E('n2', 'orchestrator', 'nekogamisama'), E('as', 'suborchestrator', 'azure-sage', 'n2', { model: 'sonnet' }), E('r1', 'subagent', 'azure-researcher', 'as'),
  E('r2', 'subagent', 'azure-reviewer', 'as'), E('na', 'agent', 'news-agent', 'n2', { model: 'haiku' }), E('nc', 'subagent', 'news-helper', 'na')];
const tr = (m: [string, AgentTrace][]) => ({ agents: new Map(m), routes: [] });

describe('reduce', () => {
  it('route → 開始、PostToolUse で完了', () => {
    const T = newTrace();
    const row = reduce(T, { kind: 'trace', event: 'PreToolUse', toolName: 'Agent', toolUseId: 'u1', ts: 1, route: { to: 'news-agent', via: 'agent', description: 'ニュース' } })!;
    expect([row.cls, T.agents.get('news-agent')!.starts, T.orch.state]).toEqual(['route', 1, 'run']);
    reduce(T, { kind: 'trace', event: 'PostToolUse', toolUseId: 'u1' });
    expect([T.agents.get('news-agent')!.stops, T.calls.size]).toEqual([1, 0]);
  });
  it('Stop はサブエージェントでは完了にしない', () => {
    const T = newTrace();
    expect(reduce(T, { kind: 'trace', event: 'Stop', agentId: 'a1' })).toBeNull();
    expect(reduce(T, { kind: 'trace', event: 'Stop' })!.cls).toBe('stop');
    expect(T.orch.state).toBe('done');
  });
});
describe('buildFlowView', () => {
  it('wired のみカード、最初は待機', () => {
    const v = buildFlowView(deleg, ents, tr([]));
    expect(v.cards.map((c) => c.label)).toEqual(['azure-sage', 'news-sub']);
    expect(v.cards.map((c) => c.state)).toEqual(['idle', 'idle']);
  });
  it('配下の実行が委任先に集計される', () => {
    const v = buildFlowView(deleg, ents, tr([['azure-researcher', A({ subStarts: 3, subStops: 2, tools: 4 })], ['azure-reviewer', A({ subStarts: 1, subStops: 1 })]]));
    const c = v.cards[0];
    expect([c.state, c.inst, c.fin, c.pct, c.children.map((k) => k.state)]).toEqual(['run', 4, 3, 75, ['run', 'done']]);
  });
  it('未知の呼び先は動的カード', () => {
    const v = buildFlowView(deleg, ents, tr([['stranger', A({ starts: 1, via: 'agent' })]]));
    expect(v.cards.find((c) => c.label === 'stranger')).toMatchObject({ dynamic: true, kind: 'unknown' });
  });
  it('statsOf', () => {
    expect(statsOf(A({ starts: 2, subStarts: 1, stops: 1, subStops: 5 }))).toEqual({ inst: 2, fin: 2, tools: 0 });
    expect([stateOf({ inst: 2, fin: 2, tools: 0 }), stateOf({ inst: 0, fin: 0, tools: 0 })]).toEqual(['done', 'idle']);
  });
});
