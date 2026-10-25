'use client';
// Agent Console: 相手を選んで会話し、フロー図とトレース（フック）を見る。Console サーバー（Node, :4317）の SSE と API を使う。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyTheme } from '@/lib/theme';
import { MAX_TIMELINE, buildConsoleFlow, catPattern, fmtDur, handleTrace, modelClass, modelLabel, newStore, type ConsoleStore, type TargetInfo, type TraceInput } from '@/lib/console-model';
import { Markdown } from './Markdown';

const API = '/api/console';
const post = (path: string, body: unknown) => fetch(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getJson = <T,>(path: string) => fetch(`${API}/${path}`).then((r) => r.json() as Promise<T>);
const fmtT = (ts: number) => new Date(ts).toLocaleTimeString('ja-JP', { hour12: false });

interface ChatMsg { id: number; cls: 'user' | 'assistant' | 'meta' | 'error'; text: string; streaming?: boolean }
type ChatEv = { kind: 'chat'; agent?: string; type: string; text?: string; cost?: number; modelUsage?: Record<string, { costUSD?: number }>; isError?: boolean; subtype?: string; turns?: number; durationMs?: number };

export function CatIcon({ model, name, running }: { model: string; name: string; running?: boolean }) {
  const p = catPattern(name);
  return (
    <svg className={`cat ${modelClass(model)} ${running ? 'run' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 9 5 3l5 3.5q2-.5 4 0L19 3l1 6q1 2 .5 5-1.5 6-8.5 6T3.5 14Q3 11 4 9Z" />
      {p === 1 && <path d="M10.5 7.4v2M12 7.2v2.2M13.5 7.4v2" stroke="#0b1016" strokeWidth=".9" strokeLinecap="round" opacity=".55" />}
      {p === 2 && <ellipse cx="15.2" cy="11.6" rx="2.6" ry="2.8" fill="#0b1016" opacity=".3" />}
      {p === 3 && <><circle cx="7" cy="16" r="1" fill="#fff" opacity=".35" /><circle cx="17" cy="16" r="1" fill="#fff" opacity=".35" /></>}
      <ellipse className="eye" cx="9" cy="12" rx="1.3" ry="1.6" /><ellipse className="eye" cx="15" cy="12" rx="1.3" ry="1.6" />
      <path d="m11 14.2h2l-1 1.2Z" fill="#ff9db0" /><path d="M5.5 14.5 2 14M5.5 16 2.5 17M18.5 14.5 22 14M18.5 16l3 1" stroke="currentColor" strokeWidth=".8" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

export default function ConsoleApp() {
  const [conn, setConn] = useState(false);
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [session, setSession] = useState('—');
  const [ids, setIds] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'tool' | 'agent' | 'err'>('all');
  const [tick, setTick] = useState(0);
  const [input, setInput] = useState('');
  const [showDocs, setShowDocs] = useState(false);
  const [chatW, setChatW] = useState<number | null>(null);

  const store = useRef<ConsoleStore>(newStore());
  const ctx = useRef({ agentModels: {} as Record<string, string>, mainModel: 'opus' });
  const defaultAgent = useRef<string | null>(null);
  const cur = useRef<string | null>(null); cur.current = current;
  const chatBuf = useRef(new Map<string, ChatEv[]>()), traceBuf = useRef(new Map<string, TraceInput[]>());
  const seq = useRef(0), logEl = useRef<HTMLDivElement>(null);
  const bump = () => setTick((t) => t + 1);

  const applyChat = useCallback((ev: ChatEv) => {
    const add = (cls: ChatMsg['cls'], text: string, streaming = false) => setMsgs((m) => [...m, { id: ++seq.current, cls, text, streaming }]);
    switch (ev.type) {
      case 'user': add('user', ev.text || ''); break;
      case 'idle': setMsgs((m) => m.filter((x) => !(x.streaming && !x.text)).map((x) => ({ ...x, streaming: false }))); break;
      case 'message_start': setMsgs((m) => [...m.map((x) => ({ ...x, streaming: false })), { id: ++seq.current, cls: 'assistant', text: '', streaming: true }]); break;
      case 'delta': setMsgs((m) => { const l = m[m.length - 1]; return l?.streaming ? [...m.slice(0, -1), { ...l, text: l.text + (ev.text || '') }] : [...m, { id: ++seq.current, cls: 'assistant', text: ev.text || '', streaming: true }]; }); break;
      case 'assistant_full': add('assistant', ev.text || ''); break;
      case 'result': {
        if (typeof ev.cost === 'number') store.current.stats.cost = ev.cost;
        const per = ev.modelUsage ? Object.entries(ev.modelUsage).map(([m, u]) => `${modelLabel(m)} $${(u.costUSD ?? 0).toFixed(4)}`).join(' · ') : '';
        add('meta', `${ev.isError ? `⚠ ${ev.subtype || 'error'} · ` : ''}${ev.turns ?? '-'} turns · ${ev.durationMs ? fmtDur(ev.durationMs) : '-'} · 累計 $${(ev.cost ?? 0).toFixed(4)}${per ? `（${per}）` : ''}`); bump(); break;
      }
      case 'error': add('error', ev.text || ''); break;
    }
  }, []);

  const rebuild = useCallback((target: string | null) => {   // 相手を切り替えたとき: フロー・トレース・会話をその相手のものに組み直す
    store.current = newStore(); setMsgs([]);
    for (const ev of traceBuf.current.get(target || '') || []) handleTrace(store.current, ev, ctx.current);
    for (const ev of chatBuf.current.get(target || '') || []) applyChat(ev);
    bump();
  }, [applyChat]);

  const pickTarget = useCallback((items: TargetInfo[], want?: string | null) => {
    let saved: string | null = null, fromUrl: string | null = null;
    try { saved = localStorage.getItem('console.target'); } catch { /* 保存不可 */ }
    try { fromUrl = new URL(location.href).searchParams.get('target'); } catch { /* 不正な URL */ }
    const has = (n: string | null | undefined) => !!n && items.some((t) => t.name === n);
    return has(want) ? want! : has(fromUrl) ? fromUrl! : has(saved) ? saved! : defaultAgent.current && has(defaultAgent.current) ? defaultAgent.current : items[0]?.name ?? null;
  }, []);

  useEffect(() => {
    fetch('/api/theme').then((r) => r.json()).then((t) => applyTheme(t)).catch(() => {});
    const loadIds = () => getJson<Record<string, string>>('ids').then((d) => setIds(d || {})).catch(() => {});
    const es = new EventSource('/api/console-events');
    es.onopen = () => setConn(true); es.onerror = () => setConn(false);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      const tgt = (e: { agent?: string; chat?: string | null }) => e.agent || e.chat || defaultAgent.current || '';
      switch (ev.kind) {
        case 'hello': {
          loadIds(); defaultAgent.current = ev.defaultAgent || null; ctx.current.agentModels = ev.agents || {};
          chatBuf.current.clear(); traceBuf.current.clear();
          setTargets(ev.targets || []); const t = pickTarget(ev.targets || [], cur.current); setCurrent(t);
          if (ev.sessionId) setSession(`session ${String(ev.sessionId).slice(0, 8)}`);
          setRunning(new Set(ev.runningTargets || [])); store.current = newStore(); setMsgs([]); bump(); break;
        }
        case 'reset':
          if (ev.agent) { chatBuf.current.delete(ev.agent); traceBuf.current.delete(ev.agent); } else { chatBuf.current.clear(); traceBuf.current.clear(); }
          if (!ev.agent || ev.agent === cur.current) rebuild(cur.current); break;
        case 'session':
          if (ev.agent && ev.agent !== cur.current) break;
          setSession(`session ${String(ev.sessionId).slice(0, 8)}`); if (ev.model) ctx.current.mainModel = ev.model; if (ev.agents) ctx.current.agentModels = ev.agents; bump(); break;
        case 'hook': case 'permission': case 'sdk': {
          const t = ev.chat || defaultAgent.current || '';
          const b = traceBuf.current.get(t) || []; b.push(ev); if (b.length > 3000) b.shift(); traceBuf.current.set(t, b);
          if (t === cur.current) { handleTrace(store.current, ev, ctx.current); bump(); }
          break;
        }
        case 'chat': {
          const t = tgt(ev); const b = chatBuf.current.get(t) || [];
          if (ev.type !== 'busy' && ev.type !== 'idle') b.push(ev); chatBuf.current.set(t, b);
          if (ev.type === 'busy') setRunning((s) => new Set(s).add(t));
          if (ev.type === 'idle') setRunning((s) => { const n = new Set(s); n.delete(t); return n; });
          if (t === cur.current) applyChat(ev); break;
        }
      }
    };
    return () => es.close();
  }, [applyChat, pickTarget, rebuild]);

  useEffect(() => { if (current !== null) rebuild(current); }, [current, rebuild]);   // 相手の切り替え（初回の hello 直後も含む）
  useEffect(() => { const el = logEl.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);

  // ポータルで追加・削除した相手を、再読み込みなしで一覧に反映する
  useEffect(() => {
    const refresh = async () => {
      try {
        const d = await getJson<{ items: TargetInfo[] }>('targets');
        setTargets((old) => {
          if (JSON.stringify(old) === JSON.stringify(d.items)) return old;
          if (!d.items.some((t) => t.name === cur.current)) setCurrent(pickTarget(d.items, null));
          return d.items;
        });
      } catch { /* 次回に */ }
    };
    const t = setInterval(refresh, 10000); const vis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', vis); return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [pickTarget]);

  const busy = !!current && running.has(current);
  const tgt = targets.find((t) => t.name === current);
  const flow = useMemo(() => buildConsoleFlow(store.current, tgt, ctx.current), [tgt, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const s = store.current;
  const shown = s.timeline.filter((e) => filter === 'all' || (filter === 'err' ? e.err || e.cls === 'deny' || e.cls === 'err' : e.cat === filter));
  const runningCount = [...s.agents.values()].filter((a) => a.status === 'running').length;

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const r = await post('chat', { message: text, agent: current });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setMsgs((m) => [...m, { id: ++seq.current, cls: 'error', text: j.error || r.statusText }]); }
  };
  const [dark, setDark] = useState(true);
  const toggleTheme = () => { const n = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = n; setDark(n === 'dark'); try { localStorage.setItem('console.theme', n); } catch { /* 保存不可 */ } };
  useEffect(() => { try { const t = localStorage.getItem('console.theme'); if (t && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = t; } catch { /* 保存不可 */ } }, []);
  void dark;

  const dragChat = (e: React.PointerEvent) => {
    e.preventDefault(); const main = (e.currentTarget as HTMLElement).parentElement!; document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => setChatW(Math.max(280, Math.min(main.clientWidth - 360, ev.clientX - main.getBoundingClientRect().left - 12)));
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const uid = (n: string) => (ids[n] ? <span className="uid" title={`担当 UUID: ${ids[n]}`}>{ids[n].slice(0, 8)}</span> : null);

  return (
    <>
      <header>
        <div className="brand"><span className={`dot${conn ? ' on' : ''}`} />Agent Console</div>
        <label className="stat" title="話しかける相手（猫神さま・サブオーケストレーター・エージェント）。会話は相手ごとに別">相手{' '}
          <select value={current || ''} onChange={(e) => { setCurrent(e.target.value); try { localStorage.setItem('console.target', e.target.value); } catch { /* 保存不可 */ } }} style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px' }}>
            {targets.map((t) => <option key={t.name} value={t.name} title={t.description}>{t.label + (t.type === 'agent' ? '（エージェント）' : '')}</option>)}
          </select></label>
        <span className="stat mono" title="セッションID">{session}</span>
        <div className="stats">
          <span className="stat">稼働中<b>{runningCount}</b></span><span className="stat">ツール呼出<b>{s.stats.tools}</b></span>
          <span className="stat">エラー/拒否<b>{s.stats.err}</b></span><span className="stat">コスト<b>${s.stats.cost.toFixed(2)}</b></span>
          <button className="iconbtn" onClick={toggleTheme} title="テーマ切替">◐</button>
        </div>
      </header>
      <AuthBar />
      <main style={chatW ? { ['--chat-w' as string]: `${chatW}px` } : undefined}>
        <section className="panel">
          <h2><span className="grow">チャット</span><button className="iconbtn" onClick={() => setShowDocs(true)} title="reports/ と research/ の保存済みマークダウン">📄 保存済み</button>
            <button className="iconbtn" disabled={busy} onClick={() => void post('reset', { agent: current })}>新しい会話</button></h2>
          <div id="chatLog" ref={logEl}>
            {!msgs.length && <div className="empty">{tgt ? `${tgt.label} に話しかけてください。会話は相手ごとに別です。` : '接続中…'}</div>}
            {msgs.map((m) => (
              <div key={m.id} className={`msg ${m.cls}`}>{m.cls === 'assistant' && !m.streaming ? <Markdown text={m.text} /> : m.text}</div>
            ))}
            {busy && <div className="msg typing"><img src="/neko-run.gif" alt="考え中" width={64} style={{ verticalAlign: 'middle', imageRendering: 'pixelated' }} /> エージェントが作業中…（右のトレースで進捗を確認できます）</div>}
          </div>
          <form id="chatForm" onSubmit={(e) => { e.preventDefault(); const t = input; setInput(''); void send(t); }}>
            <textarea id="chatInput" rows={1} value={input} onChange={(e) => setInput(e.target.value)} placeholder="メッセージ（Enterで送信 / Shift+Enterで改行）"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
            <button className="btn secondary" type="button" disabled={!busy} onClick={() => void post('stop', { agent: current })}>停止</button>
            <button className="btn" type="submit" disabled={busy}>送信</button>
          </form>
        </section>
        <div className="splitter v" onPointerDown={dragChat} onDoubleClick={() => setChatW(null)} title="ドラッグで幅を変更（ダブルクリックで戻す）" />
        <div className="right">
          <section className="panel">
            <h2><span className="grow">エージェント フロー</span><span>{flow.agentsRun}</span></h2>
            <div id="flow">
              <div className="fl-title"><b>{flow.title}</b> <i>▸ フロー</i></div>
              <div className="fl-legend">{flow.legend.map((m) => <span key={m} className={modelClass(m)}>{modelLabel(m)}</span>)}</div>
              <div className={`fl-orch${flow.orch.state === '実行中' ? ' running' : ''}`}>
                <div className="nm">{current === 'nekogamisama' ? <img className="goddess" src="/neko-goddess.png" width={22} height={22} alt="" /> : <CatIcon model={flow.orch.model} name="orchestrator" running={flow.orch.state === '実行中'} />}{flow.orch.label}{current && uid(current)}</div>
                <div className="sub">{flow.orch.model} · {flow.orch.state}{flow.orch.elapsed && ` · ${flow.orch.elapsed}`}{flow.orch.tools != null && ` · ツール ${flow.orch.tools}`}</div>
                <div className="cur">{flow.orch.cur}</div>
              </div>
              <div className={`fl-wire${flow.anyRun ? ' on' : ''}`} />
              <div className="fl-cards">
                {flow.cards.map((c) => (
                  <div key={c.key} className={`fl-card ${modelClass(c.model)} ${c.state}`}>
                    <div className="hd"><span className="nm"><CatIcon model={c.model} name={c.key} running={c.state === 'run'} />{c.name}</span><span className="md">{c.roleLabel}</span></div>
                    <div className="id">{uid(c.key)}</div>
                    <div className="fl-bar"><i style={{ width: `${c.pct}%` }} /></div>
                    <div className="st"><b>{c.label}</b><span>ツール {c.tools}</span></div>
                    <div className="fl-dots">{c.dots.map((d, i) => <i key={i} className={d} />)}</div>
                    <div className="cur">{c.cur}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <div className="splitter h" />
          <section className="panel">
            <h2><span className="grow">トレース（新しい順）</span>
              <span className="filters">{([['all', 'すべて'], ['tool', 'ツール'], ['agent', 'エージェント'], ['err', 'エラー/拒否']] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</span></h2>
            <div id="timeline">
              {shown.slice(0, MAX_TIMELINE).map((e) => (
                <details key={e.id} className={`ev ${e.cls}${e.pending ? ' pending' : ''}${e.err ? ' err' : ''}`}>
                  <summary><span className="t">{fmtT(e.ts)}</span><span className="who"><CatIcon model={e.model || ''} name={e.who} /><span>{e.who}</span></span><span className="kind">{e.kind}</span><span className="sum">{e.sum}</span><span className="dur">{e.durMs != null ? fmtDur(e.durMs) : ''}</span></summary>
                  {[...e.details, ...(e.extra || [])].filter(([, v]) => v).map(([k, v], i) => <div key={i}><div className="lbl">{k}</div><pre>{v}</pre></div>)}
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
      {showDocs && <DocsModal onClose={() => setShowDocs(false)} />}
    </>
  );
}

function AuthBar() {
  const [a, setA] = useState<{ loggedIn: boolean; login?: { state: string; url?: string; log?: string } } | null>(null);
  const [code, setCode] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refresh = useCallback(async () => {
    let s; try { s = await getJson<NonNullable<typeof a>>('auth/status'); } catch { return; }
    setA(s); clearTimeout(timer.current);
    const flow = s.login && ['starting', 'waiting_code', 'verifying'].includes(s.login.state);
    if (flow || (!s.loggedIn && s.login)) timer.current = setTimeout(refresh, 1500);
  }, []);
  useEffect(() => { void refresh(); return () => clearTimeout(timer.current); }, [refresh]);
  if (!a) return null;
  const l = a.login, inFlow = !!l && ['starting', 'waiting_code', 'verifying'].includes(l.state), waiting = l?.state === 'waiting_code';
  if (a.loggedIn && !inFlow) return null;
  const start = async (mode: string) => { await post('auth/login', { mode }); void refresh(); };
  const msg = a.loggedIn ? 'ログインしました。' : l?.state === 'starting' ? 'ログインを準備中…' : waiting ? 'ページで認証し、表示されたコードを貼り付けてください。' : l?.state === 'verifying' ? '確認中…' : l?.state === 'failed' ? `ログインに失敗しました。${l.log ? ` ${l.log}` : ''}` : 'Claude にログインしていません。';
  return (
    <div id="authBar" className="show">
      <span>{msg}</span>
      {!inFlow && <><button className="btn" onClick={() => start('claudeai')}>Claude にログイン</button><button className="btn secondary" title="API 従量課金" onClick={() => start('console')}>Console でログイン</button></>}
      {inFlow && l?.url && <a href={l.url} target="_blank" rel="noopener noreferrer">① 認証ページを開く</a>}
      {waiting && <><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="② 表示されたコードを貼り付け" /><button className="btn" onClick={async () => { const c = code; setCode(''); await post('auth/code', { code: c }); void refresh(); }}>送信</button></>}
    </div>
  );
}

function DocsModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<{ path: string; name: string; dir: string; mtime: number }[] | null>(null);
  const [sel, setSel] = useState(''), [body, setBody] = useState('');
  const open = useCallback(async (path: string) => {
    setSel(path); setBody('読み込み中…');
    try { const r = await fetch(`${API}/doc?path=${encodeURIComponent(path)}`); if (!r.ok) throw new Error(String(r.status)); setBody(await r.text()); }
    catch (e) { setBody(`読み込めませんでした: ${(e as Error).message}`); }
  }, []);
  useEffect(() => {
    getJson<{ items: NonNullable<typeof items> }>('docs').then((d) => { setItems(d.items); if (d.items[0]) void open(d.items[0].path); }).catch(() => setItems([]));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);
  return (
    <div id="docModal" className="show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div id="docBox">
        <header className="panel" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, border: 0, borderBottom: '1px solid var(--line)', borderRadius: 0 }}>
          <b style={{ flex: 1 }}>保存済みドキュメント</b><span style={{ color: 'var(--muted)', fontSize: 12 }}>{sel}</span><button className="iconbtn" onClick={onClose}>✕ 閉じる</button></header>
        <div id="docList">
          {items?.length === 0 && <div style={{ padding: 12, color: 'var(--muted)' }}>保存済みのマークダウンはまだありません</div>}
          {items?.map((i) => <button key={i.path} className={i.path === sel ? 'on' : ''} onClick={() => void open(i.path)}>{i.name}<small>{i.dir}/ · {new Date(i.mtime).toLocaleString('ja-JP', { hour12: false })}</small></button>)}
        </div>
        <div id="docView"><Markdown text={body} /></div>
      </div>
    </div>
  );
}
