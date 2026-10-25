// エージェントごとのターミナル窓（ポータル）の純粋ロジック。ADR 0033。
import { stateOf, statsOf, type RunState } from './flow-model';
import type { LogLine, Trace } from './trace-model';

export const WIN_W = 440;
export const WIN_H = 280;
/** 終了してから自動で閉じるまでの時間（ms） */
export const CLOSE_AFTER = 5000;

export interface Snap { state: RunState; inst: number }
export const runStates = (trace: Trace): Record<string, Snap> => Object.fromEntries([...trace.agents].map(([n, a]) => { const s = statsOf(a); return [n, { state: stateOf(s), inst: s.inst }]; }));

/**
 * 前回と今回の差。open = 新しく実行が始まった（実行回数が増えた。開始から終了までが 1 回の更新にまとまっても開く）、
 * finish = 今は実行中でない（開いたものは、終了表示 → 自動で閉じる）
 */
export function diffStates(prev: Record<string, Snap>, next: Record<string, Snap>): { open: string[]; finish: string[] } {
  const open: string[] = [], finish: string[] = [];
  for (const n of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[n] || { state: 'idle', inst: 0 }, b = next[n] || { state: 'idle', inst: 0 };
    const started = b.inst > a.inst;
    if (started) open.push(n);
    if ((started && b.state !== 'run') || (a.state === 'run' && b.state !== 'run')) finish.push(n);
  }
  return { open, finish };
}

/** その相手の行だけ（その相手の動きと、その相手が選ばれた行） */
export const linesOf = (lines: LogLine[], name: string): LogLine[] => lines.filter((l) => l.who === name || l.to === name);

/** 開く位置の候補 n 番目。左上から少しずつずらし（6 つで一巡）、画面の外に出ない */
export function cascade(n: number, vw: number, vh: number): { x: number; y: number } {
  const step = n % 6;
  return { x: Math.max(8, Math.min(vw - WIN_W - 8, 16 + step * 28)), y: Math.max(8, Math.min(vh - WIN_H - 8, 64 + step * 34)) };
}

/** 開いている窓と重ならない（同じ位置にない）最初の候補。全部埋まっていたら、窓の数で一巡する */
export function freeSlot(taken: { x: number; y: number }[], vw: number, vh: number): { x: number; y: number } {
  for (let n = 0; n < 6; n++) {
    const c = cascade(n, vw, vh);
    if (!taken.some((t) => Math.abs(t.x - c.x) < 20 && Math.abs(t.y - c.y) < 20)) return c;
  }
  return cascade(taken.length, vw, vh);
}

export const clampPos = (x: number, y: number, vw: number, vh: number): { x: number; y: number } =>
  ({ x: Math.min(Math.max(x, 8 - WIN_W + 120), vw - 120), y: Math.min(Math.max(y, 0), vh - 36) });
