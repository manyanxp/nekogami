// ポータルのパネル配置（ドッキング）の純粋ロジック。ADR 0024。
// パネル 4 つ（一覧・チャット・委任フロー・トレース）を、3 つの領域（左の列・右の列・下の行）に、順番つきで置く。
export const PANELS = ['list', 'chat', 'flow', 'trace'] as const;
export const REGIONS = ['left', 'right', 'bottom'] as const;
export type PanelId = (typeof PANELS)[number];
export type RegionId = (typeof REGIONS)[number];
export interface Layout { regions: Record<RegionId, PanelId[]>; rightW: number; bottomH: number; weights: Record<PanelId, number> }
export interface Rect { left: number; right: number; top: number; bottom: number }

export const DEFAULT_LAYOUT: Layout = {
  regions: { left: ['list', 'flow', 'trace'], right: ['chat'], bottom: [] },
  rightW: 420,     // 右の列の幅（px）
  bottomH: 260,    // 下の行の高さ（px）
  weights: { list: 2, chat: 1, flow: 3, trace: 1.6 },   // 列の中の高さ（下の行では幅）の比
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** 保存値を検証して使える形にする。パネルが重複・欠落・未知のものを含むときは、既定の配置に戻す（サイズは活かす） */
export function normalize(saved: unknown): Layout {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Layout>;
  const d = clone(DEFAULT_LAYOUT);
  const r = s.regions as Record<string, unknown> | undefined;
  const flat = r && typeof r === 'object' ? REGIONS.flatMap((k) => (Array.isArray(r[k]) ? (r[k] as string[]) : [])) : [];
  const valid = flat.length === PANELS.length && PANELS.every((p) => flat.filter((x) => x === p).length === 1);
  const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def);
  const weights = { ...d.weights };
  for (const p of PANELS) weights[p] = num(s.weights?.[p], d.weights[p], 0.2, 20);
  return {
    regions: valid ? (Object.fromEntries(REGIONS.map((k) => [k, [...(r![k] as PanelId[])]])) as Layout['regions']) : d.regions,
    rightW: num(s.rightW, d.rightW, 240, 2000),
    bottomH: num(s.bottomH, d.bottomH, 140, 1500),
    weights,
  };
}

/** パネルを、領域 region の index 番目へ移す（元の場所からは抜く）。返すのは新しい配置 */
export function movePanel(layout: Layout, id: PanelId, region: RegionId, index: number): Layout {
  if (!PANELS.includes(id) || !REGIONS.includes(region)) return layout;
  const regions = Object.fromEntries(REGIONS.map((k) => [k, layout.regions[k].filter((p) => p !== id)])) as Layout['regions'];
  regions[region].splice(clamp(index, 0, regions[region].length), 0, id);
  return { ...layout, regions };
}

/** 点 (x, y) が、どの領域の矩形の中か。空の領域も対象（ドラッグ中は表示される）。なければ null */
export function hitRegion(rects: Partial<Record<RegionId, Rect>>, x: number, y: number): RegionId | null {
  return REGIONS.find((k) => { const r = rects[k]; return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }) ?? null;
}

/** 領域の中の挿入位置。panelRects は今の並び順の矩形。縦の列では y、下の行では x を、各パネルの中点と比べる */
export function insertIndex(panelRects: Rect[], axis: 'x' | 'y', x: number, y: number): number {
  const p = axis === 'x' ? x : y;
  let i = 0;
  for (const r of panelRects) { const mid = axis === 'x' ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2; if (p > mid) i += 1; }
  return i;
}

/** 隣り合う 2 つのパネルの境界を delta(px) 動かしたときの、重みの変更。size は 2 つの合計の長さ（px） */
export function resizePair(weights: Layout['weights'], a: PanelId, b: PanelId, delta: number, size: number): Layout['weights'] {
  const total = weights[a] + weights[b];
  const wa = clamp(weights[a] + (delta / size) * total, total * 0.12, total * 0.88);
  return { ...weights, [a]: wa, [b]: total - wa };
}

export const isEmpty = (layout: Layout, region: RegionId) => layout.regions[region].length === 0;
export const axisOf = (region: RegionId): 'x' | 'y' => (region === 'bottom' ? 'x' : 'y');
