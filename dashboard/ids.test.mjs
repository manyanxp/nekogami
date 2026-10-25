// node --test dashboard/ids.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanIds, readIds } from './ids.mjs';

const ID = '675338d4-7384-5de1-a5ee-e1924ddbe4e4';
test('台帳から名前 → UUID を取り出す', () => assert.deepEqual(cleanIds({ entities: [{ name: 'a', id: ID.toUpperCase() }] }), { a: ID }));
test('不正な名前・UUID・形は捨てる', () => {
  assert.deepEqual(cleanIds({ entities: [{ name: 'bad name', id: ID }, { name: 'x', id: 'nope' }, null, { name: 'ok', id: ID }] }), { ok: ID });
  assert.deepEqual(cleanIds(null), {}); assert.deepEqual(cleanIds({ entities: 5 }), {});
});
test('ファイルが無い・壊れていても空', () => assert.deepEqual(readIds('/nonexistent/registry.json'), {}));
