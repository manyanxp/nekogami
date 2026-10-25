'use client';
import type { FlowView as View } from '@/lib/flow-model';
import type { Entity } from '@/lib/types';
import { Avatar } from './IconPicker';

const VIA: Record<string, string> = { agent: 'Agent ツール', session: '別セッション' };

export function FlowView({ view, entities = [] }: { view: View; entities?: Entity[] }) {
  const neko = entities.find((e) => e.protected);
  const byName = (n: string) => entities.find((e) => e.name === n);
  const on = view.orch.state === 'run' || view.running > 0;
  return (
    <div id="flowView">
      <div className="fl-title"><b>{view.title}</b><i>▸</i>委任フロー</div>
      <div className="fl-legend">{view.legend.map((k) => <span key={k} className={`k-${k}`}>{k}</span>)}</div>
      <div className={`fl-box dashed${view.orch.state === 'run' ? ' on' : ''}`}>
        <div className="nm"><Avatar icon={neko?.icon} kind="orchestrator" size={28} />{view.title}</div>
        <div className="sub">{{ idle: '待機', run: '実行中', done: '完了' }[view.orch.state]}{view.orch.tools ? ` · ツール ${view.orch.tools}` : ''}</div>
        <div className="cur">{view.orch.cur}</div>
      </div>
      <div className={`fl-wire${on ? ' on' : ''}`} />
      <div className="fl-box">
        <div className="nm">選択</div>
        {view.routes.length
          ? <ul className="fl-routes">{view.routes.map((r, i) => <li key={i}>{r.to}（{VIA[r.via]}）{r.description && `: ${r.description}`}</li>)}</ul>
          : <div className="sub">呼び先はまだ選ばれていません</div>}
      </div>
      <div className={`fl-wire${on ? ' on' : ''}`} />
      <div className={`fl-cards${on ? ' on' : ''}`}>
        {view.cards.map((c) => (
          <div key={c.id} className={`fl-card ${c.kind} ${c.state}`} title={c.description}>
            <div className="hd"><span className="nm"><Avatar icon={byName(c.label)?.icon} kind={byName(c.label)?.kind || c.kind} size={18} />{c.label}</span><span className="md">{c.model}</span></div>
            <div className="fl-bar"><i style={{ width: `${c.pct}%` }} /></div>
            <div className="st"><b>{{ idle: '待機', run: '実行中', done: '完了' }[c.state]}</b><span>{c.inst ? `${c.fin}/${c.inst}` : ''}{c.tools ? ` · ツール ${c.tools}` : ''}</span></div>
            <div className="fl-dots">{c.children.map((k) => <i key={k.name} className={k.state === 'idle' ? '' : k.state} title={k.name} />)}</div>
            <div className="cur">{c.cur}</div>
          </div>
        ))}
      </div>
      <div className={`fl-wire${view.final.state !== 'idle' ? ' on' : ''}`} />
      <div className={`fl-box${view.final.state === 'done' ? ' on' : ''}`}><div className="nm">回答</div><div className="sub">{{ idle: '待機', run: '統合中', done: '完了' }[view.final.state]}</div></div>
    </div>
  );
}
