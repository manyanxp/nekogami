// node --test dashboard/theme.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTheme, readTheme, DEFAULT_THEME } from './theme.mjs';

test('正しい値はそのまま（accent は小文字に）', () => assert.deepEqual(cleanTheme({ mode: 'dark', accent: '#5BE3B0', preset: 'mint' }), { mode: 'dark', accent: '#5be3b0', preset: 'mint' }));
test('不正な値は既定に落とす（CSS への混入を防ぐ）', () => {
  assert.deepEqual(cleanTheme({ mode: 'neon', accent: 'red; background:url(x)', preset: '<script>' }), DEFAULT_THEME);
  assert.deepEqual(cleanTheme(null), DEFAULT_THEME);
});
test('ファイルが無い・壊れていれば既定', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-'));
  assert.deepEqual(readTheme(path.join(dir, 'none.json')), DEFAULT_THEME);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{broken');
  assert.deepEqual(readTheme(path.join(dir, 'bad.json')), DEFAULT_THEME);
  fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ mode: 'light', accent: '#0a6cd6' }));
  assert.equal(readTheme(path.join(dir, 'ok.json')).mode, 'light');
});
