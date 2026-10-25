// バックエンド API クライアント（UI ロジックを持たない）。/api/* は Next.js が FastAPI へ中継する。
import type { ChatCommand, ChatEvent, ConsoleTarget, DockerStatus, Entity, EntityDefinition, Health, Me, Overview, Personality, Theme, Tool, UserRow } from './types';
import type { IconList } from './icons';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 未ログイン（401）なら、ログイン画面へ移る。ログイン後に元のページへ戻る */
function toLogin() {
  if (typeof window === 'undefined' || location.pathname === '/login') return;
  location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/login') toLogin();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

type Json = Record<string, unknown>;

async function uploadIcon(file: File): Promise<string> {
  const res = await fetch('/api/icons', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) toLogin();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || `HTTP ${res.status}`);
  return (data as { icon: string }).icon;
}

export const api = {
  me: () => call<Me>('GET', '/api/auth/me'),
  login: (username: string, password: string) => call<{ user: { username: string; role: string } }>('POST', '/api/auth/login', { username, password }),
  logout: () => call<Json>('POST', '/api/auth/logout'),
  changePassword: (current: string, next: string) => call<Json>('PUT', '/api/auth/password', { current, new: next }),
  users: () => call<{ items: UserRow[] }>('GET', '/api/users').then((r) => r.items),
  createUser: (u: Json) => call<UserRow>('POST', '/api/users', u),
  updateUser: (name: string, patch: Json) => call<UserRow>('PATCH', `/api/users/${encodeURIComponent(name)}`, patch),
  removeUser: (name: string) => call<Json>('DELETE', `/api/users/${encodeURIComponent(name)}`),
  health: () => call<Health>('GET', '/api/health'),
  list: () => call<{ items: Entity[] }>('GET', '/api/entities').then((r) => r.items),
  create: (e: Json) => call<Entity>('POST', '/api/entities', e),
  update: (id: string, patch: Json) => call<Entity>('PATCH', `/api/entities/${id}`, patch),
  remove: (id: string, cascade = false) => call<{ deleted: unknown }>('DELETE', `/api/entities/${id}${cascade ? '?cascade=1' : ''}`),
  status: (id: string) => call<DockerStatus>('GET', `/api/entities/${id}/status`),
  start: (id: string) => call<DockerStatus>('POST', `/api/entities/${id}/start`),
  stop: (id: string) => call<DockerStatus>('POST', `/api/entities/${id}/stop`),
  syncBuiltin: () => call<{ created: string[] }>('POST', '/api/sync-builtin'),
  overview: () => call<Overview>('GET', '/api/admin/overview'),
  theme: () => call<Theme>('GET', '/api/theme'),
  setTheme: (t: Theme) => call<Theme>('PUT', '/api/theme', t),
  personality: () => call<Personality>('GET', '/api/admin/personality'),
  setPersonality: (p: Partial<Personality>) => call<Personality>('PUT', '/api/admin/personality', p),
  enablePersonality: () => call<Personality>('POST', '/api/admin/personality', {}),
  createAgent: (a: Json) => call<Entity>('POST', '/api/agents', a),
  delegationPut: (name: string, entry: Json) => call<Json>('PUT', `/api/delegation/${encodeURIComponent(name)}`, entry),
  delegationDelete: (name: string) => call<Json>('DELETE', `/api/delegation/${encodeURIComponent(name)}`),
  definition: (id: string) => call<EntityDefinition>('GET', `/api/entities/${id}/definition`),
  setPrompt: (id: string, prompt: string) => call<EntityDefinition>('PUT', `/api/entities/${id}/prompt`, { prompt }),
  consoleTargets: () => call<{ default: string; items: ConsoleTarget[] }>('GET', '/api/chat/targets'),
  chatCommands: () => call<{ items: ChatCommand[] }>('GET', '/api/chat/commands').then((r) => r.items),
  chatStatus: () => call<{ running: boolean }>('GET', '/api/chat/status'),
  chatSend: (message: string) => call<Json>('POST', '/api/chat', { message }),
  chatStop: () => call<Json>('POST', '/api/chat/stop', {}),
  chatReset: () => call<Json>('POST', '/api/chat/reset', {}),
  icons: () => call<IconList>('GET', '/api/icons'),
  uploadIcon,
  removeIcon: (ref: string) => call<Json>('DELETE', `/api/icons/${ref}`),
  tools: () => call<{ items: Tool[] }>('GET', '/api/tools').then((r) => r.items),
  createTool: (t: Json) => call<Tool>('POST', '/api/tools', t),
  updateTool: (id: string, patch: Json) => call<Tool>('PATCH', `/api/tools/${id}`, patch),
  removeTool: (id: string) => call<Json>('DELETE', `/api/tools/${id}`),
};

/** SSE の本文を `data:` のイベントに分ける。チャンクの切れ目をまたぐ分は buf に残す */
export function parseSse(buf: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  let i: number;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i); buf = buf.slice(i + 2);
    const line = block.split('\n').find((l) => l.startsWith('data:'));
    if (line) { try { events.push(JSON.parse(line.slice(5))); } catch { /* 壊れた行は捨てる */ } }
  }
  return { events, rest: buf };
}

/** チャットの SSE を購読する（認証ヘッダーを付けるため fetch で読む）。切れたら少し待って再接続する。戻り値の関数で停止。 */
export function streamChat(onEvent: (e: ChatEvent) => void, onState?: (connected: boolean, error?: string) => void): () => void {
  let stop = false;
  let ctl: AbortController | null = null;
  (async function loop() {
    let wait = 1000;
    while (!stop) {
      try {
        ctl = new AbortController();
        const res = await fetch('/api/chat/stream', { signal: ctl.signal });
        if (res.status === 401) { toLogin(); return; }
        if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${res.status}`);
        onState?.(true); wait = 1000;
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const r = parseSse(buf + dec.decode(value, { stream: true }));
          buf = r.rest;
          for (const e of r.events) onEvent(e as ChatEvent);
        }
        onState?.(false);   // サーバー側が正常に閉じた
      } catch (e) { if (stop) return; onState?.(false, (e as Error).message); }
      if (stop) return;
      await new Promise((r) => setTimeout(r, wait)); wait = Math.min(wait * 2, 15000);
    }
  })();
  return () => { stop = true; ctl?.abort(); };
}
