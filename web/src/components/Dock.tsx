'use client';
// パネルのドッキング（ADR 0024）。パネルの見出し（data-handle）をドラッグして別の領域へ移し、境界をドラッグしてサイズを変える。
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_LAYOUT, REGIONS, axisOf, clamp, hitRegion, insertIndex, movePanel, normalize, resizePair, type Layout, type PanelId, type Rect, type RegionId } from '@/lib/layout-model';

const KEY = 'portal.layout';
const rectOf = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };

export function Dock({ panels }: { panels: Record<PanelId, React.ReactNode> }) {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [drag, setDrag] = useState<{ id: PanelId; hot: RegionId | null } | null>(null);
  const [mark, setMark] = useState<Rect | null>(null);
  const pageEl = useRef<HTMLDivElement>(null);
  const live = useRef(layout); live.current = layout;

  useEffect(() => { try { setLayout(normalize(JSON.parse(localStorage.getItem(KEY) || 'null'))); } catch { /* 既定 */ } }, []);
  const commit = useCallback((l: Layout) => { setLayout(l); try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* 保存できなくても動く */ } }, []);

  // パネルの移動
  const startMove = (id: PanelId) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    const regionRects = () => Object.fromEntries(REGIONS.map((k) => [k, rectOf(pageEl.current!.querySelector(`[data-region="${k}"]`)!)])) as Record<RegionId, Rect>;
    let target: { region: RegionId; index: number } | null = null;
    setDrag({ id, hot: null }); document.body.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      const region = hitRegion(regionRects(), ev.clientX, ev.clientY);
      if (!region) { target = null; setMark(null); setDrag({ id, hot: null }); return; }
      const els = [...pageEl.current!.querySelectorAll(`[data-region="${region}"] > [data-panel]`)].filter((p) => (p as HTMLElement).dataset.panel !== id);
      const axis = axisOf(region);
      const index = insertIndex(els.map(rectOf), axis, ev.clientX, ev.clientY);
      const reg = regionRects()[region];
      let m: Rect;
      if (!els.length) m = { left: reg.left + 4, right: reg.right - 4, top: reg.top + 4, bottom: reg.top + 8 };
      else if (axis === 'y') { const y = index < els.length ? rectOf(els[index]).top : rectOf(els[els.length - 1]).bottom; m = { left: reg.left, right: reg.right, top: y - 2, bottom: y + 2 }; }
      else { const x = index < els.length ? rectOf(els[index]).left : rectOf(els[els.length - 1]).right; m = { left: x - 2, right: x + 2, top: reg.top, bottom: reg.bottom }; }
      target = { region, index }; setMark(m); setDrag({ id, hot: region });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging'); setDrag(null); setMark(null);
      if (target) commit(movePanel(live.current, id, target.region, target.index));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };

  // 境界（領域どうし・パネルどうし）のサイズ変更
  const startResize = (apply: (l: Layout, d: number) => Layout, axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault();
    const base = live.current; let last = axis === 'x' ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => { const p = axis === 'x' ? ev.clientX : ev.clientY; const d = p - last; last = p; setLayout((l) => apply(l, d)); void base; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit(live.current); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const empty = REGIONS.filter((k) => !layout.regions[k].length);

  const region = (k: RegionId) => {
    const ids = layout.regions[k];
    const axis = axisOf(k);
    return (
      <section className={`region${drag?.hot === k ? ' hot' : ''}`} id={`region-${k}`} data-region={k} key={k}>
        {ids.map((id, i) => (
          <PanelWrap key={id} id={id} weight={layout.weights[id]} src={drag?.id === id} onHandle={startMove(id)}
            splitter={i > 0 ? { cls: axis === 'y' ? 'pv' : 'ph', onDown: (e) => {
              const prev = ids[i - 1], el = (e.currentTarget as HTMLElement).parentElement!.querySelector(`[data-panel="${prev}"]`)!.getBoundingClientRect();
              const next = (e.currentTarget as HTMLElement).nextElementSibling!.getBoundingClientRect();
              const size = axis === 'y' ? el.height + next.height : el.width + next.width;
              startResize((l, d) => ({ ...l, weights: resizePair(l.weights, prev, id, d, size) }), axis === 'y' ? 'y' : 'x')(e);
            } } : undefined}>
            {panels[id]}
          </PanelWrap>
        ))}
      </section>
    );
  };

  return (
    <div ref={pageEl} className={`page${drag ? ' dragging' : ''}`} id="page" data-empty={empty.join(' ')}
      style={{ ['--right-w' as string]: `${layout.rightW}px`, ['--bottom-h' as string]: `${layout.bottomH}px` }}>
      {region('left')}
      <div className="splitter v" id="splitR" role="separator" aria-orientation="vertical" title="ドラッグで左右のサイズ変更（ダブルクリックで既定に戻す）"
        onPointerDown={startResize((l, d) => ({ ...l, rightW: clamp(l.rightW - d, 240, 2000) }), 'x')} onDoubleClick={() => commit({ ...layout, rightW: DEFAULT_LAYOUT.rightW })} />
      {region('right')}
      <div className="splitter h" id="splitB" role="separator" aria-orientation="horizontal" title="ドラッグで上下のサイズ変更（ダブルクリックで既定に戻す）"
        onPointerDown={startResize((l, d) => ({ ...l, bottomH: clamp(l.bottomH - d, 140, 1500) }), 'y')} onDoubleClick={() => commit({ ...layout, bottomH: DEFAULT_LAYOUT.bottomH })} />
      {region('bottom')}
      {mark && <div id="dropMark" style={{ left: mark.left, top: mark.top, width: mark.right - mark.left, height: mark.bottom - mark.top }} />}
    </div>
  );
}

function PanelWrap({ id, weight, src, onHandle, splitter, children }: { id: PanelId; weight: number; src: boolean; onHandle: (e: React.PointerEvent) => void; splitter?: { cls: string; onDown: (e: React.PointerEvent) => void }; children: React.ReactNode }) {
  return (
    <>
      {splitter && <div className={splitter.cls} role="separator" onPointerDown={splitter.onDown} />}
      <section className={`panel${src ? ' drag-src' : ''}`} id={`panel-${id}`} data-panel={id} style={{ ['--w' as string]: weight }}
        onPointerDownCapture={(e) => { if ((e.target as HTMLElement).closest('[data-handle]')) onHandle(e); }}>
        {children}
      </section>
    </>
  );
}
