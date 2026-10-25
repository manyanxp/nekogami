'use client';
// マークダウンのプレビュー（react-markdown + remark-gfm）。生 HTML は描画しない（rehype-raw を使わない）。
// ```html / ```svg は、サンドボックス化した iframe（CSP で通信・外部読み込みを禁止）に表示する。ADR 0029。
import { useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const FRAME_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
const wrap = (code: string, lang: string) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><body style="margin:8px;font:14px system-ui">${lang === 'svg' && !/^\s*<svg/i.test(code) ? `<svg xmlns="http://www.w3.org/2000/svg">${code}</svg>` : code}`;

function CopyButton({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* クリップボード不可 */ } }}>{done ? 'コピー済' : label}</button>;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const previewable = lang === 'html' || lang === 'svg';
  const [preview, setPreview] = useState(previewable);
  return (
    <div className="codeblock">
      <div className="cb-head"><span>{lang || 'text'}</span>
        {previewable && <button type="button" onClick={() => setPreview((p) => !p)}>{preview ? 'コード' : 'プレビュー'}</button>}
        <CopyButton text={code} />
      </div>
      {previewable && preview
        ? <iframe className="cb-frame" title={`${lang} プレビュー`} sandbox="" srcDoc={wrap(code, lang)} />
        : <pre><code>{code}</code></pre>}
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const text = String(children ?? '');
    const m = /language-([\w-]+)/.exec(className || '');
    if (!m && !text.includes('\n')) return <code>{children}</code>;
    return <CodeBlock lang={m?.[1] || ''} code={text.replace(/\n$/, '')} />;
  },
  a: ({ href, children }) => (/^(https?:|mailto:|#)/i.test(href || '') ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>),
  table: ({ children }) => <div className="tbl"><table>{children}</table></div>,
};

export function Markdown({ text }: { text: string }) {
  const el = useMemo(() => <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>, [text]);
  return <div className="md">{el}</div>;
}

/** 回答の吹き出し。マークダウンのプレビューと原文の切り替え、全文コピー */
export function AnswerBody({ text }: { text: string }) {
  const [src, setSrc] = useState(false);
  return (
    <div className="rendered">
      <div className="md-bar">
        <button type="button" onClick={() => setSrc((s) => !s)}>{src ? 'プレビュー' : '原文'}</button>
        <CopyButton text={text} label="全文コピー" />
      </div>
      {src ? <pre className="md-src" style={{ display: 'block' }}>{text}</pre> : <Markdown text={text} />}
    </div>
  );
}
