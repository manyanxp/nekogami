// Python ノード（ADR 0041）: 台帳の Python ノード（関数のコード）を、Agent SDK のプロセス内 MCP サーバー `py-<名前>` として担当に公開する。
// 担当は `run` ツールに引数（JSON）を渡して関数を呼ぶ。入力ノードの値は引数の既定値で、担当が渡した値が優先される。
// 実行は py-sandbox（ネットワークなし・30 秒・512 MB）。戻り値は JSON にして返す。
import fs from 'node:fs';

export const PY_PREFIX = 'py-';
const NODE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TYPES = ['str', 'int', 'float', 'bool', 'list', 'dict', 'tuple', 'set'];
const MARK = '__NEKO_PY_RESULT__';
export const MAX_RESULT = 20000;   // 文字

/** ポータルの台帳から、Python ノードと、つないである入力ノードを読む。不正なものは無いものとして扱う */
export function loadPyNodes(registryFile) {
  try {
    const tools = JSON.parse(fs.readFileSync(registryFile, 'utf8')).tools || [];
    const byId = new Map(tools.map((t) => [t.id, t]));
    return tools.filter((t) => t.kind === 'python' && NODE_NAME.test(t.name || '') && typeof t.code === 'string' && IDENT.test(t.func || '') && Array.isArray(t.params))
      .map((t) => ({
        name: t.name, description: String(t.description || t.doc || ''), code: t.code, func: t.func,
        params: t.params.filter((p) => IDENT.test(p.name || '') && TYPES.includes(p.type)),
        inputs: (t.input_ids || []).map((i) => byId.get(i)).filter((i) => i?.kind === 'input' && 'parsed' in i).map((i) => ({ param: i.param, dtype: i.dtype, value: i.parsed, node: i.name })),
      }));
  } catch { return []; }
}

/** `mcp__py-<名前>__run` の判定。ノードが台帳にあり、呼んだ担当が接続している（tools に `mcp__py-<名前>__*`）ときだけ許可する */
export function checkPyAccess({ toolName, nodes, callerName, callerTools }) {
  const [, server, op] = String(toolName).split('__');
  if (!server?.startsWith(PY_PREFIX) || op !== 'run') return { ok: false, reason: `${toolName} は Python ノードのツールではない` };
  const name = server.slice(PY_PREFIX.length);
  if (!nodes.some((n) => n.name === name)) return { ok: false, reason: `Python ノード ${name} は台帳にない` };
  if (!callerName) return { ok: false, reason: '呼んだ担当を特定できないので許可しない' };
  if (!callerTools?.includes(`mcp__${server}__*`) && !callerTools?.includes(toolName)) return { ok: false, reason: `${callerName} は Python ノード ${name} に接続されていない（管理ページのノードグラフで接続する）` };
  return { ok: true };
}

const isType = (type, v) => {
  switch (type) {
    case 'int': return Number.isInteger(v);
    case 'float': return typeof v === 'number' && Number.isFinite(v);
    case 'bool': return typeof v === 'boolean';
    case 'str': return typeof v === 'string';
    case 'dict': return v !== null && typeof v === 'object' && !Array.isArray(v);
    default: return Array.isArray(v);   // list / tuple / set は JSON の配列で運ぶ
  }
};

/** 担当が渡した引数 given に、入力ノードの値を既定値として足し、型を確かめる。足りない・型違い・未知の引数は Error */
export function resolveArgs(node, given) {
  const g = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
  const known = new Set(node.params.map((p) => p.name));
  const unknown = Object.keys(g).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`関数 ${node.func} にない引数: ${unknown.join(', ')}（引数は ${[...known].join(', ') || 'なし'}）`);
  const out = {};
  for (const p of node.params) {
    let v;
    if (p.name in g) v = g[p.name];
    else {
      const inp = node.inputs.find((i) => i.param === p.name);   // 入力ノードの値は、型が合うもののみ（API が型を揃えて受け付けている）
      if (inp) v = inp.value;
      else if (p.required) throw new Error(`引数 ${p.name}（${p.type}）が必要。渡すか、入力ノードをつなぐ`);
      else continue;   // Python の既定値を使う
    }
    if (v !== null && !isType(p.type, v)) throw new Error(`引数 ${p.name} は ${p.type} で渡す（受け取った値: ${JSON.stringify(v).slice(0, 80)}）`);
    out[p.name] = v;
  }
  return out;
}

/** 実行するプログラム: ノードのコード + 呼び出し。名前の衝突を避けるため、足す部分は __neko_ で始める */
export function buildProgram(node, args) {
  const types = Object.fromEntries(node.params.map((p) => [p.name, p.type]));
  const lit = (x) => JSON.stringify(JSON.stringify(x));   // JSON 文字列のリテラルは、Python の文字列としても読める
  return `${node.code}\n\n` + [
    'import json as __neko_json, sys as __neko_sys',
    `__neko_args = __neko_json.loads(${lit(args)})`,
    `__neko_types = __neko_json.loads(${lit(types)})`,
    'for __k, __t in __neko_types.items():',
    '    if __k in __neko_args and __neko_args[__k] is not None:',
    "        if __t == 'tuple': __neko_args[__k] = tuple(__neko_args[__k])",
    "        elif __t == 'set': __neko_args[__k] = set(__neko_args[__k])",
    'def __neko_enc(o):',
    '    if isinstance(o, (set, frozenset)): return sorted(o, key=repr)',
    '    if isinstance(o, tuple): return list(o)',
    '    return repr(o)',
    `__neko_r = ${node.func}(**__neko_args)`,
    `__neko_sys.stdout.flush(); print(${JSON.stringify(MARK)} + __neko_json.dumps(__neko_r, default=__neko_enc, ensure_ascii=False))`,
  ].join('\n') + '\n';
}

/** Python ノードを 1 回呼ぶ。run(code): 実行役への依頼（{stdout, stderr, exit, timed_out}）を返す */
export async function callPy(node, given, run) {
  const args = resolveArgs(node, given);
  const r = await run(buildProgram(node, args));
  const lines = String(r.stdout || '').split('\n');
  const at = lines.findLastIndex((l) => l.startsWith(MARK));
  const printed = lines.filter((_, i) => i !== at).join('\n').trim();
  const parts = [];
  if (r.timed_out) parts.push('時間切れで止めた（30 秒）');
  else if (r.exit !== 0 || at < 0) parts.push(`実行に失敗した（終了コード ${r.exit}）`);
  if (at >= 0) {
    const json = lines[at].slice(MARK.length);
    parts.push(`戻り値: ${json.length > MAX_RESULT ? `${json.slice(0, MAX_RESULT)}…（${json.length} 文字のうち先頭だけ）` : json}`);
  }
  if (printed) parts.push(`--- 標準出力 ---\n${printed.slice(0, MAX_RESULT)}`);
  if (r.stderr) parts.push(`--- 標準エラー ---\n${String(r.stderr).slice(-4000)}`);
  const ok = !r.timed_out && r.exit === 0 && at >= 0;
  return { ok, text: parts.join('\n') };
}

/** Python ノードごとに、`run` ツールを 1 つ持つ MCP サーバーを作る */
export function buildPyServers({ sdk, z, nodes, run }) {
  const servers = {};
  for (const node of nodes) {
    const sig = node.params.map((p) => `${p.name}: ${p.type}${p.required ? '' : '?'}`).join(', ');
    const bound = node.inputs.map((i) => `${i.param}（入力ノード ${i.node}）`).join('、');
    servers[`${PY_PREFIX}${node.name}`] = sdk.createSdkMcpServer({
      name: `${PY_PREFIX}${node.name}`,
      tools: [sdk.tool('run', `Python の関数 ${node.func}(${sig}) を、ネットワークなしの実行環境で呼ぶ。${node.description}${bound ? ` 既定値を持つ引数: ${bound}。` : ''}`,
        { args: z.record(z.any()).optional().describe('関数の引数（名前 → 値の JSON）。tuple と set は配列で渡す') },
        async ({ args }) => {
          try {
            const r = await callPy(node, args, (code) => run(code));
            return { content: [{ type: 'text', text: r.text }], isError: !r.ok };
          } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
        })],
    });
  }
  return servers;
}
