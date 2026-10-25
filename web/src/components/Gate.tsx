'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Me, Role } from '@/lib/types';

const MeContext = createContext<Me['user']>(null);
export const useMe = () => useContext(MeContext);

/** ログインを確かめてから中身を出す。未ログインならログイン画面へ。role="admin" は管理者だけ */
export function Gate({ role = 'user', children }: { role?: Role; children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.me().then((m) => {
      if (m.authEnabled && !m.user) location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      else setMe(m);
    }).catch((e) => setErr((e as Error).message));
  }, []);
  if (err) return <p style={{ padding: 24 }}>API に接続できません: {err}</p>;
  if (!me || (me.authEnabled && !me.user)) return null;
  // ログイン無効（PORTAL_AUTH=0）のときは全員が管理者
  const user = me.user ?? { username: '', role: 'admin' as Role };
  if (role === 'admin' && user.role !== 'admin') {
    return <p style={{ padding: 24 }}>このページは管理者だけが使えます。<a className="navlink" href="/">← ポータルへ戻る</a></p>;
  }
  return <MeContext.Provider value={me.user ? user : null}>{children}</MeContext.Provider>;
}

/** ヘッダーの利用者メニュー: 名前・ロール、パスワード変更、ログアウト。ログイン無効のときは何も出さない */
export function UserMenu() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [msg, setMsg] = useState('');
  if (!me) return null;
  const logout = async () => { try { await api.logout(); } finally { location.assign('/login'); } };
  const change = async () => {
    try { await api.changePassword(cur, next); setMsg('変更しました'); setCur(''); setNext(''); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <span className="pill" title={me.role === 'admin' ? '管理者' : '利用者'}>👤 {me.username}{me.role === 'admin' ? '（管理者）' : ''}</span>
      <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); setMsg(''); }}>
        <Dialog.Trigger asChild><button title="パスワードを変更">🔑</button></Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="dlg-overlay" />
          <Dialog.Content className="dlg" aria-describedby={undefined}>
            <Dialog.Title>パスワードの変更</Dialog.Title>
            <label>現在のパスワード<input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
            <label>新しいパスワード（10 文字以上）<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
            {msg && <p role="status">{msg}</p>}
            <menu><Dialog.Close asChild><button type="button">閉じる</button></Dialog.Close><button className="primary" type="button" onClick={change} disabled={!cur || !next}>変更</button></menu>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <button onClick={logout}>ログアウト</button>
    </>
  );
}
