'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { buildFlowView } from '@/lib/flow-model';
import { entityIconUrl } from '@/lib/icons';
import { loadTheme } from '@/lib/theme';
import { newTrace } from '@/lib/trace-model';
import type { DelegationRow, DockerStatus, Entity, Health } from '@/lib/types';
import { Chat, type TraceState } from './Chat';
import { Dock } from './Dock';
import { EntityDialog, EntityList, type ListFilter } from './EntityList';
import { FlowView } from './FlowView';
import { Icon } from './Icon';
import { Gate, UserMenu, useMe } from './Gate';
import { ToastProvider, useToast } from './Toast';
import { TerminalWindows } from './TerminalWindows';

function Portal() {
  const toast = useToast();
  const me = useMe();
  const admin = !me || me.role === 'admin';   // ログイン無効のとき（me なし）は全員が管理者
  const [items, setItems] = useState<Entity[]>([]);
  const [statuses, setStatuses] = useState<Record<string, DockerStatus>>({});
  const [delegation, setDelegation] = useState<DelegationRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [ts, setTs] = useState<TraceState>({ trace: newTrace(), lines: [], version: 0 });
  const [filter, setFilter] = useState<ListFilter>({ q: '', kind: '', collapsed: new Set() });
  const [con, setCon] = useState<Entity | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await api.list();
      setItems(list);
      const dockers = list.filter((e) => e.runtime.type === 'docker');
      const st = await Promise.all(dockers.map((e) => api.status(e.id).catch(() => ({ state: 'unknown' }) as DockerStatus)));
      setStatuses(Object.fromEntries(dockers.map((e, i) => [e.id, st[i]])));
    } catch (e) { toast((e as Error).message, true); }
  }, [toast]);
  const refreshDelegation = useCallback(() => { api.overview().then((o) => setDelegation(o.delegation)).catch(() => {}); }, []);

  useEffect(() => {
    void loadTheme(api.theme);
    void reload(); refreshDelegation();
    const h = () => api.health().then(setHealth).catch(() => setHealth(null));
    void h(); const t = setInterval(h, 15000);
    // 管理ページ（別のタブ）での変更に連動する（ADR 0048）: 画面に戻ったときと、見えている間は 20 秒ごとに、一覧と委任先を読み直す
    const sync = () => { if (document.visibilityState === 'visible') { void reload(); refreshDelegation(); } };
    const t2 = setInterval(sync, 20000);
    document.addEventListener('visibilitychange', sync); window.addEventListener('focus', sync);
    return () => { clearInterval(t); clearInterval(t2); document.removeEventListener('visibilitychange', sync); window.removeEventListener('focus', sync); };
  }, [reload, refreshDelegation]);

  const flow = useMemo(() => buildFlowView(delegation, items, ts.trace), [delegation, items, ts]);
  const sync = async () => { try { const r = await api.syncBuiltin(); toast(`取り込みました（新規 ${r.created.length} 件）`); await reload(); refreshDelegation(); } catch (e) { toast((e as Error).message, true); } };

  return (
    <>
      <header>
        <div className="brand">🐾 猫神さま Portal</div>
        <input type="search" placeholder="名前・説明・タグで検索" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })} aria-label="種別">
          <option value="">すべての種別</option><option value="suborchestrator">サブオーケストレーター</option><option value="agent">エージェント</option><option value="subagent">サブエージェント</option>
        </select>
        <button onClick={() => setFilter({ ...filter, collapsed: new Set() })} title="すべて展開"><Icon name="expand" />展開</button>
        <button onClick={() => setFilter({ ...filter, collapsed: new Set(items.filter((e) => items.some((c) => c.parent_id === e.id)).map((e) => e.id)) })} title="すべて折りたたむ"><Icon name="list" />折りたたみ</button>
        <span className="grow" />
        {admin && <a className="navlink" href="/admin" title="猫神さま（管理者エージェント）の管理ページ"><Icon name="settings" />猫神さま管理</a>}
        <span className={`pill ${health?.ok ? 'ok' : 'ng'}`} title="バックエンドの状態">{health ? (health.ok ? 'API 正常' : 'API 異常') : 'API 未接続'}</span>
        {admin && <button onClick={sync} title=".claude/agents と Agent Console を台帳に取り込む"><Icon name="download" />組み込みを取り込み</button>}
        {admin && <EntityDialog items={items} onSaved={async () => { await reload(); refreshDelegation(); }}><button className="primary"><Icon name="add" />追加</button></EntityDialog>}
        <UserMenu />
      </header>
      <Dock panels={{
        list: <EntityList items={items} statuses={statuses} filter={filter} onFilter={setFilter} reload={async () => { await reload(); refreshDelegation(); }} openConsole={setCon} />,
        chat: <Chat onTrace={setTs} onNewRequest={refreshDelegation} nekoIcon={entityIconUrl(items.find((e) => e.protected), 'orchestrator')} />,
        flow: (<>
          <div className="pane-head" data-handle title="ドラッグして、別の位置へ"><span className="grip">⠿</span><strong>委任フロー</strong><span className="hint">{flow.agentsRun ? `— ${flow.agentsRun} 回の呼び出し` : ''}</span></div>
          <div className="panel-body"><FlowView view={flow} entities={items} /></div></>),
      }} />
      <TerminalWindows ts={ts} entities={items} />
      <Dialog.Root open={!!con} onOpenChange={(o) => !o && setCon(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dlg-overlay" />
          <Dialog.Content className="dlg console" aria-describedby={undefined}>
            <div className="cd-head">
              <Dialog.Title asChild><strong>Agent Console{con ? ` — ${con.name}` : ''}</strong></Dialog.Title><span className="grow" />
              {con && <a href={`/console?target=${encodeURIComponent(con.name)}`} target="_blank" rel="noopener">別タブで開く ↗</a>}
              <Dialog.Close asChild><button aria-label="閉じる">✕</button></Dialog.Close>
            </div>
            {con && <iframe id="cdFrame" title="Agent Console" src={`/console?target=${encodeURIComponent(con.name)}`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export default function PortalApp() { return <ToastProvider><Portal /></ToastProvider>; }
