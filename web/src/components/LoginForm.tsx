'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** 戻り先は同じサイト内のパスだけ（//evil.example などへ飛ばさない） */
export const safeNext = (n: string | null) => (n && /^\/(?![/\\])/.test(n) ? n : '/');

export default function LoginForm() {
  const [name, setName] = useState(''); const [pw, setPw] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [setup, setSetup] = useState(false);
  useEffect(() => { api.me().then((m) => { if (m.user || !m.authEnabled) location.replace(safeNext(new URLSearchParams(location.search).get('next'))); else setSetup(m.setup); }).catch(() => {}); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.login(name.trim(), pw); location.assign(safeNext(new URLSearchParams(location.search).get('next'))); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ maxWidth: 360, margin: '12vh auto', display: 'grid', gap: 12, padding: 24 }} className="panel">
      <h1 style={{ fontSize: 20 }}>🐾 猫神さま Portal</h1>
      {setup && <p role="alert">ユーザーがまだいません。<code>PORTAL_ADMIN_USER</code> / <code>PORTAL_ADMIN_PASSWORD</code> を設定して api を起動し直すか、<code>python -m portal_api users add 名前 --role admin</code> で作ってください。</p>}
      <label>ユーザー名<input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>パスワード<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      {err && <p role="alert" style={{ color: 'var(--bad, #e66)' }}>{err}</p>}
      <button className="primary" disabled={busy || !name || !pw}>ログイン</button>
    </form>
  );
}
