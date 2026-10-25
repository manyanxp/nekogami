// 猫神さまとのチャット中のトレース（フックのイベント）を、委任フローと時系列の元になる状態にまとめる純粋ロジック。ADR 0019・0024。
import type { TraceEvent } from './types';

export interface AgentTrace { starts: number; stops: number; subStarts: number; subStops: number; tools: number; via: 'agent' | 'session' | null }
export interface Trace {
  agents: Map<string, AgentTrace>;
  orch: { state: 'idle' | 'run' | 'done'; cur: string; tools: number };
  routes: { to: string; via: 'agent' | 'session'; description: string }[];
  calls: Map<string, string>;
}
export interface LogLine { cls: 'route' | 'tool' | 'fail' | 'start' | 'stop'; ts?: number; who: string; sub: boolean; text: string; to?: string }

export const newTrace = (): Trace => ({ agents: new Map(), orch: { state: 'idle', cur: '', tools: 0 }, routes: [], calls: new Map() });

const ensure = (t: Trace, name: string): AgentTrace => {
  let a = t.agents.get(name);
  if (!a) { a = { starts: 0, stops: 0, subStarts: 0, subStops: 0, tools: 0, via: null }; t.agents.set(name, a); }
  return a;
};
const VIA: Record<string, string> = { session: '別セッションに委任', agent: 'Agent ツール' };

/**
 * イベントを 1 つ取り込む（t を更新する）。ログに出す行を返す。出さないものは null。
 * 呼び先の開始/完了は、ツール呼び出し（route の PreToolUse と、同じ toolUseId の PostToolUse）と、SubagentStart/Stop の両方から数える
 * （フックの設定によって、どちらか一方しか届かなくても動くように、多い方を採る。flow-model の statsOf）
 */
export function reduce(t: Trace, ev: TraceEvent): LogLine | null {
  const sub = !!ev.agentId;                       // サブエージェント内の動き
  const who = ev.agentType || '猫神さま';
  switch (ev.event) {
    case 'PreToolUse':
      if (ev.route) {
        const a = ensure(t, ev.route.to);
        a.starts += 1; a.via = ev.route.via;
        t.routes.push({ to: ev.route.to, via: ev.route.via, description: ev.route.description || '' });
        if (ev.toolUseId) t.calls.set(ev.toolUseId, ev.route.to);
        if (!sub) t.orch.state = 'run';
        return { cls: 'route', ts: ev.ts, who, sub, to: ev.route.to, text: `→ ${ev.route.to} を選択（${VIA[ev.route.via] || ev.route.via}）${ev.route.description ? `: ${ev.route.description}` : ''}` };
      }
      if (ev.agentType) ensure(t, ev.agentType).tools += 1;
      else { t.orch.state = 'run'; t.orch.tools += 1; t.orch.cur = ev.toolName || ''; }
      return { cls: 'tool', ts: ev.ts, who, sub, text: `${ev.toolName}${ev.input ? ` ${ev.input}` : ''}` };
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const to = ev.toolUseId ? t.calls.get(ev.toolUseId) : undefined;
      if (to) { ensure(t, to).stops += 1; t.calls.delete(ev.toolUseId!); }
      else if (!sub) t.orch.cur = '';
      return ev.event === 'PostToolUseFailure' ? { cls: 'fail', ts: ev.ts, who, sub, text: `${ev.toolName} が失敗` } : null;
    }
    case 'SubagentStart': ensure(t, ev.agentType || '(不明)').subStarts += 1; return { cls: 'start', ts: ev.ts, who: ev.agentType || '(不明)', sub: true, text: `▶ ${ev.auto ? '自動作成して開始' : '開始'}${ev.prompt ? `: ${ev.prompt}` : ''}` };
    case 'SubagentStop': ensure(t, ev.agentType || '(不明)').subStops += 1; return { cls: 'stop', ts: ev.ts, who: ev.agentType || '(不明)', sub: true, text: `■ ${ev.auto ? '完了（自動作成の担当を削除）' : '完了'}${ev.message ? `: ${ev.message}` : ''}` };
    case 'Stop':
      if (sub) return null;
      t.orch.state = 'done'; t.orch.cur = '';
      return { cls: 'stop', ts: ev.ts, who: '猫神さま', sub: false, text: '応答を完了' };
    default: return null;
  }
}
