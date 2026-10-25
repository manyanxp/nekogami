'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ACCEPT, checkUpload, defaultIcon, iconUrl, type IconList } from '@/lib/icons';
import type { Kind } from '@/lib/types';

/** エンティティの小さなアイコン（台帳の icon、なければ種別の既定） */
export function Avatar({ icon, kind, size = 20, className = '' }: { icon?: string | null; kind?: Kind | string; size?: number; className?: string }) {
  return <img className={`ico ${className}`} src={iconUrl(icon || defaultIcon(kind))} width={size} height={size} alt="" loading="lazy" />;
}

/** アイコンの選択（組み込み・アップロード済み・新しいアップロード）。value=null は既定 */
export function IconPicker({ value, kind, onChange }: { value: string | null; kind: Kind | string; onChange: (ref: string | null) => void }) {
  const [list, setList] = useState<IconList | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api.icons().then(setList).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    const bad = checkUpload(f);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try { const ref = await api.uploadIcon(f); await load(); onChange(ref); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const remove = async (ref: string) => {
    if (!window.confirm('このアップロード画像を削除しますか？')) return;
    try { await api.removeIcon(ref); if (value === ref) onChange(null); await load(); setErr(''); } catch (e) { setErr((e as Error).message); }
  };
  const cell = (ref: string, removable: boolean) => (
    <span key={ref} className="ico-cell">
      <button type="button" className={`ico-opt${value === ref ? ' on' : ''}`} aria-pressed={value === ref} title={ref.replace(/^[a-z]+:/, '')} onClick={() => onChange(ref)}>
        <img src={iconUrl(ref)} width={40} height={40} alt={ref} loading="lazy" />
      </button>
      {removable && <button type="button" className="ico-del" title="削除" aria-label="削除" onClick={() => void remove(ref)}>✕</button>}
    </span>
  );
  return (
    <fieldset className="ico-picker">
      <legend>アイコン</legend>
      <div className="ico-grid">
        <button type="button" className={`ico-opt${value === null ? ' on' : ''}`} aria-pressed={value === null} title="既定に戻す" onClick={() => onChange(null)}>
          <img src={iconUrl(defaultIcon(kind))} width={40} height={40} alt="既定" /><small>既定</small>
        </button>
        {list?.builtin.map((r) => cell(r, false))}
        {list?.uploads.map((r) => cell(r, true))}
      </div>
      <div className="ico-up">
        <input ref={file} type="file" accept={ACCEPT} disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        <small className="hint">PNG / JPEG / WebP / GIF、512KB まで（正方形がきれい）。SVG は使えません。</small>
      </div>
      {err && <div className="warn" role="alert">{err}</div>}
    </fieldset>
  );
}
