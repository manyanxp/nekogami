import { describe, expect, it } from 'vitest';
import { CLOSE_AFTER, cascade, clampPos, diffStates, freeSlot, linesOf, runStates } from './terminal-model';
import { newTrace, reduce } from './trace-model';

const route = (to: string, id: string) => ({ kind: 'trace' as const, event: 'PreToolUse', toolUseId: id, route: { to, via: 'agent' as const } });

describe('terminal-model', () => {
  it('実行中になったら開き、終わったら終了として扱う', () => {
    const t = newTrace();
    let prev = runStates(t);
    reduce(t, route('azure-architect', 'u1'));
    let d = diffStates(prev, runStates(t)); prev = runStates(t);
    expect(d).toEqual({ open: ['azure-architect'], finish: [] });
    reduce(t, { kind: 'trace', event: 'PostToolUse', toolUseId: 'u1', toolName: 'Agent' });
    d = diffStates(prev, runStates(t));
    expect(d).toEqual({ open: [], finish: ['azure-architect'] });
    expect(CLOSE_AFTER).toBe(5000);
  });
  it('開始から終了までが 1 回の更新にまとまっても、開いてから閉じる', () => {
    const t = newTrace(); const prev = runStates(t);
    reduce(t, route('a', '1')); reduce(t, { kind: 'trace', event: 'PostToolUse', toolUseId: '1' });
    expect(diffStates(prev, runStates(t))).toEqual({ open: ['a'], finish: ['a'] });
  });
  it('同じ相手をもう一度呼ぶと、また開く', () => {
    const t = newTrace(); reduce(t, route('a', '1')); reduce(t, { kind: 'trace', event: 'PostToolUse', toolUseId: '1' });
    const prev = runStates(t); reduce(t, route('a', '2'));
    expect(diffStates(prev, runStates(t)).open).toEqual(['a']);
  });
  it('トレースが空に戻ったら、実行中だったものは終了扱い', () => {
    const t = newTrace(); reduce(t, route('a', '1'));
    expect(diffStates(runStates(t), runStates(newTrace()))).toEqual({ open: [], finish: ['a'] });
  });
  it('その相手の行だけ取り出す（選ばれた行も含む）', () => {
    const t = newTrace(); const lines = [
      reduce(t, route('a', '1')), reduce(t, { kind: 'trace', event: 'PreToolUse', agentType: 'a', agentId: 'x', toolName: 'Read', input: 'f' }),
      reduce(t, { kind: 'trace', event: 'PreToolUse', agentType: 'b', agentId: 'y', toolName: 'Grep' }),
    ].filter((l) => l !== null);
    expect(linesOf(lines, 'a').map((l) => l.text.slice(0, 4))).toEqual(['→ a ', 'Read']);
  });
  it('開く位置は左上から始まり、ずらしながら並び、画面の中に収まる', () => {
    const a = cascade(0, 1500, 900), b = cascade(1, 1500, 900);
    expect(a.x).toBeLessThan(100); expect(a.y).toBeLessThan(100);
    expect(b.x).toBeGreaterThan(a.x); expect(b.y).toBeGreaterThan(a.y);
    expect(cascade(0, 300, 200).x).toBeGreaterThanOrEqual(8);
  });
  it('空いている最初の位置を使う（閉じた窓の位置は再利用する）', () => {
    const p0 = cascade(0, 1500, 900), p1 = cascade(1, 1500, 900), p2 = cascade(2, 1500, 900);
    expect(freeSlot([], 1500, 900)).toEqual(p0);
    expect(freeSlot([p0], 1500, 900)).toEqual(p1);
    expect(freeSlot([p0, p2], 1500, 900)).toEqual(p1);
    expect(freeSlot([p0, p1, p2], 1500, 900)).toEqual(cascade(3, 1500, 900));
  });
  it('ドラッグしても、タイトルバーが画面の外に出きらない', () => {
    expect(clampPos(5000, 5000, 1500, 900)).toEqual({ x: 1380, y: 864 });
    expect(clampPos(-5000, -50, 1500, 900).y).toBe(0);
    expect(clampPos(-5000, 0, 1500, 900).x).toBeLessThan(0);
  });
});
