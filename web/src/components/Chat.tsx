'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamChat } from '@/lib/api';
import { helpText, matchCommands } from '@/lib/commands';
import { newTrace, reduce, type LogLine, type Trace } from '@/lib/trace-model';
import type { ChatCommand, ChatEvent } from '@/lib/types';
import { AnswerBody } from './Markdown';

interface Msg { id: number; role: 'user' | 'assistant' | 'meta' | 'error' | 'help'; text: string; ts: number; streaming?: boolean }

export interface TraceState { trace: Trace; lines: LogLine[]; version: number }

/** 猫神さまとのチャット。トレースの更新は onTrace で親（委任フロー・トレースのパネル）へ渡す */
export function Chat({ onTrace, onNewRequest, nekoIcon = '/neko-goddess.png' }: { onTrace: (s: TraceState) => void; onNewRequest: () => void; nekoIcon?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState<{ ok: boolean; why?: string }>({ ok: false });
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  const [input, setInput] = useState('');
  const [menuIdx, setMenuIdx] = useState(0);
  const [consoleUrl, setConsoleUrl] = useState('');
  const seq = useRef(0), traceRef = useRef<TraceState>({ trace: newTrace(), lines: [], version: 0 });
  const logEl = useRef<HTMLDivElement>(null), inputEl = useRef<HTMLTextAreaElement>(null);
  const cb = useRef({ onTrace, onNewRequest }); cb.current = { onTrace, onNewRequest };

  const add = useCallback((role: Msg['role'], text: string, extra: Partial<Msg> = {}) => setMsgs((m) => [...m, { id: ++seq.current, role, text, ts: Date.now(), ...extra }]), []);
  const resetTrace = useCallback(() => { traceRef.current = { trace: newTrace(), lines: [], version: traceRef.current.version + 1 }; cb.current.onTrace(traceRef.current); }, []);

  useEffect(() => {
    api.chatCommands().then(setCommands).catch(() => {});
    api.health().then((h) => setConsoleUrl(h.console || '')).catch(() => {});
    const onEvent = (ev: ChatEvent) => {
      switch (ev.kind) {
        case 'hello': setMsgs([]); resetTrace(); setBusy(ev.running); break;
        case 'reset': setMsgs([]); resetTrace(); break;
        case 'trace': {
          const row = reduce(traceRef.current.trace, ev);
          if (row) traceRef.current.lines = [...traceRef.current.lines, row];
          traceRef.current.version += 1; cb.current.onTrace({ ...traceRef.current }); break;
        }
        case 'chat':
          switch (ev.type) {
            case 'user': setMsgs((m) => [...m, { id: ++seq.current, role: 'user', text: ev.text, ts: Date.now() }]); resetTrace(); cb.current.onNewRequest(); break;
            case 'busy': setBusy(true); break;
            case 'idle': setBusy(false); setMsgs((m) => m.filter((x) => !(x.streaming && !x.text)).map((x) => ({ ...x, streaming: false }))); break;
            case 'message_start': setMsgs((m) => [...m.map((x) => ({ ...x, streaming: false })), { id: ++seq.current, role: 'assistant', text: '', ts: Date.now(), streaming: true }]); break;
            case 'delta': setMsgs((m) => {
              const last = m[m.length - 1];
              return last?.streaming ? [...m.slice(0, -1), { ...last, text: last.text + ev.text }] : [...m, { id: ++seq.current, role: 'assistant', text: ev.text, ts: Date.now(), streaming: true }];
            }); break;
            case 'assistant_full': add('assistant', ev.text); break;
            case 'result': add('meta', `${ev.isError ? `⚠ ${ev.subtype || 'error'} · ` : ''}${ev.turns ?? '-'} turns · ${ev.durationMs ? `${(ev.durationMs / 1000).toFixed(1)}s` : '-'} · 累計 $${(ev.cost ?? 0).toFixed(4)}`); break;
            case 'error': add('error', ev.text); break;
          }
      }
    };
    return streamChat(onEvent, (ok, why) => setConn({ ok, why }));
  }, [add, resetTrace]);

  // `idle` を受け損ねても「作業中…」が残らないよう、応答中の間は数秒おきにサーバーの実際の状態と照合する
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { api.chatStatus().then((s) => { if (!s.running) setBusy(false); }).catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => { const el = logEl.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);

  const menu = matchCommands(input, commands);
  const send = async () => {
    const text = input;
    if (!text.trim() || busy) return;
    if (text.trim() === '/help') { add('help', helpText(commands)); setInput(''); return; }
    try { await api.chatSend(text); setInput(''); }
    catch (e) {
      add('error', (e as Error).message);
    }
  };
  const pick = (i: number) => { const c = menu?.[i]; if (c) { setInput(`/${c.name} `); inputEl.current?.focus(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (menu?.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIdx((i) => (i + 1) % menu.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIdx((i) => (i - 1 + menu.length) % menu.length); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); pick(menuIdx); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
  };

  const time = (ts: number) => new Date(ts).toLocaleTimeString('ja-JP', { hour12: false, hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <div className="pane-head chat-head" data-handle title="ドラッグして、別の位置へ">
        <span className="grip">⠿</span><strong>🐾 猫神さまとチャット</strong>
        <span className={`pill ${conn.ok ? 'ok' : 'ng'}`} title={conn.ok ? '' : 'Agent Console が動いているか確認してください'}>{conn.ok ? '接続中' : conn.why ? `切断: ${conn.why}` : '再接続中…'}</span>
        <span className="grow" />
        <button onClick={() => { if (window.confirm('猫神さまとの会話をリセットしますか？')) api.chatReset().catch((e) => add('error', e.message)); }}>リセット</button>
      </div>
      <div className="panel-body chat-body">
        <div id="chatLog" ref={logEl} aria-live="polite">
          {!msgs.length && !busy && <div className="msg chat-empty">猫神さまに話しかけてください。「/」でサブオーケストレーター・エージェントを指名できます。</div>}
          {msgs.map((m) => m.role === 'user' || m.role === 'assistant' ? (
            <div key={m.id} className={`row ${m.role}`}>
              {m.role === 'assistant' && <img className="av" src={nekoIcon} alt="猫神さま" width={36} height={36} />}
              <div className="col">
                <div className={`msg ${m.role}${m.role === 'assistant' && !m.streaming ? ' rendered' : ''}`}>
                  {m.role === 'assistant' && !m.streaming ? <AnswerBody text={m.text} /> : m.text}
                </div>
                <time>{time(m.ts)}</time>
              </div>
            </div>
          ) : <div key={m.id} className={`msg ${m.role}`}>{m.text}</div>)}
          {busy && (
            <div className="row assistant typing">
              <img className="av" src={nekoIcon} alt="" width={36} height={36} />
              <div className="msg assistant thinking"><img className="run" src="/sun-cat-running.gif" alt="考え中" width={96} height={96} /> 猫神さまが作業中…</div>
            </div>
          )}
        </div>
        <form id="chatForm" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {menu && (
            <div id="cmdMenu" role="listbox" aria-label="コマンド">
              {menu.length ? menu.map((c, i) => (
                <div key={c.name} role="option" aria-selected={i === menuIdx} className={`cmd${i === menuIdx ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(i); }}>
                  <b>/{c.name}</b><small>{c.description}</small>
                  <span className="tag">{c.kind === 'delegate' ? `委任先（${c.type === 'agent' ? 'Agent ツール' : '別セッション'}）` : 'エージェント'}</span>
                </div>
              )) : <div className="none">一致するコマンドがありません（先頭に空白を入れると、/ で始まる文をそのまま送れます）</div>}
            </div>
          )}
          <textarea id="chatInput" ref={inputEl} rows={3} maxLength={8000} value={input} onChange={(e) => { setInput(e.target.value); setMenuIdx(0); }} onKeyDown={onKey}
            placeholder="猫神さまに話しかける（/ でサブオーケストレーター・エージェントを呼び出し、Ctrl+Enter で送信）" />
          <div className="chat-actions">
            <span className="hint">{consoleUrl ? `会話の実行: Agent Console（${consoleUrl}）` : ''}</span>
            <button type="button" disabled={!busy} onClick={() => api.chatStop().catch((e) => add('error', e.message))}>停止</button>
            <button type="submit" className="primary" disabled={busy}>送信</button>
          </div>
        </form>
      </div>
    </>
  );
}
