import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DirBox, buildDirServers, checkDirAccess, loadDirNodes, validRel } from './fs-tools.mjs';

const mk = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-tools-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  return { root, outside };
};
const node = (perms, p = 'docs') => ({ name: 'docs', path: p, description: '', perms: { list: false, read: false, write: false, delete: false, ...perms } });

test('権限のない操作は拒否する（既定はすべてオフ）', () => {
  const { root } = mk();
  const b = new DirBox(root, node({}));
  for (const f of [() => b.list(), () => b.read('a'), () => b.write('a', 'x'), () => b.delete('a')]) assert.throws(f, /権限がない/);
});

test('書き込み・読み込み・参照・削除', () => {
  const { root } = mk();
  const b = new DirBox(root, node({ list: true, read: true, write: true, delete: true }, 'a/docs'));
  b.write('sub/hello.txt', 'こんにちは');
  assert.equal(b.read('sub/hello.txt'), 'こんにちは');
  assert.match(b.list(), /sub\//);
  assert.match(b.list('sub'), /hello\.txt/);
  assert.throws(() => b.delete('sub'), /空でない/);
  b.delete('sub/hello.txt'); b.delete('sub');
  assert.equal(b.list(), '（空）');
  assert.throws(() => b.delete(''), /そのものは削除できない/);
  assert.ok(fs.existsSync(path.join(root, 'a', 'docs')));
});

test('.. ・絶対パス・バックスラッシュ・NUL は拒否する', () => {
  const { root } = mk();
  const b = new DirBox(root, node({ list: true, read: true, write: true, delete: true }));
  for (const p of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'a\0b']) {
    assert.throws(() => b.read(p), /相対パス|\.\./, p);
    assert.throws(() => b.write(p, 'x'), /相対パス|\.\./, p);
  }
});

test('シンボリックリンクで外へ出られない（読み・書き・一覧）', () => {
  const { root, outside } = mk();
  const b = new DirBox(root, node({ list: true, read: true, write: true, delete: true }));
  b.write('ok.txt', 'ok');
  const base = path.join(root, 'docs');
  fs.symlinkSync(outside, path.join(base, 'link'));                    // 外のディレクトリへのリンク
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(base, 'file-link'));
  assert.throws(() => b.read('link/secret.txt'), /外を指している/);
  assert.throws(() => b.read('file-link'), /外を指している/);
  assert.throws(() => b.write('link/new.txt', 'x'), /外を指している/);
  assert.throws(() => b.list('link'), /外を指している/);
  assert.equal(fs.existsSync(path.join(outside, 'new.txt')), false);
  b.delete('file-link');                                                  // リンクだけを消し、外のファイルは残る
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'SECRET');
});

test('ノード自体が作業領域の外を指すリンクなら使えない', () => {
  const { root, outside } = mk();
  fs.symlinkSync(outside, path.join(root, 'docs'));
  const b = new DirBox(root, node({ read: true }));
  assert.throws(() => b.read('secret.txt'), /作業領域の外/);
});

test('大きすぎる書き込みと、ディレクトリへの書き込みは拒否する', () => {
  const { root } = mk();
  const b = new DirBox(root, node({ write: true, list: true }));
  assert.throws(() => b.write('big', 'x'.repeat(1024 * 1024 + 1)), /バイトまで/);
  fs.mkdirSync(path.join(root, 'docs', 'd'), { recursive: true });
  assert.throws(() => b.write('d', 'x'), /ディレクトリには書けない/);
});

test('台帳から読む: 不正な path や名前は無視する', () => {
  const { root } = mk();
  const f = path.join(root, 'registry.json');
  fs.writeFileSync(f, JSON.stringify({ tools: [
    { kind: 'directory', name: 'ok', path: 'a/b', perms: { read: true, write: 'yes' } },
    { kind: 'directory', name: 'bad1', path: '../x', perms: { read: true } },
    { kind: 'directory', name: 'bad2', path: '/etc', perms: { read: true } },
    { kind: 'mcp', name: 'azure' },
  ] }));
  const nodes = loadDirNodes(f);
  assert.deepEqual(nodes.map((n) => n.name), ['ok']);
  assert.deepEqual(nodes[0].perms, { list: false, read: true, write: false, delete: false });   // true 以外は偽
  assert.deepEqual(loadDirNodes(path.join(root, 'none.json')), []);
  assert.equal(validRel('a/../b'), false);
});

test('checkDirAccess: 権限と接続の両方が要る', () => {
  const nodes = [node({ read: true, write: true })];
  const base = { nodes, callerName: 'azure-x' };
  assert.equal(checkDirAccess({ ...base, toolName: 'mcp__dir-docs__read', callerTools: ['Read', 'mcp__dir-docs__*'] }).ok, true);
  assert.equal(checkDirAccess({ ...base, toolName: 'mcp__dir-docs__write', callerTools: ['mcp__dir-docs__write'] }).ok, true);
  assert.match(checkDirAccess({ ...base, toolName: 'mcp__dir-docs__delete', callerTools: ['mcp__dir-docs__*'] }).reason, /権限がない/);        // ノードに権限なし
  assert.match(checkDirAccess({ ...base, toolName: 'mcp__dir-docs__read', callerTools: ['Read'] }).reason, /接続されていない/);               // 接続なし
  assert.match(checkDirAccess({ ...base, toolName: 'mcp__dir-docs__read', callerTools: null }).reason, /接続されていない/);                 // tools 未指定
  assert.match(checkDirAccess({ ...base, callerName: undefined, toolName: 'mcp__dir-docs__read', callerTools: [] }).reason, /特定できない/);
  assert.match(checkDirAccess({ ...base, toolName: 'mcp__dir-nope__read', callerTools: [] }).reason, /台帳にない/);
  assert.equal(checkDirAccess({ ...base, toolName: 'mcp__azure__list', callerTools: [] }).ok, false);
});

test('buildDirServers: 権限のある操作だけを公開する', () => {
  const { root } = mk();
  const seen = [];
  const sdk = { tool: (name) => { seen.push(name); return { name }; }, createSdkMcpServer: (o) => ({ name: o.name, tools: o.tools.map((t) => t.name) }) };
  const z = new Proxy({}, { get: () => () => ({ describe: () => ({ optional: () => ({}) }) }) });
  const s = buildDirServers({ sdk, z: { string: () => ({ describe: () => ({ optional: () => ({}) }) }) }, nodes: [node({ list: true, delete: true }), { ...node({}), name: 'none' }], root });
  assert.deepEqual(Object.keys(s), ['dir-docs']);
  assert.deepEqual(s['dir-docs'].tools, ['list', 'delete']);
  void z;
});
