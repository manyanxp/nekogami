// ノードグラフ用の純粋ロジック（描画は @xyflow/react、通信は api.ts）。
// 親子の規則はバックエンド（registry.py の PARENT_KINDS）が正。ここは操作中に即座に可否を示すための写し。
import type { DirPerm, DirPerms, Entity, Kind, PyType, Tool } from './types';

/** Python 標準のデータ型（入力ノードで選べる）と、値の書き方の例 */
export const PY_TYPES: { key: PyType; example: string }[] = [
  { key: 'str', example: 'そのまま文字を書く' }, { key: 'int', example: '42' }, { key: 'float', example: '3.14' }, { key: 'bool', example: 'true / false' },
  { key: 'list', example: '[1, 2, 3]' }, { key: 'dict', example: '{"a": 1}' }, { key: 'tuple', example: '[1, 2]（配列で書く）' }, { key: 'set', example: '[1, 2]（配列で書く）' },
];
export const PY_SAMPLE = 'def main(x: int, label: str = "a"):\n    """説明（1 行目が担当に見える）"""\n    return {"x2": x * 2, "label": label}\n';

export const PARENT_KINDS: Record<Kind, Kind[]> = {
  orchestrator: [],
  suborchestrator: ['orchestrator'],
  agent: ['orchestrator', 'suborchestrator'],
  subagent: ['agent', 'suborchestrator', 'orchestrator'],
};
// モデルの選択肢（エージェント定義の `model:` に書ける別名と、フルのモデル ID）。台帳のメタ情報で、自由入力の値も保持できる
export const MODEL_CHOICES: [string, string][] = [
  ['', '（指定なし）'], ['inherit', 'inherit（呼び出し元と同じ）'],
  ['haiku', 'haiku（軽量・安価）'], ['sonnet', 'sonnet（標準）'], ['opus', 'opus（高精度）'],
  ['claude-haiku-5-5', 'claude-haiku-5-5'], ['claude-sonnet-5-5', 'claude-sonnet-5-5'],
  ['claude-opus-5-5', 'claude-opus-5-5'], ['claude-fable-5-1', 'claude-fable-5-1'],
];
/** 現在値が選択肢にない（自由入力・古い ID）場合も、消さずに選択肢へ加える */
export function modelOptions(current = ''): [string, string][] {
  return current && !MODEL_CHOICES.some(([v]) => v === current) ? [...MODEL_CHOICES, [current, `${current}（現在の値）`]] : MODEL_CHOICES;
}

/** 書き込み・実行ができるツール。新しく接続するときは確認する（バックエンドも確認なしでは拒否する） */
export const DANGEROUS_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit'];

/** ディレクトリのノードの権限（表示順）。参照 = 一覧、読み込み、書き込み、削除、Python 実行 */
export const RISKY_DIR_PERMS: DirPerm[] = ['write', 'delete', 'exec'];
export const DIR_PERMS: { key: DirPerm; label: string }[] = [{ key: 'list', label: '参照' }, { key: 'read', label: '読み込み' }, { key: 'write', label: '書き込み' }, { key: 'delete', label: '削除' }, { key: 'exec', label: 'Python 実行' }];
export const permLabels = (perms?: Partial<DirPerms>) => DIR_PERMS.filter((p) => perms?.[p.key]).map((p) => p.label);
/** 書き込み・削除・Python 実行ができるディレクトリ。担当に新しく接続するときは確認が要る */
export const isRiskyDir = (t?: Tool) => t?.kind === 'directory' && RISKY_DIR_PERMS.some((k) => t.perms?.[k]);
const toolSub = (t: Tool) => (t.kind === 'directory' ? `${t.path ?? ''} · ${permLabels(t.perms).join('・') || '権限なし'}` : t.kind === 'llm' ? `ローカル LLM · ${t.model ?? ''}`
  : t.kind === 'python' ? `Python · ${t.func ?? 'main'}(${(t.params ?? []).map((p) => p.name).join(', ')})`
  : t.kind === 'input' ? `入力 · ${t.param ?? ''}: ${t.dtype ?? ''}` : t.kind);

const COL = 270;
const ROW = 84;

export interface GraphNode { id: string; type: 'entity' | 'tool'; kind: string; label: string; sub: string; protected: boolean; icon?: string | null; x: number; y: number }
export interface GraphEdge { id: string; type: 'tree' | 'tool' | 'input'; from: string; to: string }

/** 配置（pos）が無いノードを、親子の深さ × 並び順で自動配置する。ツールは右端の列に並べる。 */
export function buildGraph(entities: Entity[], tools: Tool[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const kids = new Map<string, Entity[]>();
  for (const e of entities) {
    const k = entities.some((p) => p.id === e.parent_id) ? e.parent_id! : '';
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k)!.push(e);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const auto = new Map<string, { x: number; y: number }>();
  let row = 0, maxDepth = 0;
  const walk = (pid: string, depth: number) => {
    for (const e of kids.get(pid) || []) {
      maxDepth = Math.max(maxDepth, depth);
      const children = kids.get(e.id) || [];
      const start = row;
      if (children.length) walk(e.id, depth + 1); else row += 1;
      const y = children.length ? (start + row - 1) / 2 : row - 1;   // 親は子の中央の高さに置く
      auto.set(e.id, { x: depth * COL, y: y * ROW });
    }
  };
  walk('', 0);
  const toolX = (maxDepth + 1) * COL + 40;
  const nodes: GraphNode[] = [];
  for (const e of entities) nodes.push({ id: e.id, type: 'entity', kind: e.kind, label: e.name, sub: e.model || '', protected: !!e.protected, icon: e.icon || null, ...(e.pos || auto.get(e.id) || { x: 0, y: 0 }) });
  tools.forEach((t, i) => nodes.push({ id: t.id, type: 'tool', kind: t.kind, label: t.name, sub: toolSub(t), protected: false, ...(t.pos || { x: toolX, y: i * 64 }) }));
  const known = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  for (const e of entities) {
    if (e.parent_id && known.has(e.parent_id)) edges.push({ id: `tree:${e.parent_id}>${e.id}`, type: 'tree', from: e.parent_id, to: e.id });
    for (const tid of e.tool_ids || []) if (known.has(tid)) edges.push({ id: `tool:${e.id}>${tid}`, type: 'tool', from: e.id, to: tid });
  }
  for (const t of tools) for (const iid of t.input_ids || []) if (known.has(iid)) edges.push({ id: `input:${iid}>${t.id}`, type: 'input', from: iid, to: t.id });
  return { nodes, edges };
}

export function isDescendant(entities: Entity[], ancestorId: string, id: string): boolean {
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (let cur = byId.get(id), n = 0; cur && n < 1000; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, n++) {
    if (cur.parent_id === ancestorId) return true;
  }
  return false;
}

export type Connect = { ok: false; reason: string } | { ok: true; action: 'reparent'; from: Entity; to: Entity } | { ok: true; action: 'tool'; from: Entity; to: Tool } | { ok: true; action: 'input'; from: Tool; to: Tool };

/** 出力ピン(from) → 入力ピン(to) の接続可否。ok なら action は 'reparent'（親子）か 'tool'（ツール接続）。 */
export function canConnect(entities: Entity[], tools: Tool[], fromId: string, toId: string): Connect {
  const fromTool = tools.find((t) => t.id === fromId);
  if (fromTool?.kind === 'input') {   // 入力ノード → Python ノード（引数の既定値になる）
    const py = tools.find((t) => t.id === toId);
    if (py?.kind !== 'python') return { ok: false, reason: '入力ノードは、Python ノードにだけつなげる' };
    if ((py.input_ids || []).includes(fromId)) return { ok: false, reason: 'すでに接続されている' };
    const param = (py.params || []).find((p) => p.name === fromTool.param);
    if (!param) return { ok: false, reason: `関数 ${py.func} に引数 ${fromTool.param} がない` };
    if (param.type !== fromTool.dtype) return { ok: false, reason: `型が合わない（入力 ${fromTool.dtype}、引数 ${param.type}）` };
    const twin = tools.find((t) => (py.input_ids || []).includes(t.id) && t.param === fromTool.param);
    if (twin) return { ok: false, reason: `引数 ${fromTool.param} には、入力ノード ${twin.name} がすでにつながっている` };
    return { ok: true, action: 'input', from: fromTool, to: py };
  }
  const from = entities.find((e) => e.id === fromId);
  if (!from) return { ok: false, reason: '接続元はエージェント側か、入力ノードだけ' };
  const toTool = tools.find((t) => t.id === toId);
  if (toTool?.kind === 'input') return { ok: false, reason: '入力ノードは担当にはつなげない（Python ノードにつなぐ）' };
  if (toTool) return (from.tool_ids || []).includes(toId) ? { ok: false, reason: 'すでに接続されている' } : { ok: true, action: 'tool', from, to: toTool };
  const to = entities.find((e) => e.id === toId);
  if (!to) return { ok: false, reason: '接続先が見つからない' };
  if (to.id === from.id) return { ok: false, reason: '自分自身には接続できない' };
  if (to.protected) return { ok: false, reason: '猫神さまの親は変更できない' };
  if (!PARENT_KINDS[to.kind].includes(from.kind)) return { ok: false, reason: `${to.kind} の親にできない種別: ${from.kind}` };
  if (isDescendant(entities, to.id, from.id)) return { ok: false, reason: '子孫を親にはできない（循環）' };
  if (to.parent_id === from.id) return { ok: false, reason: 'すでに親子になっている' };
  return { ok: true, action: 'reparent', from, to };
}

/** あるノードの配下に作れる種別（右クリックメニュー用） */
export const childKinds = (kind: Kind): Kind[] => (['suborchestrator', 'agent', 'subagent'] as Kind[]).filter((k) => PARENT_KINDS[k].includes(kind));

/** 新規ノードの作成時に選べる親（種別の規則に合うもの） */
export const parentChoices = (entities: Entity[], kind: Kind): Entity[] => entities.filter((e) => PARENT_KINDS[kind].includes(e.kind));
