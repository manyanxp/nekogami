// /api/* は FastAPI（ポータルのバックエンド）へ中継する。Agent Console へは FastAPI が（管理者だけに）中継する。ログインの検査も FastAPI。
// ブラウザからは同一オリジンに見えるので CORS は不要。SSE を壊さないよう圧縮は切る。
const API = process.env.PORTAL_API_URL || 'http://127.0.0.1:4401';

/** @type {import('next').NextConfig} */
export default {
  compress: false,
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },   // next/image は使わない（sharp のスタブを入れている。vendor/sharp-stub）
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
    ];
  },
};
