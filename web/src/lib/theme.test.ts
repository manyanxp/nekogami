import { describe, expect, it } from 'vitest';
import { accentInk, PRESETS } from './theme';

describe('theme', () => {
  it('accentInk', () => expect([accentInk('#5be3b0'), accentInk('#0a6cd6'), accentInk('#ffffff'), accentInk('#000000')]).toEqual(['#04120c', '#ffffff', '#04120c', '#ffffff']));
  it('プリセット', () => expect(PRESETS.every((p) => !p.accent || /^#[0-9a-f]{6}$/.test(p.accent))).toBe(true));
});
