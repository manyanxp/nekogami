// node --test dashboard/nya.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nyaify } from './nya.mjs';

test('語尾に付ける', () => assert.equal(nyaify('調査しました'), '調査しましたにゃ'));
test('句読点の手前に入れる', () => {
  assert.equal(nyaify('完了しました。'), '完了しましたにゃ。');
  assert.equal(nyaify('できた！\n'), 'できたにゃ！\n');
});
test('複数行は最後の行の末尾', () => assert.equal(nyaify('一行目。\n二行目'), '一行目。\n二行目にゃ'));
test('冪等', () => {
  assert.equal(nyaify('完了にゃ'), '完了にゃ');
  assert.equal(nyaify(nyaify('完了。')), '完了にゃ。');
});
test('コードブロックで終わる場合は次の行', () => assert.equal(nyaify('例:\n```\nx\n```'), '例:\n```\nx\n```\nにゃ'));
test('省略表示の手前に入れる', () => assert.equal(nyaify('長い\n…(+120 chars)'), '長いにゃ\n…(+120 chars)'));
test('空・非文字列・無効化はそのまま', () => {
  assert.equal(nyaify(''), '');
  assert.equal(nyaify('。。'), '。。');
  assert.equal(nyaify(undefined), undefined);
  assert.equal(nyaify('abc', ''), 'abc');
});
