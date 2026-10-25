'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DIR_PERMS, PY_SAMPLE, PY_TYPES, RISKY_DIR_PERMS, parentChoices } from '@/lib/graph-model';
import { KIND_LABEL } from '@/lib/model';
import type { DelegationRow, DirPerms, Entity, Kind, Overview, Tool } from '@/lib/types';
import { ModelSelect } from './AdminCards';

export type AddSpec = { kind: Kind | 'tool' | 'directory' | 'llm' | 'python' | 'input'; parentId?: string | null; at?: { x: number; y: number } | null };
const NO_PERMS: DirPerms = { list: false, read: false, write: false, delete: false, exec: false };

/** ノード・ツールの追加。エージェントは .claude/agents/ に定義ファイルが作られる */
export function AddDialog({ spec, entities, selectedId, onClose, onDone }: { spec: AddSpec | null; entities: Entity[]; selectedId: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: '', description: '', parent_id: '', model: '', prompt: '', tool_kind: 'custom', path: '', param: '', dtype: 'str', value: '' });
  const [perms, setPerms] = useState<DirPerms>(NO_PERMS);
  const [err, setErr] = useState('');
  const isDir = spec?.kind === 'directory';
  const isLlm = spec?.kind === 'llm';
  const isPy = spec?.kind === 'python';
  const isInput = spec?.kind === 'input';
  const isTool = spec?.kind === 'tool' || isDir || isLlm || isPy || isInput;
  const opts = spec && !isTool ? parentChoices(entities, spec.kind as Kind) : [];
  useEffect(() => {
    if (!spec) return;
    const pre = opts.find((o) => o.id === (spec.parentId || selectedId));
    setF({ name: '', description: '', parent_id: pre?.id || opts[0]?.id || '', model: spec.kind === 'llm' ? 'qwen3:8b' : '', prompt: spec.kind === 'python' ? PY_SAMPLE : '', tool_kind: 'custom', path: '', param: '', dtype: 'str', value: '' }); setPerms(NO_PERMS); setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const pos = spec?.at ? { x: Math.round(spec.at.x / 10) * 10, y: Math.round(spec.at.y / 10) * 10 } : undefined;
    try {
      if (isDir) await api.createTool({ name: f.name.trim(), description: f.description.trim(), kind: 'directory', path: f.path.trim(), perms, pos });
      else if (isLlm) await api.createTool({ name: f.name.trim(), description: f.description.trim(), kind: 'llm', model: f.model.trim(), prompt: f.prompt, pos });
      else if (isPy) await api.createTool({ name: f.name.trim(), description: f.description.trim(), kind: 'python', code: f.prompt, pos });
      else if (isInput) await api.createTool({ name: f.name.trim(), description: f.description.trim(), kind: 'input', param: f.param.trim(), dtype: f.dtype, value: f.value, pos });
      else if (isTool) await api.createTool({ name: f.name.trim(), description: f.description.trim(), kind: f.tool_kind, pos });
      else await api.createAgent({ kind: spec!.kind, name: f.name.trim(), description: f.description.trim(), parent_id: f.parent_id || null, model: f.model, prompt: f.prompt.trim(), pos });
      onClose(); await onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog.Root open={!!spec} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal><Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg" aria-describedby={undefined}>
          <form onSubmit={submit}>
            <Dialog.Title asChild><h2>{isPy ? 'Python ノードを追加' : isInput ? '入力ノードを追加' : isLlm ? 'ローカル LLM を追加' : isDir ? 'ディレクトリを追加' : isTool ? 'ツールを追加' : `${spec ? KIND_LABEL[spec.kind as Kind] : ''}を追加（Claude のエージェント定義を作成）`}</h2></Dialog.Title>
            <label>名前<input value={f.name} onChange={(e) => set('name', e.target.value)} required pattern={isDir || isLlm || isPy || isInput ? '[A-Za-z0-9][A-Za-z0-9\\-]{0,39}' : '[A-Za-z0-9][A-Za-z0-9._\\-]{0,63}'} placeholder="例: cost-agent" /></label>
            {!isTool && <label>親<select value={f.parent_id} onChange={(e) => set('parent_id', e.target.value)}>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}（{KIND_LABEL[o.kind]}）</option>)}</select></label>}
            {isDir && <>
              <label>場所（作業領域 <code>workspace/</code> からの相対パス）<input value={f.path} onChange={(e) => set('path', e.target.value)} required placeholder="例: notes/docs" pattern="[A-Za-z0-9][A-Za-z0-9._\-]*(/[A-Za-z0-9][A-Za-z0-9._\-]*)*" /></label>
              <fieldset><legend>担当に許す操作（既定はすべてオフ）</legend>
                <div className="perm-row">{DIR_PERMS.map((p) => <label key={p.key} className={RISKY_DIR_PERMS.includes(p.key) ? 'risky' : ''}><input type="checkbox" checked={perms[p.key]} onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })} />{p.label}</label>)}</div>
              </fieldset>
              <p className="hint">作ったら、エージェントの左の ● へワイヤーでつなぐと、そのエージェントだけが使えます。</p></>}
            {isLlm && <>
              <label>モデル名（Ollama。<code>ollama pull</code> で取得済みのもの）<input value={f.model} onChange={(e) => set('model', e.target.value)} required placeholder="例: qwen3:8b" pattern="[A-Za-z0-9][A-Za-z0-9._:/\-]{0,79}" /></label>
              <label>プロンプト（システムプロンプト。空でもよい）<textarea className="llm-prompt" rows={6} maxLength={8000} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="あなたは…です。短く答えます。" /></label>
              <p className="hint">作ったら、エージェントの左の ● へワイヤーでつなぐと、そのエージェントが <code>ask</code> ツールで質問できます。温度や出力の長さは、作ったあとの編集で変えられます。</p></>}
            {isPy && <>
              <label>処理（関数の中身だけを書く。関数名や引数は書かない。結果は <code>return</code> で返す）<textarea className="llm-prompt code" rows={10} spellCheck={false} maxLength={20000} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} required /></label>
              <p className="hint">入力ノードをつなぐと、その引数名が変数として使え、実行時に関数が自動で作られます。ネットワークなし・30 秒までの実行環境で動き、処理が終わってから結果を呼んだ担当へ返します。作ったら、エージェントの左の ● へワイヤーでつなぐと、そのエージェントが <code>run</code> ツールで呼べます。</p></>}
            {isInput && <>
              <label>引数名（つなぐと、Python ノードの関数の引数・変数になる）<input value={f.param} onChange={(e) => set('param', e.target.value)} required pattern="[A-Za-z_][A-Za-z0-9_]{0,63}" placeholder="例: x" /></label>
              <label>データ型<select value={f.dtype} onChange={(e) => set('dtype', e.target.value)}>{PY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}</select></label>
              <label>値（{PY_TYPES.find((t) => t.key === f.dtype)?.example}）<textarea className="llm-prompt" rows={3} maxLength={4000} value={f.value} onChange={(e) => set('value', e.target.value)} /></label>
              <p className="hint">作ったら、Python ノードへワイヤーでつなぐと、Python ノードのパラメータ情報に引数として表示されます。値はその既定値になります（担当が値を渡せば、そちらが優先）。</p></>}
            {isTool && !isDir && !isLlm && !isPy && !isInput && <label>ツールの種類<select value={f.tool_kind} onChange={(e) => set('tool_kind', e.target.value)}><option value="custom">custom</option><option value="mcp">mcp</option><option value="builtin">builtin</option></select></label>}
            {!isTool && <label>モデル<ModelSelect value={f.model} onChange={(v) => set('model', v)} /></label>}
            <label>説明<input value={f.description} maxLength={300} onChange={(e) => set('description', e.target.value)} /></label>
            {!isTool && <label>プロンプト（空なら雛形を使う）<textarea rows={6} maxLength={50000} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="あなたは…です。" /></label>}
            {!isTool && <p className="hint">作成すると <code>.claude/agents/&lt;親の名前&gt;/&lt;名前&gt;.md</code> が作られます。ツールは読み取り中心の既定で始まり、ワイヤーで増減できます。</p>}
            <p className="err">{err}</p>
            <menu><Dialog.Close asChild><button type="button">キャンセル</button></Dialog.Close><button className="primary">作成</button></menu>
          </form>
        </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

/** 委任先の編集。台帳と委任設定（nekogamisama/suborchestrators.json）を同じ画面でそろえる */
export function DelegationDialog({ open, row, overview, entities, onClose, onDone }: { open: boolean; row: DelegationRow | null; overview: Overview; entities: Entity[]; onClose: () => void; onDone: () => Promise<void> }) {
  const ent = row?.entity || null, wasWired = !!row?.wired;
  const defined = entities.filter((x) => x.definition?.kind === 'agent-md');
  const [f, setF] = useState({ name: '', lreg: true, ldesc: '', lmodel: 'sonnet', lenabled: true, dwired: true, dtype: 'agent', agent: '', dir: '', ddesc: '' });
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setF({
      name: row?.name || '', lreg: true, ldesc: ent?.description ?? row?.description ?? '', lmodel: row?.local_model ? '' : ent?.model || 'sonnet', lenabled: ent ? ent.enabled : true,
      dwired: true, dtype: wasWired ? row!.type : 'agent',
      agent: row?.agent || row?.target?.name || (defined.some((x) => x.name === row?.name) ? row!.name : defined[0]?.name || ''),
      dir: row?.dir || '', ddesc: row?.description || (row ? ent?.description || '' : ''),
    }); setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const lockReg = !!(ent?.has_definition || ent?.children);
  const note = ent?.has_definition ? '定義ファイルのあるエージェントなので、登録の解除はグラフで削除してください（ファイルは trash に退避されます）。' : ent?.children ? `配下に ${ent.children} 件あるため、登録は解除できません。` : '';

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const name = f.name.trim(), done: string[] = [];
    try {
      if (f.lreg || lockReg) {
        const body = { description: f.ldesc.trim(), model: f.lmodel, enabled: f.lenabled };
        if (!ent) { await api.create({ kind: 'suborchestrator', name, parent_id: overview.admin!.id, runtime: { type: 'builtin' }, ...body }); done.push('台帳に登録'); }
        else if (body.description !== ent.description || body.model !== ent.model || body.enabled !== ent.enabled) { await api.update(ent.id, body); done.push('台帳を更新'); }
      } else if (ent) {
        if (!window.confirm(`${name} を台帳から外しますか？（委任設定は変わりません）`)) return;
        await api.remove(ent.id, false); done.push('台帳から削除');
      }
      if (f.dwired) {
        await api.delegationPut(name, f.dtype === 'agent' ? { type: 'agent', agent: f.agent, description: f.ddesc.trim() } : { type: 'session', dir: f.dir.trim(), description: f.ddesc.trim() });
        done.push('委任設定を保存');
      } else if (wasWired) {
        if (!window.confirm(`委任設定から ${name} を削除しますか？（猫神さまが指名できなくなります。エージェントや定義ファイルは消えません）`)) return;
        await api.delegationDelete(name); done.push('委任設定から削除');
      }
      onClose(); await onDone();
    } catch (e) { setErr((done.length ? `（${done.join('、')}までは完了）` : '') + (e as Error).message); if (done.length) await onDone(); }
  };
  const agent = f.dtype === 'agent';
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal><Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg wide" id="delDlg" aria-describedby={undefined}>
          <form onSubmit={submit}>
            <Dialog.Title asChild><h2>{row ? `委任先の編集: ${row.name}` : '委任先を追加'}</h2></Dialog.Title>
            <label>名前（猫神さまが指名するときの名前）<input value={f.name} readOnly={!!row} required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" onChange={(e) => set('name', e.target.value)} /></label>
            <p className="hint">{row ? `現在: 台帳 ${ent ? '登録済み' : '未登録'} / 委任設定 ${wasWired ? `登録済み（${row.type}）` : '未設定'}` : '台帳と委任設定の両方を登録します。どちらか一方だけにする場合は、チェックを外してください。'}</p>
            <fieldset className={f.lreg || lockReg ? '' : 'off'}>
              <legend><label className="chk"><input type="checkbox" checked={f.lreg || lockReg} disabled={lockReg} onChange={(e) => set('lreg', e.target.checked)} /> 台帳に登録する（サブオーケストレーターとして、猫神さまの配下）</label></legend>
              <p className="hint">{note}</p>
              <label>台帳の説明<input value={f.ldesc} maxLength={500} onChange={(e) => set('ldesc', e.target.value)} /></label>
              {row?.local_model
                ? <div className="row"><b>モデル</b>ローカル LLM: <code>{row.local_model}</code><span className="hint">（Claude のモデルは使いません）</span></div>
                : <label>モデル<ModelSelect value={f.lmodel} onChange={(v) => set('lmodel', v)} /></label>}
              <label className="chk"><input type="checkbox" checked={f.lenabled} onChange={(e) => set('lenabled', e.target.checked)} /> 有効</label>
            </fieldset>
            <fieldset className={f.dwired ? '' : 'off'}>
              <legend><label className="chk"><input type="checkbox" checked={f.dwired} onChange={(e) => set('dwired', e.target.checked)} /> 委任設定に登録する（<code>nekogamisama/suborchestrators.json</code>。書き換え前は portal/data/backups に退避）</label></legend>
              <label>種類<select value={f.dtype} onChange={(e) => set('dtype', e.target.value)}><option value="agent">agent（Agent ツールで呼ぶ。.claude/agents/ の定義）</option><option value="session">session（別セッションで実行。delegate.sh）</option></select></label>
              {agent
                ? <label>呼ぶエージェント<select value={f.agent} onChange={(e) => set('agent', e.target.value)}>{defined.map((x) => <option key={x.id} value={x.name}>{x.name}（{KIND_LABEL[x.kind]}）</option>)}</select></label>
                : <label>実行するフォルダ（nekogamisama/ からの相対。プロジェクト配下のみ）<input value={f.dir} onChange={(e) => set('dir', e.target.value)} placeholder=".." /></label>}
              <label>委任設定の説明（猫神さまが振り分けの判断に使う）<input value={f.ddesc} maxLength={300} onChange={(e) => set('ddesc', e.target.value)} /></label>
            </fieldset>
            <p className="err">{err}</p>
            <menu><span className="grow" /><Dialog.Close asChild><button type="button">キャンセル</button></Dialog.Close><button className="primary">保存</button></menu>
          </form>
        </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

export type { Tool };
