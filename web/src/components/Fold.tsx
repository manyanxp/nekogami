'use client';
import type { ReactNode } from 'react';

/** 管理ページの左の列の、プロパティごとの開閉（既定は閉じる。ADR 0044）。開閉の状態は、画面の中だけで持つ */
export function Fold({ id, title, children, open = false, className = '' }: { id?: string; title: ReactNode; children?: ReactNode; open?: boolean; className?: string }) {
  return (
    <section className={`card fold ${className}`.trim()} id={id}>
      <details open={open}>
        <summary><h2>{title}</h2></summary>
        <div className="fold-body">{children}</div>
      </details>
    </section>
  );
}
