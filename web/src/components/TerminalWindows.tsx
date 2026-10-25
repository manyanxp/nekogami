'use client';
// エージェント・サブオーケストレーターごとのターミナル窓（ポータル）。実行中に自動で開き、終了すると自動で閉じる。タイトルバーのドラッグで動かせ、✕ で手動でも閉じられる。ADR 0033。
import { useEffect, useRef, useState } from 'react';
import { CLOSE_AFTER, WIN_H, WIN_W, clampPos, diffStates, freeSlot, linesOf, runStates } from '@/lib/terminal-model';
import type { Entity } from '@/lib/types';
import type { TraceState } from './Chat';
import { Avatar } from './IconPicker';

interface Win { name: string; x: number; y: number; z: number; ended: boolean }
const clock = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString('ja-JP', { hour12: false }) : '--:--:--');

export function TerminalWindows({ ts, entities }: { ts: TraceState; entities: Entity[] }) {
  const [wins, setWins] = useState<Win[]>([]);
  const prev = useRef<ReturnType<typeof runStates>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const top = useRef(10);

  const close = (name: string) => { clearTimeout(timers.current.get(name)); timers.current.delete(name); setWins((w) => w.filter((x) => x.name !== name)); };
  const front = (name: string) => setWins((w) => w.map((x) => (x.name === name ? { ...x, z: ++top.current } : x)));

  useEffect(() => {
    const next = runStates(ts.trace);
    const { open, finish } = diffStates(prev.current, next);
    prev.current = next;
    for (const n of open) {
      clearTimeout(timers.current.get(n)); timers.current.delete(n);
      setWins((w) => w.some((x) => x.name === n)
        ? w.map((x) => (x.name === n ? { ...x, ended: false, z: ++top.current } : x))
        : [...w, { name: n, ...freeSlot(w, window.innerWidth, window.innerHeight), z: ++top.current, ended: false }]);
    }
    for (const n of finish) {
      setWins((w) => w.map((x) => (x.name === n ? { ...x, ended: true } : x)));
      clearTimeout(timers.current.get(n));
      timers.current.set(n, setTimeout(() => close(n), CLOSE_AFTER));
    }
  }, [ts]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <div className="term-layer">
      {wins.map((w) => <Terminal key={w.name} win={w} lines={linesOf(ts.lines, w.name)} entity={entities.find((e) => e.name === w.name)}
        onClose={() => close(w.name)} onFront={() => front(w.name)} onMove={(x, y) => setWins((l) => l.map((o) => (o.name === w.name ? { ...o, ...clampPos(x, y, window.innerWidth, window.innerHeight) } : o)))} />)}
    </div>
  );
}

function Terminal({ win, lines, entity, onClose, onFront, onMove }: {
  win: Win; lines: TraceState['lines']; entity?: Entity; onClose: () => void; onFront: () => void; onMove: (x: number, y: number) => void;
}) {
  const body = useRef<HTMLDivElement>(null), drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => { const el = body.current; if (el) el.scrollTop = el.scrollHeight; }, [lines.length]);
  return (
    <section className={`term${win.ended ? ' ended' : ''}`} style={{ left: win.x, top: win.y, zIndex: win.z, width: WIN_W, height: WIN_H }} aria-label={`${win.name} のターミナル`} onPointerDown={onFront}>
      <header
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) onMove(e.clientX - drag.current.dx, e.clientY - drag.current.dy); }}
        onPointerUp={(e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); }}
        onPointerCancel={() => { drag.current = null; }} title="ドラッグして移動">
        <Avatar icon={entity?.icon} kind={entity?.kind || 'agent'} size={18} />
        <b>{win.name}</b>
        <span className="st">{win.ended ? '■ 終了（自動で閉じます）' : '● 実行中'}</span>
        <span className="grow" />
        <button type="button" onClick={onClose} aria-label="閉じる" title="閉じる">✕</button>
      </header>
      <div className="term-body" ref={body} role="log" aria-live="off">
        {lines.map((l, i) => <div key={i} className={`ln ${l.cls}`}><span className="t">{clock(l.ts)}</span><span className="p">{l.sub ? '  ›' : '›'}</span> {l.text}</div>)}
        {!win.ended && <div className="ln"><span className="p">›</span> <i className="cur" /></div>}
      </div>
    </section>
  );
}
