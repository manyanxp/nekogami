// ポータルの管理ページで設定したテーマ（portal/data/theme.json）を読む。値は検証してから配信する（ADR 0024）。
import fs from 'node:fs';

const MODES = ['auto', 'dark', 'light'];
export const DEFAULT_THEME = { mode: 'auto', accent: null, preset: 'default' };

export function cleanTheme(d) {
  if (!d || typeof d !== 'object') return { ...DEFAULT_THEME };
  return {
    mode: MODES.includes(d.mode) ? d.mode : 'auto',
    accent: typeof d.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent.toLowerCase() : null,
    preset: typeof d.preset === 'string' && /^[a-z0-9-]{1,24}$/.test(d.preset) ? d.preset : 'default',
  };
}

export function readTheme(file) {
  try { return cleanTheme(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return { ...DEFAULT_THEME }; }
}
