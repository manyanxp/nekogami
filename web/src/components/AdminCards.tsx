'use client';
// 管理ページ左の列のカード（テーマ・性格・猫神さま・委任先・選択中）
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DANGEROUS_TOOLS, DIR_PERMS, RISKY_DIR_PERMS, modelOptions } from '@/lib/graph-model';
import { KIND_LABEL } from '@/lib/model';
import { DEFAULT_THEME, PRESETS, applyTheme, saveThemeCache } from '@/lib/theme';
import type { DelegationRow, DirPerms, Entity, EntityDefinition, Overview, Personality, Theme, Tool } from '@/lib/types';
import { useToast } from './Toast';
import { IconPicker } from './IconPicker';

export function ModelSelect({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return <select {...rest} value={value} onChange={(e) => onChange(e.target.value)}>{modelOptions(value).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

export function ThemeCard({ guarded }: { guarded: <T>(fn: () => Promise<T>) => Promise<T | undefined> }) {
  const [t, setT] = useState<Theme>(DEFAULT_THEME);
  const [msg, setMsg] = useState('');
  useEffect(() => { void guarded(api.theme).then((x) => x && setT(x)); }, [guarded]);
  const upd = (n: Theme) => { setT(n); applyTheme(n); };   // 保存前に、この画面で試せる
  return (
    <section className="card" id="themeCard">
      <h2>🎨 テーマ</h2>
      <p className="hint">ポータルと Agent Console の色です（<code>portal/data/theme.json</code>）。保存すると、どちらも再読み込みで反映されます。</p>
      <form onSubmit={(e) => { e.preventDefault(); void guarded(async () => { const s = await api.setTheme(t); setT(s); saveThemeCache(s); setMsg('保存しました。ポータルと Agent Console は再読み込みで反映されます'); }); }}>
        <div className="seg" role="radiogroup" aria-label="モード">
          {([['auto', '自動'], ['dark', 'ダーク'], ['light', 'ライト']] as const).map(([v, l]) => <label key={v}><input type="radio" name="mode" checked={t.mode === v} onChange={() => upd({ ...t, mode: v })} />{l}</label>)}
        </div>
        <div className="swatches" role="radiogroup" aria-label="アクセント色">
          {PRESETS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={t.preset === p.id} title={p.label} className={`sw${p.accent ? '' : ' def'}${t.preset === p.id ? ' on' : ''}`} style={p.accent ? { background: p.accent } : undefined} onClick={() => upd({ ...t, preset: p.id, accent: p.accent })} />)}
        </div>
        <label className="inline">自由な色 <input type="color" value={t.accent || '#5be3b0'} onChange={(e) => upd({ ...t, accent: e.target.value, preset: 'custom' })} /> <span className="hint">{t.accent || '（既定の色）'}</span></label>
        <div className="row"><button className="primary">保存</button><button type="button" className="mini" onClick={() => upd(DEFAULT_THEME)}>既定に戻す</button><span className="hint">{msg}</span></div>
      </form>
    </section>
  );
}

const TONES: [string, string][] = [['', '（ひな形を選ぶ）'], ['ていねいな「です・ます」調', 'ていねい'], ['親しみやすい、くだけた敬語', '親しみやすい'], ['簡潔で断定的。結論から話す', '厳格・簡潔'],
  ['ゆったり、のんびりした話し方', 'のんびり'], ['老猫のような「〜じゃ」口調', '老猫（〜じゃ）'], ['語尾に「〜にゃ」を付ける、猫らしい口調', '猫らしい（〜にゃ）']];

export function PersonalityCard({ guarded }: { guarded: <T>(fn: () => Promise<T>) => Promise<T | undefined> }) {
  const toast = useToast();
  const [p, setP] = useState<Personality | null>(null);
  useEffect(() => { void guarded(api.personality).then((x) => x && setP(x)); }, [guarded]);
  if (!p) return <section className="card" id="personalityCard"><h2>🐱 猫神さまの性格</h2></section>;
  const set = (k: keyof Personality, v: string) => setP({ ...p, [k]: v });
  return (
    <section className="card" id="personalityCard">
      <h2>🐱 猫神さまの性格</h2>
      <p className="hint">猫神さま自身の返答の言葉づかいに使われます（<code>nekogamisama/personality.md</code>）。委任先の結果の事実や、守ることは変わりません。</p>
      <form onSubmit={(e) => { e.preventDefault(); void guarded(async () => { setP(await api.setPersonality({ first_person: p.first_person, address: p.address, tone: p.tone, traits: p.traits })); toast('性格を保存しました（次の会話から反映されます）'); }); }}>
        <div className="two"><label>一人称<input value={p.first_person} maxLength={16} onChange={(e) => set('first_person', e.target.value)} /></label><label>呼びかけ<input value={p.address} maxLength={16} onChange={(e) => set('address', e.target.value)} /></label></div>
        <label>口調のひな形<select value="" onChange={(e) => e.target.value && set('tone', e.target.value)}>{TONES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select></label>
        <label>口調<input value={p.tone} maxLength={80} onChange={(e) => set('tone', e.target.value)} /></label>
        <label>性格・ふるまい<textarea rows={4} maxLength={1000} value={p.traits} onChange={(e) => set('traits', e.target.value)} /></label>
        {!p.imported && <p className="warn hint">CLAUDE.md が personality.md を取り込んでいないため、反映されません。<button type="button" className="mini" onClick={() => void guarded(async () => { setP(await api.enablePersonality()); toast('CLAUDE.md に取り込みを追加しました'); })}>取り込みを追加</button></p>}
        <div className="row"><button className="primary">保存</button><span className="hint">{p.exists ? '' : '（まだ保存されていません。既定の性格です）'}</span></div>
      </form>
    </section>
  );
}

export function GodCard({ overview, guarded, reload }: { overview: Overview; guarded: <T>(fn: () => Promise<T>) => Promise<T | undefined>; reload: () => Promise<void> }) {
  const toast = useToast();
  const a = overview.admin;
  const [desc, setDesc] = useState(''), [model, setModel] = useState(''), [icon, setIcon] = useState<string | null>(null);
  useEffect(() => { if (a) { setDesc(a.description); setModel(a.model); setIcon(a.icon || null); } }, [a]);
  if (!a) return <section id="godCard" className="card"><h2>🐾 猫神さま</h2><p className="warn">猫神さまが台帳にありません。ポータルの「組み込みを取り込み」を実行してください。</p></section>;
  const c = overview.counts;
  return (
    <section id="godCard" className="card">
      <h2>🐾 猫神さま <span className="badge orchestrator">管理者エージェント</span></h2>
      <div className="row lock">🔒 削除・無効化・改名はできません（バックエンドで拒否）</div>
      <div className="row"><b>ID</b><code>{a.id}</code></div>
      <div className="counts">{(['suborchestrator', 'agent', 'subagent'] as const).map((k) => <span key={k}>{KIND_LABEL[k]} {c[k]}</span>)}<span>ツール {overview.tools}</span></div>
      <form onSubmit={(e) => { e.preventDefault(); void guarded(async () => { await api.update(a.id, { description: desc.trim(), model: model.trim(), icon }); toast('保存しました'); await reload(); }); }}>
        <label>説明<input value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} /></label>
        <label>モデル<ModelSelect value={model} onChange={setModel} /></label>
        <IconPicker value={icon} kind="orchestrator" onChange={setIcon} />
        <button className="primary">保存</button>
      </form>
    </section>
  );
}

export function DelegationCard({ overview, onEdit }: { overview: Overview; onEdit: (row: DelegationRow | null) => void }) {
  const mark = (ok: boolean, yes: string, no: string) => <span className={ok ? 'ok' : 'warn'}>{ok ? `✔ ${yes}` : `⚠ ${no}`}</span>;
  return (
    <>
      <section className="card">
        <h2>委任先の突き合わせ</h2>
        <p className="hint">台帳のサブオーケストレーターと、猫神さまが委任に使う <code>nekogamisama/suborchestrators.json</code> の対応です。</p>
        <table id="delegation"><thead><tr><th>名前</th><th>台帳</th><th>委任設定</th></tr></thead>
          <tbody>
            {overview.delegation.map((d) => (
              <tr key={d.name} title={d.dir ? `dir: ${d.dir}` : ''}>
                <td>{d.name}<span className="hint">{d.wired ? ` (${d.type === 'agent' ? 'Agent' : 'session'})` : ''}</span></td>
                <td>{mark(d.registered, '登録済み', '未登録')}</td>
                <td>{mark(d.wired, '委任可', '未設定')} <button className="mini" onClick={() => onEdit(d)} title={d.registered && d.wired ? '台帳と委任設定を編集' : '足りない側を登録して、台帳と委任設定をそろえる'}>{d.registered && d.wired ? '編集' : '整える'}</button></td>
              </tr>
            ))}
            {!overview.delegation.length && <tr><td colSpan={3}>サブオーケストレーターがありません</td></tr>}
          </tbody>
        </table>
        <button id="delAdd" className="mini" onClick={() => onEdit(null)}>＋ 委任先を追加</button>
      </section>
      {(overview.misplaced.length > 0 || overview.missing.length > 0) && (
        <section className="card"><h2>整理が必要です</h2>
          <ul className="warnlist">
            {overview.misplaced.map((m) => <li key={m.name}>⚠ {m.name}: {m.path} → {m.expected} に置くのが規則です</li>)}
            {overview.missing.map((m) => <li key={m.name}>⚠ {m.name}: 定義ファイル {m.path} が見つかりません</li>)}
          </ul></section>
      )}
    </>
  );
}

export function Inspector({ sel, entities, tools, guarded, reload, onRename, embedded = false }: {
  embedded?: boolean; sel: { type: 'node' | 'edge'; id: string } | null; entities: Entity[]; tools: Tool[];
  guarded: <T>(fn: () => Promise<T>) => Promise<T | undefined>; reload: () => Promise<void>; onRename: (e: Entity) => void;
}) {
  const toast = useToast();
  const e = sel?.type === 'node' ? entities.find((x) => x.id === sel.id) : undefined;
  const t = sel?.type === 'node' ? tools.find((x) => x.id === sel.id) : undefined;
  return (
    <section className={embedded ? 'inspector-embedded' : 'card'} id={embedded ? undefined : 'inspector'}>
      {!embedded && <h2>選択中</h2>}
      {!sel && <p className="hint">グラフでノードかワイヤーを選ぶと、ここに表示されます。</p>}
      {sel?.type === 'edge' && (() => {
        const kind = sel.id.split(':')[0], [from, to] = sel.id.split(':')[1].split('>');
        const a = entities.find((x) => x.id === from), b = entities.find((x) => x.id === to) || tools.find((x) => x.id === to);
        return <><div className="row"><b>{kind === 'tool' ? 'ツール接続' : '親子'}</b>{a?.name} → {b?.name}</div>
          <p className="hint">{kind === 'tool' ? '「選択を削除」で接続を外します。' : '親子のワイヤーは削除できません。別の親の左の ● へ付け替えるか、ノードを削除してください。'}</p></>;
      })()}
      {e && <>
        <div className="row"><span className={`badge ${e.kind}`}>{KIND_LABEL[e.kind]}</span>{e.name}{e.protected && <span className="lock">🔒 削除不可</span>}</div>
        <div className="row"><b>ID</b><code>{e.id}</code></div>
        <IconPicker value={e.icon || null} kind={e.kind} onChange={(v) => void guarded(async () => { await api.update(e.id, { icon: v }); toast(`${e.name} のアイコンを${v ? '変更' : '既定に戻'}しました`); await reload(); })} />
        {!e.protected && <div className="row"><b>名前</b><button className="mini" onClick={() => onRename(e)}>名前を変更…</button></div>}
        <div className="row"><b>モデル</b><ModelSelect value={e.model} title="モデルを変更（台帳に保存）" onChange={(v) => void guarded(async () => { await api.update(e.id, { model: v }); toast(`${e.name} のモデルを ${v || '（指定なし）'} にしました${e.definition ? '（定義ファイルを更新）' : ''}`); await reload(); })} /></div>
        <div className="row"><b>親</b>{entities.find((x) => x.id === e.parent_id)?.name || '（なし）'}</div>
        <div className="row"><b>ツール</b>{e.tool_ids.map((i) => tools.find((x) => x.id === i)?.name).filter(Boolean).join(', ') || '（なし）'}</div>
        {entities.some((x) => x.parent_id === e.id) && <p className="hint">配下 {entities.filter((x) => x.parent_id === e.id).length} 件。削除すると配下もまとめて削除します。</p>}
        {e.description && <p className="hint">{e.description}</p>}
        {e.definition ? <DefinitionPanel key={e.id} e={e} guarded={guarded} /> : <p className="hint">定義ファイルのないエンティティです（Docker などで外部管理）。プロンプトとツールは台帳では編集できません。</p>}
      </>}
      {t && <><div className="row"><span className="badge">{t.kind}</span>{t.name}</div><div className="row"><b>接続数</b>{entities.filter((x) => x.tool_ids.includes(t.id)).length}</div>{t.description && <p className="hint">{t.description}</p>}
        {t.kind === 'directory' && <DirectoryPanel key={t.id} t={t} connected={entities.filter((x) => x.tool_ids.includes(t.id)).map((x) => x.name)} guarded={guarded} reload={reload} />}</>}
    </section>
  );
}

/** ディレクトリのノードの編集: 場所と権限（チェックボックス）。権限の変更は、つないである担当に次のチャットから効く */
function DirectoryPanel({ t, connected, guarded, reload }: { t: Tool; connected: string[]; guarded: <T>(fn: () => Promise<T>) => Promise<T | undefined>; reload: () => Promise<void> }) {
  const toast = useToast();
  const [path, setPath] = useState(t.path || '');
  const [perms, setPerms] = useState<DirPerms>({ list: !!t.perms?.list, read: !!t.perms?.read, write: !!t.perms?.write, delete: !!t.perms?.delete, exec: !!t.perms?.exec });
  const dirty = path !== (t.path || '') || DIR_PERMS.some((p) => perms[p.key] !== !!t.perms?.[p.key]);
  const escalates = DIR_PERMS.some((p) => RISKY_DIR_PERMS.includes(p.key) && perms[p.key] && !t.perms?.[p.key]);
  return (
    <div className="defpanel">
      <label>場所（<code>workspace/</code> からの相対パス）<input value={path} onChange={(e) => setPath(e.target.value)} maxLength={600} /></label>
      <div className="perm-row" role="group" aria-label="担当に許す操作">
        {DIR_PERMS.map((p) => <label key={p.key} className={RISKY_DIR_PERMS.includes(p.key) ? 'risky' : ''}><input type="checkbox" checked={perms[p.key]} onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })} />{p.label}</label>)}
      </div>
      <p className="hint">つないである担当: {connected.join(', ') || '（なし）'}。権限は、つないだすべての担当に同じに効きます。</p>
      <button className="primary" disabled={!dirty} onClick={() => void guarded(async () => {
        if (escalates && connected.length && !window.confirm(`書き込み・削除・Python 実行を許すと、${connected.join('、')} が ${t.path} の中のファイルを変更・削除したり、コードを実行したりできるようになります。よろしいですか？`)) return;
        await api.updateTool(t.id, { path, perms }); toast(`${t.name} を保存しました`); await reload();
      })}>保存</button>
    </div>
  );
}

function DefinitionPanel({ e, guarded }: { e: Entity; guarded: <T>(fn: () => Promise<T>) => Promise<T | undefined> }) {
  const toast = useToast();
  const [d, setD] = useState<EntityDefinition | null>(null), [text, setText] = useState(''), [err, setErr] = useState('');
  useEffect(() => { let live = true; api.definition(e.id).then((x) => { if (live) { setD(x); setText(x.prompt); } }).catch((x: Error) => live && setErr(x.message)); return () => { live = false; }; }, [e.id]);
  const note = d ? [d.tools === null && d.kind === 'agent-md' ? 'tools 未指定: 全ツールを継承します' : '', d.tools_other.length ? `グラフにないツール（そのまま保持）: ${d.tools_other.join(', ')}` : ''].filter(Boolean).join(' / ') : err;
  return (
    <div className="defpanel">
      <div className="row"><b>定義</b><code>{e.definition!.path}</code></div>
      <div className="hint">{note}</div>
      <textarea className="prompt" rows={12} spellCheck={false} disabled={!d} placeholder="読み込み中…" maxLength={50000} value={text} onChange={(x) => setText(x.target.value)} />
      <button className="primary" disabled={!d} onClick={() => void guarded(async () => {
        if (!window.confirm(`${e.definition!.path} のプロンプトを書き換えます（元のファイルは portal/data/backups に退避）。よろしいですか？`)) return;
        await api.setPrompt(e.id, text); toast('プロンプトを保存しました');
      })}>プロンプトを保存</button>
    </div>
  );
}

export { DANGEROUS_TOOLS };
