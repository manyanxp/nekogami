// ディレクトリのノード（ADR 0037）: 場所の解決（作業領域の外へ出さない）と、参照・読み込み・書き込み・削除・Python の実行。
// 担当に渡すのは、権限がオンの操作だけ。どの担当が使えるかは、担当の定義ファイルの tools（`mcp__dir-<名前>__*`）で決まる。
import fs from 'node:fs';
import path from 'node:path';

// 担当に出すツール名 → 台帳の権限のキー。run（Python の実行）の権限は exec（ADR 0038）
export const PERM_OF = { list: 'list', read: 'read', write: 'write', delete: 'delete', run: 'exec' };
export const OPS = Object.keys(PERM_OF);
const PERM_KEYS = Object.values(PERM_OF);
export const DIR_PREFIX = 'dir-';
export const MAX_READ = 200 * 1024;
export const MAX_WRITE = 1024 * 1024;
export const MAX_LIST = 500;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NODE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;   // MCP のサーバー名（dir-<名前>）になる。API 側の規則と同じ

export const validRel = (p) => typeof p === 'string' && p !== '' && p.length <= 600 && p.split('/').every((s) => SEGMENT.test(s));

/** ポータルの台帳（registry.json）から、ディレクトリのノードを読む。読めない・不正なものは無いものとして扱う */
export function loadDirNodes(registryFile) {
  try {
    const tools = JSON.parse(fs.readFileSync(registryFile, 'utf8')).tools || [];
    return tools
      .filter((t) => t.kind === 'directory' && NODE_NAME.test(t.name || '') && validRel(t.path))
      .map((t) => ({ name: t.name, path: t.path, description: String(t.description || ''), perms: Object.fromEntries(PERM_KEYS.map((k) => [k, t.perms?.[k] === true])) }));
  } catch { return []; }
}

const inside = (base, p) => p === base || p.startsWith(base + path.sep);

/** 1 つのディレクトリのノード。root（作業領域）の中の node.path だけを扱う */
export class DirBox {
  constructor(root, node) {
    this.node = node;
    this.root = root;
    this.base = path.join(root, ...node.path.split('/'));
  }

  /** ノードのディレクトリを（なければ作って）実体のパスで返す。作業領域の外を指していたら拒否 */
  realBase() {
    fs.mkdirSync(this.root, { recursive: true });
    const realRoot = fs.realpathSync(this.root);
    fs.mkdirSync(this.base, { recursive: true });
    const real = fs.realpathSync(this.base);
    if (!inside(realRoot, real)) throw new Error('このディレクトリは作業領域の外を指しているので使えない');
    return real;
  }

  /** ノードの中の相対パスを、絶対パスにする。.. や絶対パス、シンボリックリンクによる外への脱出は拒否 */
  resolve(rel = '', { nofollow = false } = {}) {   // nofollow: 末尾がリンクでも、リンクそのものを対象にする（削除用。置かれた場所が中なら良い）
    if (typeof rel !== 'string' || rel.length > 512 || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) throw new Error('path は、このディレクトリの中の相対パス');
    const segs = rel.split('/').filter((s) => s !== '' && s !== '.');
    if (segs.includes('..')) throw new Error('path に .. は使えない');
    const realBase = this.realBase();
    const abs = path.join(realBase, ...segs);
    let probe = nofollow && segs.length ? path.dirname(abs) : abs;   // 存在する一番近い親の実体が、ノードの中にあることを確かめる
    while (!fs.existsSync(probe) && !isLink(probe)) probe = path.dirname(probe);
    if (!inside(realBase, fs.realpathSync(probe))) throw new Error('path がこのディレクトリの外を指している');
    return { abs, realBase, empty: segs.length === 0 };
  }

  need(op) {
    if (!this.node.perms[PERM_OF[op]]) throw new Error(`このディレクトリには「${LABEL[op]}」の権限がない`);
  }

  list(rel) {
    this.need('list');
    const { abs } = this.resolve(rel);
    if (!fs.statSync(abs).isDirectory()) throw new Error('ディレクトリではない');
    const ents = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const lines = ents.slice(0, MAX_LIST).map((e) => (e.isDirectory() ? `${e.name}/` : `${e.name}  (${e.isFile() ? fs.statSync(path.join(abs, e.name)).size : '?'} バイト)`));
    return (lines.join('\n') || '（空）') + (ents.length > MAX_LIST ? `\n…ほか ${ents.length - MAX_LIST} 件` : '');
  }

  read(rel) {
    this.need('read');
    const { abs, empty } = this.resolve(rel);
    if (empty) throw new Error('path が必要（ファイル）');
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error('ファイルではない');
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(Math.min(st.size, MAX_READ));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.toString('utf8') + (st.size > MAX_READ ? `\n…（${st.size} バイトのうち先頭 ${MAX_READ} バイトだけ）` : '');
    } finally { fs.closeSync(fd); }
  }

  write(rel, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_WRITE) throw new Error(`content は文字列で、${MAX_WRITE} バイトまで`);
    this.writeBytes(rel, Buffer.from(content, 'utf8'));
    return `${rel} に ${Buffer.byteLength(content)} バイトを書いた`;
  }

  /** バイト列を書く（Python の実行結果の画像など）。上限の検査は呼ぶ側 */
  writeBytes(rel, bytes) {
    this.need('write');
    const { abs, empty } = this.resolve(rel);
    if (empty) throw new Error('path が必要（ファイル）');
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) throw new Error('ディレクトリには書けない');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    this.resolve(path.relative(this.realBase(), abs).split(path.sep).join('/'));   // 親を作ったあとにもう一度、外へ出ていないか確かめる
    fs.writeFileSync(abs, bytes);
  }

  delete(rel) {
    this.need('delete');
    const { abs, empty } = this.resolve(rel, { nofollow: true });
    if (empty) throw new Error('このディレクトリそのものは削除できない');
    const st = fs.lstatSync(abs);   // シンボリックリンクはリンクだけを消す
    if (st.isDirectory()) {
      if (fs.readdirSync(abs).length) throw new Error('空でないディレクトリは削除できない（先に中のファイルを削除する）');
      fs.rmdirSync(abs);
    } else fs.unlinkSync(abs);
    return `${rel} を削除した`;
  }
}

const LABEL = { list: '参照', read: '読み込み', write: '書き込み', delete: '削除', run: 'Python 実行' };
const isLink = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

/** MCP のツール名 `mcp__dir-<名前>__<操作>` の判定。呼んだ担当が接続していて、ノードに権限があるときだけ許可する。
 *  callerTools: 呼んだ担当の定義ファイルの tools（なければ null = 全ツールを継承しているので、接続していないものとして扱う） */
export function checkDirAccess({ toolName, nodes, callerName, callerTools }) {
  const [, server, op] = String(toolName).split('__');
  if (!server?.startsWith(DIR_PREFIX) || !OPS.includes(op)) return { ok: false, reason: `${toolName} はディレクトリのツールではない` };
  const name = server.slice(DIR_PREFIX.length);
  const node = nodes.find((n) => n.name === name);
  if (!node) return { ok: false, reason: `ディレクトリ ${name} は台帳にない` };
  if (!node.perms[PERM_OF[op]]) return { ok: false, reason: `ディレクトリ ${name} には「${LABEL[op]}」の権限がない` };
  if (!callerName) return { ok: false, reason: '呼んだ担当を特定できないので許可しない' };
  if (!callerTools?.includes(`mcp__${server}__*`) && !callerTools?.includes(toolName)) return { ok: false, reason: `${callerName} はディレクトリ ${name} に接続されていない（管理ページのノードグラフで接続する）` };
  return { ok: true };
}

/** Agent SDK の MCP サーバー（プロセス内）を、権限のあるノードの分だけ作る。権限のない操作は、そもそも公開しない */
export function buildDirServers({ sdk, z, nodes, root, run }) {   // run(box, code): Python の実行（なければ run は公開しない）
  const servers = {};
  const reply = (fn) => async (args) => {
    try { return { content: [{ type: 'text', text: await fn(args) }] }; }
    catch (e) { return { content: [{ type: 'text', text: `エラー: ${e.message}` }], isError: true }; }
  };
  for (const n of nodes) {
    const box = new DirBox(root, n);
    const where = `ディレクトリ「${n.name}」${n.description ? `（${n.description}）` : ''}`;
    const rel = z.string().describe('このディレクトリの中の相対パス');
    const tools = [];
    if (n.perms.list) tools.push(sdk.tool('list', `${where}の中のファイルとフォルダを一覧する。path を省略すると直下`, { path: rel.optional() }, reply((a) => box.list(a.path))));
    if (n.perms.read) tools.push(sdk.tool('read', `${where}の中のファイルを読む（先頭 ${MAX_READ} バイトまで）`, { path: rel }, reply((a) => box.read(a.path))));
    if (n.perms.write) tools.push(sdk.tool('write', `${where}の中にファイルを書く（上書き。親フォルダは作る。${MAX_WRITE} バイトまで）`, { path: rel, content: z.string() }, reply((a) => box.write(a.path, a.content))));
    if (n.perms.delete) tools.push(sdk.tool('delete', `${where}の中のファイル、または空のフォルダを削除する`, { path: rel }, reply((a) => box.delete(a.path))));
    if (n.perms.exec && run) tools.push(sdk.tool('run', `${where}の中で Python（numpy・pandas・scipy・matplotlib・scikit-learn・openpyxl が使える）のコードを実行する。ネットワークなし、30 秒まで。作業ディレクトリにはこのディレクトリの中身のコピーがあり、読み込み・書き込み・削除の権限がある範囲だけが元へ戻る`, { code: z.string().describe('実行する Python のコード全体') }, reply((a) => run(box, a.code))));
    if (tools.length) servers[`${DIR_PREFIX}${n.name}`] = sdk.createSdkMcpServer({ name: `${DIR_PREFIX}${n.name}`, version: '1.0.0', tools });
  }
  return servers;
}
