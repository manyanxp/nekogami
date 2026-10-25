'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { DANGEROUS_TOOLS, canConnect, childKinds, isRiskyDir, permLabels } from '@/lib/graph-model';
import { KIND_LABEL } from '@/lib/model';
import { loadTheme } from '@/lib/theme';
import type { DelegationRow, Entity, Kind, Overview, Tool } from '@/lib/types';
import { UsersCard } from './AdminUsers';
import { UserMenu } from './Gate';
import { Icon } from './Icon';
import { DelegationCard, GodCard, Inspector, PersonalityCard, ThemeCard } from './AdminCards';
import { AddDialog, DelegationDialog, type AddSpec } from './AdminDialogs';
import { AdminGraph, type CtxTarget, type Sel } from './AdminGraph';
import * as Dialog from '@radix-ui/react-dialog';
import { Avatar } from './IconPicker';
import { ToastProvider, useToast } from './Toast';

type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

function Admin() {
  const toast = useToast();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [adding, setAdding] = useState<AddSpec | null>(null);
  const [editId, setEditId] = useState<string | null>(null);   // 右クリック →「編集…」で開くノードの編集ダイアログ
  const [del, setDel] = useState<{ open: boolean; row: DelegationRow | null }>({ open: false, row: null });
  const [menu, setMenu] = useState<{ x: number; y: number; items: ([string, () => void, { danger?: boolean; disabled?: boolean }?] | '---')[] } | null>(null);
  const live = useRef({ entities, tools, sel }); live.current = { entities, tools, sel };

  const guarded = useCallback<Guard>(async (fn) => {
    try { return await fn(); } catch (e) {   // 未ログイン（401）は api 側でログイン画面へ移る
      toast((e as Error).message, true);
      return undefined;
    }
  }, [toast]);

  const reload = useCallback(async (fit = false) => {
    const r = await guarded(() => Promise.all([api.list(), api.tools(), api.overview()]));
    if (!r) return;
    setEntities(r[0]); setTools(r[1]); setOverview(r[2]);
    if (fit) setFitKey((k) => k + 1);
  }, [guarded]);

  useEffect(() => {
    void loadTheme(api.theme);
    api.health().then(() => setOk(true)).catch(() => setOk(false));
    void reload(true);
  }, [reload]);

  const rename = useCallback(async (e: Entity) => {
    if (e.protected) return toast('猫神さまの名前は変更できません', true);
    const name = window.prompt(`${e.name} の新しい名前（英数字と . _ - のみ）`, e.name)?.trim();
    if (!name || name === e.name) return;
    const files = e.definition ? '定義ファイルの名前（と、配下がいればフォルダ）・委任先一覧の項目も変更します。' : '';
    if (!window.confirm(`${e.name} → ${name}\n${files}\n他のエージェントのプロンプトに書かれたこの名前は、自動では書き換わりません。よろしいですか？`)) return;
    await guarded(async () => { await api.update(e.id, { name }); toast(`名前を ${name} に変更しました`); await reload(); });
  }, [guarded, reload, toast]);

  const deleteSelected = useCallback(async () => {
    const { entities: ents, tools: tls, sel: s } = live.current;
    if (!s) return;
    if (s.type === 'edge') {
      if (!s.id.startsWith('tool:')) return toast('親子のワイヤーは削除できません', true);
      const [from, to] = s.id.split(':')[1].split('>'); const e = ents.find((x) => x.id === from)!;
      await guarded(async () => { await api.update(from, { tool_ids: e.tool_ids.filter((i) => i !== to) }); toast('接続を外しました'); await reload(); });
      return;
    }
    const e = ents.find((x) => x.id === s.id), t = tls.find((x) => x.id === s.id);
    if (e?.protected) return toast('猫神さま（管理者エージェント）は削除できません', true);
    if (e) {
      const kids = ents.filter((x) => x.parent_id === e.id).length;
      if (!window.confirm(kids ? `${e.name} と配下 ${kids} 件を削除しますか？` : `${e.name} を削除しますか？`)) return;
      await guarded(async () => { await api.remove(e.id, kids > 0); toast('削除しました'); setSel(null); await reload(); });
    } else if (t) {
      if (!window.confirm(`ツール ${t.name} を削除しますか？（接続も外れます）`)) return;
      await guarded(async () => { await api.removeTool(t.id); toast('削除しました'); setSel(null); await reload(); });
    }
  }, [guarded, reload, toast]);

  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && !(ev.target as HTMLElement).closest?.('input, textarea, select, [role=dialog]')) { ev.preventDefault(); void deleteSelected(); }
      if (ev.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [deleteSelected]);

  const onConnect = useCallback((fromId: string, toId: string) => void guarded(async () => {
    const r = canConnect(entities, tools, fromId, toId);
    if (!r.ok) return toast(r.reason, true);
    if (r.action === 'tool') {
      const patch: Record<string, unknown> = { tool_ids: [...r.from.tool_ids, toId] };
      if (r.from.definition) {
        const def = await api.definition(fromId);
        if (def.tools === null && !window.confirm(`${r.from.name} は tools を指定しておらず、全ツールを継承しています。接続すると、接続したツールだけに制限されます。続けますか？`)) return;
        if (isRiskyDir(r.to)) {
          if (!window.confirm(`${r.to.name}（${r.to.path}）は ${permLabels(r.to.perms).join('・')} ができるディレクトリです。${r.from.name} に許可しますか？（定義ファイルの tools に追記されます）`)) return;
          patch.allow_dangerous = true;
        }
        if (DANGEROUS_TOOLS.includes(r.to.name)) {
          if (!window.confirm(`${r.to.name} は書き込み・実行ができるツールです。${r.from.name} に許可しますか？（定義ファイルの tools に追記されます）`)) return;
          patch.allow_dangerous = true;
        }
      }
      await api.update(fromId, patch);
      toast(`${r.from.name} に ${r.to.name} を接続しました${r.from.definition ? '（定義ファイルを更新）' : ''}`);
    } else { await api.update(toId, { parent_id: fromId }); toast(`${r.to.name} の親を ${r.from.name} にしました`); }
    await reload();
  }), [entities, tools, guarded, reload, toast]);

  const onMove = useCallback((id: string, x: number, y: number) => void guarded(async () => {
    const pos = { x, y };
    if (live.current.tools.some((t) => t.id === id)) { await api.updateTool(id, { pos }); setTools((l) => l.map((t) => (t.id === id ? { ...t, pos } : t))); }
    else { await api.update(id, { pos }); setEntities((l) => l.map((e) => (e.id === id ? { ...e, pos } : e))); }   // 台帳の位置を更新し、次の描画で元に戻らないようにする
  }), [guarded]);

  const onContext = useCallback((c: CtxTarget) => {
    const { entities: ents, tools: tls } = live.current;
    const items: NonNullable<typeof menu>['items'] = [];
    const add = (kind: Kind | 'tool', parentId?: string, parentName?: string) => items.push([`＋ ${kind === 'tool' ? 'ツール' : KIND_LABEL[kind]}${parentName ? `（${parentName} の配下）` : ''}`, () => setAdding({ kind, parentId, at: { x: c.x, y: c.y } })]);
    const e = c.target.type === 'node' ? ents.find((n) => n.id === c.target.id) : undefined;
    const t = c.target.type === 'node' ? tls.find((n) => n.id === c.target.id) : undefined;
    if (c.target.type === 'bg') (['suborchestrator', 'agent', 'subagent', 'tool'] as const).forEach((k) => add(k));
    else if (e) {
      childKinds(e.kind).forEach((k) => add(k, e.id, e.name)); add('tool'); items.push('---');
      if (!e.protected) items.push(['名前を変更…', () => void rename(e)]);
      items.unshift(['✎ 編集…', () => setEditId(e.id)], ['🖼 アイコンを変更…', () => setEditId(e.id)], '---');
      items.push([e.protected ? '🔒 削除できません（管理者エージェント）' : '削除…', () => void deleteSelected(), { danger: !e.protected, disabled: e.protected }]);
    } else if (t) { add('tool'); items.push('---', ['ツールを削除…', () => void deleteSelected(), { danger: true }]); }
    else if (c.target.type === 'edge') { const isTool = c.target.id!.startsWith('tool:'); items.push([isTool ? '接続を外す' : '親子のワイヤーは削除できません', () => void deleteSelected(), { disabled: !isTool }]); }
    setMenu({ x: Math.min(c.clientX, window.innerWidth - 240), y: Math.min(c.clientY, window.innerHeight - 40 * (items.length + 1)), items });
  }, [deleteSelected, rename]);

  useEffect(() => {
    if (!menu) return;
    const close = (ev: Event) => { if (!(ev.target as HTMLElement).closest?.('#ctxMenu')) setMenu(null); };
    window.addEventListener('pointerdown', close, true); window.addEventListener('blur', () => setMenu(null));
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menu]);

  const selDeletable = !!sel && (sel.type === 'edge' ? sel.id.startsWith('tool:') : !entities.find((e) => e.id === sel.id)?.protected);
  const resetLayout = () => void guarded(async () => {
    if (!window.confirm('手動で並べた配置を破棄して、自動配置に戻しますか？')) return;
    await Promise.all([...entities.filter((e) => e.pos).map((e) => api.update(e.id, { pos: null })), ...tools.filter((t) => t.pos).map((t) => api.updateTool(t.id, { pos: null }))]);
    await reload(true);
  });

  return (
    <div className="admin">
      <header>
        <a className="navlink" href="/" title="ポータルの一覧へ"><Icon name="back" />ポータル</a>
        <div className="brand">🐾 猫神さま管理</div><span className="grow" />
        <span className={`pill ${ok ? 'ok' : 'ng'}`}>{ok === null ? '' : ok ? 'API 接続中' : 'API に接続できません'}</span>
        <UserMenu />
      </header>
      <div className="layout">
        <aside>
          {overview && <GodCard overview={overview} guarded={guarded} reload={reload} />}
          <UsersCard guarded={guarded} />
          <ThemeCard guarded={guarded} />
          <PersonalityCard guarded={guarded} />
          {overview && <DelegationCard overview={overview} onEdit={(row) => setDel({ open: true, row })} />}
          <Inspector sel={sel} entities={entities} tools={tools} guarded={guarded} reload={reload} onRename={(e) => void rename(e)} />
        </aside>
        <section className="stage">
          <div className="toolbar">
            {(['suborchestrator', 'agent', 'subagent'] as const).map((k) => <button key={k} onClick={() => setAdding({ kind: k })}><Icon name="add" size={18} />{KIND_LABEL[k]}</button>)}
            <button onClick={() => setAdding({ kind: 'tool' })}><Icon name="tool" size={18} />ツール</button>
            <button onClick={() => setAdding({ kind: 'directory' })}><Icon name="folder" size={18} />ディレクトリ</button>
            <button onClick={() => setAdding({ kind: 'llm' })}><Icon name="chat" size={18} />ローカル LLM</button>
            <span className="sep" />
            <button className="danger" disabled={!selDeletable} onClick={() => void deleteSelected()}><Icon name="delete" size={18} />選択を削除 (Del)</button>
            <button onClick={() => setFitKey((k) => k + 1)}><Icon name="expand" size={18} />全体表示</button>
            <button onClick={resetLayout} title="手動配置を破棄して自動配置に戻す"><Icon name="refresh" size={18} />自動整列</button>
            <span className="grow" />
            <span className="legend"><i className="lg suborchestrator" />サブオーケストレーター <i className="lg agent" />エージェント <i className="lg subagent" />サブエージェント <i className="lg tool" />ツール <i className="lg dir" />ディレクトリ <i className="lg llm" />ローカル LLM</span>
          </div>
          <AdminGraph entities={entities} tools={tools} fitKey={fitKey} selected={sel} onSelect={setSel} onMove={onMove} onConnect={onConnect} onContext={onContext} />
          <p className="hint tips">操作: ノードをドラッグで移動 / 背景をドラッグでパン / ホイールでズーム / 右の ● から別ノードの左の ● へドラッグして接続（親子の付け替え・ツール接続）。<b>定義ファイル（.claude/agents/）のあるものは、モデル・ツール接続・プロンプトの変更がそのファイルに書き込まれます（元のファイルは portal/data/backups に退避）。</b></p>
        </section>
      </div>
      {menu && (
        <div id="ctxMenu" role="menu" style={{ left: menu.x, top: menu.y }}>
          {menu.items.map((it, i) => it === '---' ? <hr key={i} /> : <button key={i} className={it[2]?.danger ? 'danger' : ''} disabled={!!it[2]?.disabled} onClick={() => { setMenu(null); it[1](); }}>{it[0]}</button>)}
        </div>
      )}
      <Dialog.Root open={!!editId && entities.some((e) => e.id === editId)} onOpenChange={(o) => { if (!o) setEditId(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dlg-overlay" />
          <Dialog.Content className="dlg dlg-edit" aria-describedby={undefined}>
            {(() => {
              const e = entities.find((x) => x.id === editId);
              return e && <>
                <Dialog.Title asChild><h2><Avatar icon={e.icon} kind={e.kind} size={28} /> {e.name} の編集</h2></Dialog.Title>
                <Inspector embedded sel={{ type: 'node', id: e.id }} entities={entities} tools={tools} guarded={guarded} reload={reload} onRename={(x) => void rename(x)} />
              </>;
            })()}
            <menu><Dialog.Close asChild><button type="button">閉じる</button></Dialog.Close></menu>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AddDialog spec={adding} entities={entities} selectedId={sel?.type === 'node' ? sel.id : null} onClose={() => setAdding(null)} onDone={async () => { toast('作成しました'); await reload(); }} />
      {overview && <DelegationDialog open={del.open} row={del.row} overview={overview} entities={entities} onClose={() => setDel({ open: false, row: null })} onDone={async () => { toast('委任先を保存しました'); await reload(); }} />}
    </div>
  );
}

export default function AdminApp() { return <ToastProvider><Admin /></ToastProvider>; }
