import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, PANELS, REGIONS, hitRegion, insertIndex, isEmpty, movePanel, normalize, resizePair } from './layout-model';

const L0 = normalize(null);
describe('layout', () => {
  it('既定', () => expect(L0.regions).toEqual({ left: ['list', 'flow', 'trace'], right: ['chat'], bottom: [] }));
  it('壊れた保存値は既定の配置（サイズは活かす）', () => {
    const n = normalize({ regions: { left: ['list'], right: ['list'], bottom: [] }, rightW: 500 });
    expect([n.regions, n.rightW]).toEqual([DEFAULT_LAYOUT.regions, 500]);
  });
  it('型違い・範囲外', () => { const n = normalize({ rightW: 'x', bottomH: 99999 }); expect([n.rightW, n.bottomH]).toEqual([420, 1500]); });
  it('movePanel', () => {
    const m = movePanel(L0, 'flow', 'right', 0);
    expect([m.regions.left, m.regions.right]).toEqual([['list', 'trace'], ['flow', 'chat']]);
    expect(movePanel(L0, 'list', 'left', 2).regions.left).toEqual(['flow', 'trace', 'list']);
    expect(movePanel(L0, 'trace', 'bottom', 0).regions.bottom).toEqual(['trace']);
    expect(isEmpty(movePanel(L0, 'chat', 'left', 0), 'right')).toBe(true);
    expect([...REGIONS.flatMap((k) => m.regions[k])].sort()).toEqual([...PANELS].sort());
    expect(movePanel(L0, 'nope' as never, 'left', 0)).toBe(L0);
  });
  it('hitRegion / insertIndex', () => {
    const R = { left: { left: 0, top: 0, right: 600, bottom: 500 }, right: { left: 610, top: 0, right: 1000, bottom: 500 }, bottom: { left: 0, top: 510, right: 1000, bottom: 700 } };
    expect([hitRegion(R, 300, 100), hitRegion(R, 800, 100), hitRegion(R, 300, 600), hitRegion(R, 1500, 1500)]).toEqual(['left', 'right', 'bottom', null]);
    const rs = [{ top: 0, bottom: 100, left: 0, right: 200 }, { top: 110, bottom: 300, left: 210, right: 400 }];
    expect([insertIndex(rs, 'y', 0, 20), insertIndex(rs, 'y', 0, 90), insertIndex(rs, 'y', 0, 400)]).toEqual([0, 1, 2]);
    expect([insertIndex(rs, 'x', 50, 0), insertIndex(rs, 'x', 150, 0), insertIndex(rs, 'x', 390, 0)]).toEqual([0, 1, 2]);
  });
  it('resizePair', () => {
    const W = { list: 3, chat: 1, flow: 2, trace: 2 };
    const W2 = resizePair(W, 'flow', 'trace', 50, 400);
    expect([W2.flow + W2.trace, W2.flow > W.flow, W2.list]).toEqual([4, true, 3]);
    expect(resizePair(W, 'flow', 'trace', -9999, 400).flow).toBeGreaterThanOrEqual(4 * 0.12 - 1e-9);
  });
});
