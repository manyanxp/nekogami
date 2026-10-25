// DNS リバインディング対策: Host が許可リストにないリクエストは拒否する。
// 中継（rewrites）で Host が書き換わる前の、ブラウザが送ってきた Host をここで検査する。
import { NextResponse, type NextRequest } from 'next/server';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const extra = (process.env.PORTAL_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function hostOk(host: string | null, bindLocal = true): boolean {
  if (!bindLocal) return true;   // 0.0.0.0 などで公開する運用では、前段（リバースプロキシ）で制限する
  if (!host) return false;
  const name = host.toLowerCase().replace(/:\d+$/, '');
  return LOCAL.has(name) || extra.includes(name);
}

export function middleware(req: NextRequest) {
  const bindLocal = (process.env.PORTAL_BIND || '127.0.0.1') === '127.0.0.1';
  if (!hostOk(req.headers.get('host'), bindLocal)) return new NextResponse('forbidden host', { status: 403 });
  // 未ログイン（セッション Cookie なし）のページ要求はログイン画面へ。中身の検査は API が行う（Cookie の有無だけ見る）
  const { pathname, search } = req.nextUrl;
  if (!pathname.startsWith('/api/') && pathname !== '/login' && !/\.[a-z0-9]+$/i.test(pathname) && !req.cookies.has('neko_session') && process.env.PORTAL_AUTH !== '0') {
    const url = req.nextUrl.clone();
    url.pathname = '/login'; url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
