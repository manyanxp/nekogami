// Agent Console の状態（エージェントの状態・タイムライン）を、フック・許可・サブエージェントの発話のイベントから組み立てる。DOM に触れない。
export interface HookEvent {
  kind: 'hook'; event: string; ts: number; sessionId?: string; agentId?: string | null; agentType?: string | null; model?: string;
  toolName?: string; toolUseId?: string; input?: string; output?: string; prompt?: string; message?: string; source?: string; chat?: string | null;
  route?: { to: string; via: 'agent' | 'session'; description?: string };
  auto?: boolean;   // 自動作成された一時の担当の動き（ADR 0043）
}
export interface PermissionEvent { kind: 'permission'; ts: number; toolName: string; allowed: boolean; reason: string; chat?: string | null }
export interface SdkEvent { kind: 'sdk'; type: string; ts: number; text: string; chat?: string | null }
export type TraceInput = HookEvent | PermissionEvent | SdkEvent;

export type Status = 'idle' | 'running' | 'done';
export interface ConsoleAgent { key: string; name: string; model: string; status: Status; cur: string; tools: number; started: number; ended: number | null; sid: string }
export interface TimelineEvent {
  id: number; ts: number; who: string; model?: string; kind: string; cls: string; sum: string; details: [string, string | undefined][]; cat: 'tool' | 'agent' | 'other';
  pending?: boolean; err?: boolean; durMs?: number; extra?: [string, string][];
}
export interface Ctx { agentModels: Record<string, string>; mainModel: string }
export interface ConsoleStore {
  agents: Map<string, ConsoleAgent>; pending: Map<string, { ts: number; id: number; key: string; routeKey: string | null }>;
  stats: { tools: number; err: number; cost: number }; timeline: TimelineEvent[]; seq: number;
}
export const MAX_TIMELINE = 1500;

export const newStore = (): ConsoleStore => ({ agents: new Map(), pending: new Map(), stats: { tools: 0, err: 0, cost: 0 }, timeline: [], seq: 0 });

// ---- 表示用の小さな関数 ----
export const modelClass = (m?: string) => { const s = String(m || '').toLowerCase(); return s.includes('haiku') ? 'm-haiku' : s.includes('opus') ? 'm-opus' : s.includes('sonnet') ? 'm-sonnet' : ''; };
export const modelLabel = (m?: string) => { const c = modelClass(m); return c ? c.slice(2) : (m || '?'); };
export const fmtDur = (ms: number) => ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round(ms % 60000 / 1000)}s`;
export const shortTool = (n?: string) => {
  if (!n) return '';
  const m = n.match(/^mcp__([^_]+(?:-[^_]+)*)__(.+)$/);
  if (!m) return n;
  const srv = m[1] === 'microsoft-learn' ? 'Learn' : m[1] === 'azure' ? 'Azure' : m[1];
  return `${srv}:${m[2].replace(/^microsoft_/, '')}`;
};
export function summarizeInput(toolName: string | undefined, input: string | undefined): string {
  let o: Record<string, unknown>;
  try { o = JSON.parse(input || ''); } catch { return (input || '').replace(/\s+/g, ' ').slice(0, 200); }
  if (toolName === 'Agent' || toolName === 'Task') return `→ ${o.subagent_type || '?'}: ${o.description || ''}`;
  return String(o.query || o.question || o.url || o.file_path || o.pattern || o.command || o.prompt || JSON.stringify(o).slice(0, 200));
}
export const catPattern = (n: string) => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 4; };

// ---- 状態の更新（store を直接書き換える）----
const agentKey = (ev: HookEvent) => (ev.agentId ? `sub:${ev.agentId}` : `main:${ev.sessionId || 'chat'}`);

function ensureAgent(s: ConsoleStore, ev: HookEvent, ctx: Ctx): ConsoleAgent {
  const key = agentKey(ev);
  let a = s.agents.get(key);
  if (!a) {
    const isMain = !ev.agentId;
    a = { key, name: isMain ? 'orchestrator' : (ev.agentType || 'subagent'), model: isMain ? ctx.mainModel : (ev.model || ctx.agentModels[ev.agentType || ''] || 'inherit'),
      status: 'idle', cur: '', tools: 0, started: ev.ts, ended: null, sid: (ev.sessionId || '').slice(0, 8) };
    s.agents.set(key, a);
  }
  if (ev.agentId && ev.agentType && a.name === 'subagent') { a.name = ev.agentType; a.model = ev.model || ctx.agentModels[ev.agentType] || a.model; }
  return a;
}

function addEvent(s: ConsoleStore, e: Omit<TimelineEvent, 'id' | 'cls' | 'sum' | 'details' | 'cat'> & Partial<TimelineEvent>): TimelineEvent {
  const ev: TimelineEvent = { cls: '', sum: '', details: [], cat: 'other', ...e, id: ++s.seq };
  s.timeline.unshift(ev);                       // 新しい順
  if (s.timeline.length > MAX_TIMELINE) s.timeline.length = MAX_TIMELINE;
  return ev;
}

const oneLine = (t?: string) => (t || '').replace(/\s+/g, ' ');

/** フックのイベントを取り込む */
export function onHook(s: ConsoleStore, ev: HookEvent, ctx: Ctx) {
  const a = ensureAgent(s, ev, ctx);
  const who = a.name, model = a.model, ts = ev.ts;
  switch (ev.event) {
    case 'SessionStart': addEvent(s, { ts, who, model, kind: 'セッション開始', sum: ev.source || '', cat: 'agent', cls: 'ag' }); break;
    case 'UserPromptSubmit':
      a.status = 'running'; a.started = ts; a.ended = null;
      addEvent(s, { ts, who, model, kind: '指示受信', sum: ev.prompt || '', details: [['prompt', ev.prompt]], cat: 'agent', cls: 'ag' }); break;
    case 'PreToolUse': {
      s.stats.tools++; a.tools++; a.cur = shortTool(ev.toolName); a.status = 'running';
      const isAgent = ev.toolName === 'Agent' || ev.toolName === 'Task';
      const e = addEvent(s, { ts, who, model, kind: isAgent ? '委任' : shortTool(ev.toolName), cls: isAgent ? 'ag' : '', pending: true,
        sum: summarizeInput(ev.toolName, ev.input), details: [['input', ev.input]], cat: isAgent ? 'agent' : 'tool' });
      let routeKey: string | null = null;
      if (ev.route?.via === 'session') {   // delegate.sh による別セッションへの委任。委任先のカードを、完了まで「実行中」にする
        routeKey = `route:${ev.route.to}`;
        s.agents.set(routeKey, { key: routeKey, name: ev.route.to, model: 'inherit', status: 'running', cur: '委任中', tools: 0, started: ts, ended: null, sid: '' });
      }
      if (ev.toolUseId) s.pending.set(ev.toolUseId, { ts, id: e.id, key: a.key, routeKey });
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const p = ev.toolUseId ? s.pending.get(ev.toolUseId) : undefined;
      const failed = ev.event === 'PostToolUseFailure';
      if (failed) s.stats.err++;
      if (p) {
        s.pending.delete(ev.toolUseId!);
        const route = p.routeKey ? s.agents.get(p.routeKey) : undefined;
        if (route) Object.assign(route, { status: 'done', ended: ts, cur: '' });
        const e = s.timeline.find((x) => x.id === p.id);
        if (e) { e.pending = false; if (failed) e.err = true; e.durMs = ts - p.ts; e.extra = [[failed ? 'error' : 'output', ev.output || '(empty)']]; }
      } else if (failed) {
        addEvent(s, { ts, who, model, kind: 'ツール失敗', cls: 'err', sum: shortTool(ev.toolName), details: [['error', ev.output]], cat: 'tool', err: true });
      }
      if (a.cur === shortTool(ev.toolName)) a.cur = '';
      break;
    }
    case 'SubagentStart':
      a.status = 'running'; a.started = ts; a.ended = null;
      addEvent(s, { ts, who, model, kind: ev.auto ? '自動作成して開始' : 'サブエージェント開始', cls: 'ag', sum: ev.agentType || '', cat: 'agent' }); break;
    case 'SubagentStop':
      a.status = 'done'; a.ended = ts; a.cur = '';
      addEvent(s, { ts, who, model, kind: ev.auto ? '完了（自動作成の担当を削除）' : 'サブエージェント完了', cls: 'ag', sum: oneLine(ev.message), details: [['最終メッセージ', ev.message]], cat: 'agent' }); break;
    case 'Stop':
      a.status = 'idle'; a.cur = ''; a.ended = ts;
      addEvent(s, { ts, who, model, kind: '応答完了', cls: 'ag', sum: oneLine(ev.message), details: [['最終メッセージ', ev.message]], cat: 'agent' }); break;
    case 'Notification': addEvent(s, { ts, who, model, kind: '通知', sum: ev.message || '', cls: 'deny', cat: 'other' }); break;
    case 'SessionEnd': a.status = 'done'; a.ended = ts; addEvent(s, { ts, who, model, kind: 'セッション終了', cat: 'agent', cls: 'ag' }); break;
    default: addEvent(s, { ts, who, model, kind: ev.event, sum: ev.toolName || '' });
  }
}

/** フック・許可・サブエージェントの発話のイベントを取り込む */
export function handleTrace(s: ConsoleStore, ev: TraceInput, ctx: Ctx) {
  if (ev.kind === 'hook') onHook(s, ev, ctx);
  else if (ev.kind === 'permission') {
    if (!ev.allowed) { s.stats.err++; addEvent(s, { ts: ev.ts, who: 'permission', kind: '拒否', cls: 'deny', sum: `${shortTool(ev.toolName)} — ${ev.reason}`, cat: 'tool' }); }
  } else if (ev.kind === 'sdk' && ev.type === 'subagent_text') {
    addEvent(s, { ts: ev.ts, who: 'subagent', kind: '発話', sum: oneLine(ev.text), details: [['text', ev.text]], cat: 'agent' });
  }
}

// ---- フロー図の表示データ ----
export interface TargetInfo { name: string; label: string; type: string; agent?: string; description?: string; team?: { name: string; model?: string; role?: string; agent?: string }[] }
export interface FlowCardView { key: string; name: string; model: string; roleLabel: string; state: 'run' | 'fin' | ''; running: number; label: string; tools: number; pct: number; cur: string; dots: ('run' | 'fin' | '')[] }
export interface ConsoleFlow {
  title: string; agentsRun: number; legend: string[]; anyRun: boolean;
  orch: { model: string; label: string; state: string; elapsed: string; tools: number | null; cur: string }; cards: FlowCardView[];
}

export function buildConsoleFlow(s: ConsoleStore, tgt: TargetInfo | undefined, ctx: Ctx, now = Date.now()): ConsoleFlow {
  const list = [...s.agents.values()];
  const orch = list.find((a) => a.name === 'orchestrator');
  const team = tgt?.team || [];
  const teamInfo = Object.fromEntries(team.map((m) => [m.name, m]));
  const alias = new Set(team.map((m) => m.agent).filter(Boolean));   // 委任先の名前（news-sub）と、実際に動くエージェント（news-agent）は 1 枚のカードにまとめる
  const roles = [...new Set([...team.map((m) => m.name), ...list.filter((a) => a.name !== 'orchestrator' && !alias.has(a.name)).map((a) => a.name)])];
  const anyRun = list.some((a) => a.status === 'running');
  const om = orch ? orch.model : (tgt?.type === 'agent' && tgt.agent && ctx.agentModels[tgt.agent] ? ctx.agentModels[tgt.agent] : ctx.mainModel);   // agent 型の相手は、そのエージェントのモデル
  const cards: FlowCardView[] = roles.map((r) => {
    const info = teamInfo[r];
    const inst = list.filter((a) => a.name === r || (info?.agent && a.name === info.agent));
    const run = inst.filter((a) => a.status === 'running');
    const fin = inst.filter((a) => a.status === 'done');
    const model = info?.model || ctx.agentModels[r] || inst[0]?.model || 'inherit';
    return {
      key: r, name: tgt?.name === 'azure-sage' ? r.replace(/^azure-/, '') : r, model,
      roleLabel: model === 'inherit' && info?.role ? info.role : modelLabel(model),
      state: run.length ? 'run' : fin.length ? 'fin' : '', running: run.length,
      label: run.length ? `実行中 ${run.length}` : fin.length ? `✓ ${fin.length}/${inst.length} 完了` : '待機',
      tools: inst.reduce((n, a) => n + a.tools, 0),
      pct: run.length && !fin.length ? 8 : inst.length ? Math.round(fin.length / inst.length * 100) : 0,
      cur: run.map((a) => a.cur).find(Boolean) || '',
      dots: inst.slice(0, 16).map((a) => (a.status === 'running' ? 'run' : a.status === 'done' ? 'fin' : '')),
    };
  });
  const legend = [...new Set(cards.map((c) => c.model).concat(om))].filter((m) => m && m !== 'inherit');
  return {
    title: tgt?.label || '', agentsRun: list.filter((a) => a.name !== 'orchestrator').length, legend, anyRun,
    orch: {
      model: om, label: tgt?.label || modelLabel(om),
      state: orch ? (orch.status === 'running' ? '実行中' : orch.status === 'idle' ? '待機' : '完了') : '待機',
      elapsed: orch && orch.status !== 'idle' ? fmtDur((orch.ended || now) - orch.started) : '', tools: orch ? orch.tools : null, cur: orch?.cur || '',
    },
    cards,
  };
}
