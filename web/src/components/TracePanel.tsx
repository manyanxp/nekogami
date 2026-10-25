'use client';
import { useEffect, useRef } from 'react';
import type { LogLine, Trace } from '@/lib/trace-model';
import { stateOf, statsOf } from '@/lib/flow-model';
import type { Entity } from '@/lib/types';

const clock = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString('ja-JP', { hour12: false }) : '');

export function TraceChips({ trace, entities }: { trace: Trace; entities: Entity[] }) {
  const kindOf = (n: string) => entities.find((e) => e.name === n)?.kind || 'unknown';
  return (
    <div id="traceChips" aria-label="選ばれたエージェント">
      {[...trace.agents].map(([name, a]) => {
        const s = statsOf(a), st = stateOf(s);
        return (
          <span key={name} className={`chip ${kindOf(name)} ${st === 'idle' ? '' : st}`} title={`${name}${a.via ? `（${a.via === 'session' ? '別セッションに委任' : 'Agent ツール'}）` : ''}`}>
            <b>{name}</b><small>{`${a.via === 'session' ? '委任' : ''}${s.tools ? ` ツール ${s.tools}` : ''}`.trim()}</small>
          </span>
        );
      })}
    </div>
  );
}

export function TraceLog({ lines, entities }: { lines: LogLine[]; entities: Entity[] }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [lines.length]);
  const kindOf = (n: string) => (n === '猫神さま' ? 'orchestrator' : entities.find((e) => e.name === n)?.kind || '');
  return (
    <ol id="traceLog">
      {lines.map((r, i) => (
        <li key={i} ref={i === lines.length - 1 ? end : undefined} className={r.cls}>
          <span className="t">{clock(r.ts)}</span><span className={`who ${kindOf(r.who)}`}>{r.who}</span><span className="w">{(r.sub ? '  ' : '') + r.text}</span>
        </li>
      ))}
    </ol>
  );
}
