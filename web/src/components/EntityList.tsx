'use client';
import { KIND_LABEL, emptyForm, formFromEntity, formToEntity, parentOptions, toTree, type EntityForm } from '@/lib/model';
import type { DockerStatus, Entity, Kind } from '@/lib/types';
import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from './Gate';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { Avatar, IconPicker } from './IconPicker';

export interface ListFilter { q: string; kind: string; collapsed: Set<string> }

export function EntityList({ items, statuses, filter, onFilter, reload, openConsole }: {
  items: Entity[]; statuses: Record<string, DockerStatus>; filter: ListFilter; onFilter: (f: ListFilter) => void; reload: () => Promise<void>; openConsole: (e: Entity) => void;
}) {
  const toast = useToast();
  const me = useMe();
  const admin = !me || me.role === 'admin';   // 変更・起動・Console は管理者だけ（API も 403 にする）
  const rows = useMemo(() => toTree(items, filter), [items, filter]);
  const run = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); toast(label); await reload(); } catch (e) { toast((e as Error).message, true); } };
  const remove = (e: Entity) => {
    const kids = items.filter((x) => x.parent_id === e.id).length;
    if (!window.confirm(kids ? `「${e.name}」と配下 ${kids} 件を削除しますか？` : `「${e.name}」を削除しますか？`)) return;
    void run('削除しました', () => api.remove(e.id, kids > 0));
  };
  const toggle = (id: string) => { const c = new Set(filter.collapsed); if (c.has(id)) c.delete(id); else c.add(id); onFilter({ ...filter, collapsed: c }); };

  return (
    <>
      <div className="pane-head" data-handle title="ドラッグして、別の位置へ"><span className="grip">⠿</span><strong>サブオーケストレーター以下の一覧</strong><span id="summary" className="hint">{rows.length} 件</span></div>
      <div className="panel-body">
        <div className="tablewrap">
          <table>
            <thead><tr><th>名前（▼▶ で子を表示/非表示）</th><th>種別</th><th>ID (UUID)</th><th>モデル</th><th>状態</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = r.runtime.type === 'docker' ? statuses[r.id]?.state || 'unknown' : '';
                return (
                  <tr key={r.id} className={r.enabled ? '' : 'off'}>
                    <td title={r.description}><span className="nm" style={{ paddingLeft: r.depth * 18 }}>
                      {r.hasChildren ? <button className="tg" onClick={() => toggle(r.id)} aria-label={r.collapsed ? '展開' : '折りたたみ'}>{r.collapsed ? '▶' : '▼'}</button> : <span className="tg-space" />}
                      <Avatar icon={r.icon} kind={r.kind} size={22} />{r.name}</span><div className="desc">{r.description}</div></td>
                    <td><span className={`badge ${r.kind}`}>{KIND_LABEL[r.kind]}</span></td>
                    <td><button className="uuid" title="クリックでコピー" onClick={() => { void navigator.clipboard?.writeText(r.id); toast('UUID をコピーしました'); }}>{r.id.slice(0, 8)}…</button></td>
                    <td>{r.model || '—'}</td>
                    <td className={`st ${st}`}>{st ? { running: '● 稼働中', stopped: '停止', not_created: '未作成', unknown: '不明' }[st] || st : r.enabled ? '有効' : '無効'}</td>
                    <td>{admin && <div className="acts">
                      <button onClick={() => openConsole(r)} title="Agent Console を開く"><Icon name="code_run" size={18} />Console</button>
                      {r.runtime.type === 'docker' && (st === 'running'
                        ? <button onClick={() => run('停止しました', () => api.stop(r.id))}><Icon name="stop" size={18} />停止</button>
                        : <button onClick={() => run('起動しました', () => api.start(r.id))}><Icon name="run" size={18} />起動</button>)}
                      <EntityDialog item={r} items={items} onSaved={reload}><button><Icon name="edit" size={18} />編集</button></EntityDialog>
                      <button className="danger" onClick={() => remove(r)}><Icon name="delete" size={18} />削除</button>
                    </div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div id="empty">表示するサブオーケストレーター以下がありません。「組み込みを取り込み」または「＋ 追加」から始めてください。猫神さま自身は「猫神さま管理」で扱います。</div>}
        </div>
      </div>
    </>
  );
}

const KINDS: Kind[] = ['suborchestrator', 'agent', 'subagent'];

export function EntityDialog({ item, items, onSaved, children, kinds = KINDS }: { item?: Entity; items: Entity[]; onSaved: () => Promise<void>; children: React.ReactNode; kinds?: Kind[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<EntityForm>(emptyForm());
  const [err, setErr] = useState('');
  const set = <K extends keyof EntityForm>(k: K, v: EntityForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const parents = parentOptions(items, f.kind, item?.id);
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr('');
    try {
      const body = formToEntity(f);
      if (item) await api.update(item.id, body); else await api.create(body);
      setOpen(false); toast('保存しました'); await onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) { setF(item ? formFromEntity(item) : { ...emptyForm(), kind: kinds[0] }); setErr(''); } }}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg" aria-describedby={undefined}>
          <form onSubmit={save}>
            <Dialog.Title asChild><h2>{item ? `編集: ${item.name}` : '追加'}</h2></Dialog.Title>
            <label>種別<select value={f.kind} onChange={(e) => set('kind', e.target.value as Kind)} disabled={!!item}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
            <label>名前<input value={f.name} onChange={(e) => set('name', e.target.value)} required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" placeholder="例: azure-cost-agent" /></label>
            <label>親<select value={f.parent_id} onChange={(e) => set('parent_id', e.target.value)}><option value="">（なし）</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>説明<input value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={500} /></label>
            <IconPicker value={f.icon} kind={f.kind} onChange={(v) => set('icon', v)} />
            <label>モデル<input value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="haiku / sonnet / opus など" /></label>
            <label>タグ（カンマ区切り）<input value={f.tags} onChange={(e) => set('tags', e.target.value)} /></label>
            <label className="chk"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> 有効</label>
            <fieldset><legend>ランタイム</legend>
              <label>種類<select value={f.rt_type} onChange={(e) => set('rt_type', e.target.value as EntityForm['rt_type'])}>
                <option value="external">external（外部で稼働）</option><option value="docker">docker（Compose で起動・停止）</option><option value="builtin">builtin（Agent Console 内）</option></select></label>
              <label>URL（任意）<input value={f.rt_url} onChange={(e) => set('rt_url', e.target.value)} placeholder="http://127.0.0.1:4317" /></label>
              {f.rt_type === 'docker' && <>
                <label>compose ファイル（プロジェクトからの相対パス）<input value={f.rt_compose} onChange={(e) => set('rt_compose', e.target.value)} placeholder="agents/cost/docker-compose.yml" /></label>
                <label>サービス名<input value={f.rt_service} onChange={(e) => set('rt_service', e.target.value)} placeholder="cost-agent" /></label></>}
            </fieldset>
            <p className="err">{err}</p>
            <menu><Dialog.Close asChild><button type="button">キャンセル</button></Dialog.Close><button className="primary" type="submit">保存</button></menu>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
