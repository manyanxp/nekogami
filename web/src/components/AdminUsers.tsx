'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Role, UserRow } from '@/lib/types';
import { useMe } from './Gate';

type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

/** ユーザー管理（管理者だけ）: 追加、ロール変更、無効化、パスワード再設定、削除 */
export function UsersCard({ guarded }: { guarded: Guard }) {
  const me = useMe();
  const [items, setItems] = useState<UserRow[]>([]);
  const [f, setF] = useState({ username: '', password: '', role: 'user' as Role });
  const reload = useCallback(async () => { const r = await guarded(api.users); if (r) setItems(r); }, [guarded]);
  useEffect(() => { void reload(); }, [reload]);
  const run = (fn: () => Promise<unknown>) => void guarded(async () => { await fn(); await reload(); });
  const reset = (u: UserRow) => {
    const pw = window.prompt(`${u.username} の新しいパスワード（10 文字以上）。変更すると、その人はログインし直しになります`);
    if (pw) run(() => api.updateUser(u.username, { password: pw }));
  };
  return (
    <section className="card" id="usersCard">
      <h2>👥 ユーザー</h2>
      <p className="hint">管理者は管理ページとユーザー管理が使えます。利用者はポータルの閲覧とチャットだけです。会話は人ごとに別です。</p>
      <ul className="plain">
        {items.map((u) => {
          const self = u.username === me?.username;
          return (
            <li key={u.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', opacity: u.disabled ? 0.5 : 1 }}>
              <b>{u.username}</b>{self && <span className="pill">自分</span>}
              <select value={u.role} disabled={self} aria-label={`${u.username} のロール`} onChange={(e) => run(() => api.updateUser(u.username, { role: e.target.value }))}>
                <option value="user">利用者</option><option value="admin">管理者</option>
              </select>
              <span className="grow" />
              <button onClick={() => reset(u)} title="パスワードを再設定">🔑</button>
              <button disabled={self} onClick={() => run(() => api.updateUser(u.username, { disabled: !u.disabled }))}>{u.disabled ? '有効にする' : '無効にする'}</button>
              <button disabled={self} onClick={() => { if (window.confirm(`${u.username} を削除します。会話も消えます`)) run(() => api.removeUser(u.username)); }}>削除</button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.createUser(f); setF({ username: '', password: '', role: 'user' }); }); }} style={{ display: 'grid', gap: 6 }}>
        <input placeholder="ユーザー名（英小文字・数字・_ -）" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} pattern="[a-z0-9][a-z0-9_\-]{0,31}" required autoComplete="off" />
        <input type="password" placeholder="初期パスワード（10 文字以上）" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={10} required autoComplete="new-password" />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="user">利用者</option><option value="admin">管理者</option></select>
        <button className="primary">＋ ユーザーを追加</button>
      </form>
    </section>
  );
}
