// テーマ（モード・アクセント色）の適用。管理ページで設定し、ポータルと Agent Console が同じ設定を読む（ADR 0025）。
import type { Theme } from './types';

export const PRESETS: { id: string; label: string; accent: string | null }[] = [
  { id: 'default', label: '既定', accent: null },
  { id: 'mint', label: 'ミント', accent: '#5be3b0' },
  { id: 'blue', label: 'ブルー', accent: '#3b8eea' },
  { id: 'purple', label: 'パープル', accent: '#9b7bff' },
  { id: 'pink', label: 'ピンク', accent: '#ff7eb6' },
  { id: 'orange', label: 'オレンジ', accent: '#f0975a' },
  { id: 'green', label: 'グリーン', accent: '#4fbf6f' },
  { id: 'red', label: 'レッド', accent: '#ff6b6b' },
];
export const DEFAULT_THEME: Theme = { mode: 'auto', accent: null, preset: 'default' };
const KEY = 'portal.theme';
const HEX = /^#[0-9a-f]{6}$/i;

/** アクセント色の上に載せる文字色（明るい色なら黒、暗い色なら白）。相対輝度で決める */
export function accentInk(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#04120c' : '#ffffff';
}

export function applyTheme(t: Partial<Theme> | null | undefined, root: HTMLElement = document.documentElement) {
  const mode = t?.mode === 'dark' || t?.mode === 'light' ? t.mode : null;
  if (mode) root.dataset.theme = mode; else delete root.dataset.theme;
  if (t?.accent && HEX.test(t.accent)) { root.style.setProperty('--accent', t.accent); root.style.setProperty('--accent-ink', accentInk(t.accent)); }
  else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-ink'); }
}

/** 保存済みのテーマ（localStorage に控え）をすぐ適用してから、サーバーの設定で更新する */
export async function loadTheme(fetchTheme: () => Promise<Theme>): Promise<Theme | null> {
  try { const c = localStorage.getItem(KEY); if (c) applyTheme(JSON.parse(c)); } catch { /* 控えが無くても動く */ }
  try {
    const t = await fetchTheme();
    applyTheme(t);
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* 保存できなくても動く */ }
    return t;
  } catch { return null; }
}
export const saveThemeCache = (t: Theme) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* 保存できなくても動く */ } };
