import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: '猫神さま Portal', description: '猫神さま（オーケストレーター）と配下のエージェントの管理ポータル', icons: { icon: '/neko-goddess.png' } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
