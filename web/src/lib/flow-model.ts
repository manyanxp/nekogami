// 猫神さまの委任フロー（猫神さま → 委任先 → 配下 → 回答）の表示データを作る純粋ロジック。ADR 0024。
import type { DelegationRow, Entity } from './types';
import type { AgentTrace, Trace } from './trace-model';

export type RunState = 'idle' | 'run' | 'done';
export interface Stats { inst: number; fin: number; tools: number }

/** trace.agents の 1 件 → 実行回数。SubagentStart/Stop と、ツール呼び出し（route と PostToolUse）の多い方を採る（どちらか一方しか届かなくても動く） */
export function statsOf(a?: AgentTrace): Stats {
  if (!a) return { inst: 0, fin: 0, tools: 0 };
  const inst = Math.max(a.starts || 0, a.subStarts || 0), fin = Math.min(inst, Math.max(a.stops || 0, a.subStops || 0));
  return { inst, fin, tools: a.tools || 0 };
}
export const stateOf = ({ inst, fin }: Stats): RunState => (inst > fin ? 'run' : inst > 0 ? 'done' : 'idle');

export interface FlowCard {
  id: string; label: string; kind: string; via: 'agent' | 'session' | null; model: string; description: string; dynamic: boolean;
  inst: number; fin: number; tools: number; pct: number; state: RunState; cur: string; children: { name: string; state: RunState }[];
}
export interface FlowView {
  title: string; agentsRun: number; running: number; legend: string[];
  orch: Trace['orch']; routes: Trace['routes']; cards: FlowCard[]; final: { state: RunState };
}

/** delegation: /api/admin/overview の delegation（wired な項目だけを委任先にする） */
export function buildFlowView(delegation: DelegationRow[], entities: Entity[], trace: Partial<Trace> = {}): FlowView {
  const agents = trace.agents || new Map<string, AgentTrace>();
  const claimed = new Set<string>();
  const take = (name: string) => { claimed.add(name); return agents.get(name); };
  const sum = (list: Stats[]): Stats => list.reduce((t, s) => ({ inst: t.inst + s.inst, fin: t.fin + s.fin, tools: t.tools + s.tools }), { inst: 0, fin: 0, tools: 0 });

  const cards: FlowCard[] = delegation.filter((d) => d.wired).map((d) => {
    const ent = entities.find((e) => e.name === d.name) || entities.find((e) => e.name === d.agent);
    const keys = [...new Set([d.name, d.agent].filter(Boolean) as string[])];
    const own = sum(keys.map((k) => statsOf(take(k))));
    const kids = ent ? entities.filter((e) => e.parent_id === ent.id).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const kidStats = kids.map((k) => statsOf(take(k.name)));
    const total = sum([own, ...kidStats]);
    const via = d.type === 'agent' ? 'agent' : 'session';
    const last = [...(trace.routes || [])].reverse().find((r) => keys.includes(r.to));
    return {
      id: `d:${d.name}`, label: d.name, kind: ent && (ent.kind === 'agent' || ent.kind === 'subagent') ? ent.kind : 'suborchestrator', via,
      model: ent?.model || '', description: d.description || '', dynamic: false,
      ...total, pct: total.inst ? Math.round((total.fin / total.inst) * 100) : 0, state: stateOf(total),
      cur: stateOf(total) === 'run' ? (last?.description || (via === 'session' ? '別セッションで実行中' : '実行中')) : '',
      children: kids.map((k, i) => ({ name: k.name, state: stateOf(kidStats[i]) })),
    };
  });

  // 委任設定にも配下にもない呼び先（猫神さまが直接呼んだエージェントなど）
  for (const [name, a] of agents) {
    if (claimed.has(name)) continue;
    const ent = entities.find((e) => e.name === name), s = statsOf(a);
    cards.push({ id: `x:${name}`, label: name, kind: ent?.kind || 'unknown', via: a.via || null, model: ent?.model || '', description: '', dynamic: true,
      ...s, pct: s.inst ? Math.round((s.fin / s.inst) * 100) : 0, state: stateOf(s), cur: '', children: [] });
  }

  const orch = trace.orch || { state: 'idle' as const, cur: '', tools: 0 };
  const running = cards.filter((c) => c.state === 'run').length;
  const finalState: RunState = orch.state === 'done' ? 'done' : orch.state === 'run' && cards.some((c) => c.state === 'done') && !running ? 'run' : 'idle';
  return {
    title: '猫神さま', agentsRun: cards.reduce((n, c) => n + c.inst, 0), running,
    legend: ['orchestrator', 'suborchestrator', 'agent', 'subagent'],
    orch: { state: orch.state || 'idle', cur: orch.cur || '', tools: orch.tools || 0 },
    routes: trace.routes || [], cards, final: { state: finalState },
  };
}
