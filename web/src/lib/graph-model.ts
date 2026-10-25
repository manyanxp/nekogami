// ノードグラフ用の純粋ロジック（描画は @xyflow/react、通信は api.ts）。
// 親子の規則はバックエンド（registry.py の PARENT_KINDS）が正。ここは操作中に即座に可否を示すための写し。
import type { DirPerm, DirPerms, Entity, Kind, PyType, Tool } from './types';

/** Python 標準のデータ型（入力ノードで選べる）と、値の書き方の例 */
export const PY_TYPES: { key: PyType; example: string }[] = [
  { key: 'str', example: 'そのまま文字を書く' }, { key: 'int', example: '42' }, { key: 'float', example: '3.14' }, { key: 'bool', example: 'true / false' },
  { key: 'list', example: '[1, 2, 3]' }, { key: 'dict', example: '{"a": 1}' }, { key: 'tuple', example: '[1, 2]（配列で書く）' }, { key: 'set', example: '[1, 2]（配列で書く）' },
];
/** 処理の書き方の例。関数名・引数は書かない（入力ノードをつなぐと、その引数名が変数になる。結果は return で返す。ADR 0045） */
export const PY_SAMPLE = '# 入力ノードをつなぐと、その引数名がそのまま変数として使えます\nresult = 1 + 1\nreturn {"result": result}\n';

export const MAX_DEPTH = 4;   // ツリーの深さの上限（猫神さまを 0 とする）。バックエンドの MAX_DEPTH、実行時の CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH と同じ
export const PARENT_KINDS: Record<Kind, Kind[]> = {
  orchestrator: [],
  suborchestrator: ['orchestrator', 'suborchestrator'],   // 入れ子にできる（ADR 0042）
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
  : t.kind === 'python' ? `Python · (${(t.params ?? []).map((p) => p.name).join(', ')})`
  : t.kind === 'input' ? `入力 · ${t.param ?? ''}: ${t.dtype ?? ''}` : t.kind);

const COL = 270;
const ROW = 108;

export interface GraphNode { id: string; type: 'entity' | 'tool'; kind: string; label: string; sub: string; protected: boolean; icon?: string | null; x: number; y: number;
  /** ノードに出す参照用のプロパティ（編集はしない。プロンプトは含めない）と、そのツールチップ全文 */
  props?: string[]; detail?: string }

/** 担当（エンティティ）の参照用プロパティ。ツール数・配下の数・状態など。モデルは sub に出すので含めない */
export function entityProps(e: Entity, entities: Entity[]): string[] {
  const kids = entities.filter((x) => x.parent_id === e.id).length;
  const flags = [!e.enabled && '無効', e.definition ? null : '定義なし', (e.callee_ids?.length ?? 0) > 0 && `呼べる ${e.callee_ids!.length}`, e.auto_spawn && '自動作成可'].filter(Boolean) as string[];
  return [`ツール ${e.tool_ids?.length ?? 0} · 配下 ${kids}`, ...(flags.length ? [flags.join(' · ')] : [])];
}

/** ツールチップ用の全文（プロンプト以外のプロパティ） */
export function entityDetail(e: Entity, entities: Entity[], tools: Tool[]): string {
  const byId = new Map(entities.map((x) => [x.id, x.name]));
  const names = (e.tool_ids || []).map((i) => tools.find((t) => t.id === i)?.name).filter(Boolean).join(', ');
  const parent = e.parent_id ? byId.get(e.parent_id) : null;
  return [`${e.name}（${e.kind}）`, e.description && `説明: ${e.description}`, `モデル: ${e.model || '指定なし'}`, parent && `親: ${parent}`,
    `ツール: ${names || 'なし'}`, (e.callee_ids?.length ?? 0) > 0 && `呼べる担当: ${e.callee_ids!.map((i) => byId.get(i)).filter(Boolean).join(', ')}`,
    e.auto_spawn && '担当の自動作成: 許可', e.tags?.length ? `タグ: ${e.tags.join(', ')}` : '', `状態: ${e.enabled ? '有効' : '無効'}`,
    e.definition ? `定義: ${e.definition.path}` : '定義ファイルなし'].filter(Boolean).join('\n');
}
export interface GraphEdge { id: string; type: 'tree' | 'tool' | 'input' | 'call'; from: string; to: string }
/** 担当 → 担当（呼ぶ）のワイヤーに使うピン。親子（左右のピン）とは別に、上下のピンでつなぐ */
export const CALL_OUT = 'call';
export const CALL_IN = 'callee';

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
  for (const e of entities) nodes.push({ id: e.id, type: 'entity', kind: e.kind, label: e.name, sub: e.model || '', protected: !!e.protected, icon: e.icon || null, props: entityProps(e, entities), detail: entityDetail(e, entities, tools), ...(e.pos || auto.get(e.id) || { x: 0, y: 0 }) });
  tools.forEach((t, i) => nodes.push({ id: t.id, type: 'tool', kind: t.kind, label: t.name, sub: toolSub(t), protected: false, ...(t.pos || { x: toolX, y: i * 64 }) }));
  const known = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  for (const e of entities) {
    if (e.parent_id && known.has(e.parent_id)) edges.push({ id: `tree:${e.parent_id}>${e.id}`, type: 'tree', from: e.parent_id, to: e.id });
    for (const tid of e.tool_ids || []) if (known.has(tid)) edges.push({ id: `tool:${e.id}>${tid}`, type: 'tool', from: e.id, to: tid });
  }
  for (const e of entities) for (const cid of e.callee_ids || []) if (known.has(cid)) edges.push({ id: `call:${e.id}>${cid}`, type: 'call', from: e.id, to: cid });
  for (const t of tools) for (const iid of t.input_ids || []) if (known.has(iid)) edges.push({ id: `input:${iid}>${t.id}`, type: 'input', from: iid, to: t.id });
  return { nodes, edges };
}

/**
 * 選択中のノードにつながる線のうち、猫神さまから続く線の ID（強調表示する）。
 * 担当を選ぶと、猫神さまからその担当までの親子の線。ツール・入力を選ぶと、それを使う担当の線（と、その担当までの親子の線）。
 */
export function highlightEdges(entities: Entity[], tools: Tool[], selectedId: string | null): Set<string> {
  const out = new Set<string>();
  if (!selectedId) return out;
  const byId = new Map(entities.map((e) => [e.id, e]));
  const chain = (id: string) => {   // 猫神さま → id の親子の線
    for (let cur = byId.get(id), n = 0; cur?.parent_id && byId.has(cur.parent_id) && n < 100; cur = byId.get(cur.parent_id), n++) out.add(`tree:${cur.parent_id}>${cur.id}`);
  };
  if (byId.has(selectedId)) { chain(selectedId); return out; }
  const viaTool = (toolId: string) => { for (const e of entities) if (e.tool_ids?.includes(toolId)) { out.add(`tool:${e.id}>${toolId}`); chain(e.id); } };
  const tool = tools.find((t) => t.id === selectedId);
  if (!tool) return out;
  if (tool.kind === 'input') {   // 入力ノード → Python ノード → それを使う担当
    for (const py of tools) if (py.input_ids?.includes(tool.id)) { out.add(`input:${tool.id}>${py.id}`); viaTool(py.id); }
  } else viaTool(tool.id);
  return out;
}

export function isDescendant(entities: Entity[], ancestorId: string, id: string): boolean {
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (let cur = byId.get(id), n = 0; cur && n < 1000; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, n++) {
    if (cur.parent_id === ancestorId) return true;
  }
  return false;
}

export type Connect = { ok: false; reason: string } | { ok: true; action: 'call'; from: Entity; to: Entity } | { ok: true; action: 'reparent'; from: Entity; to: Entity } | { ok: true; action: 'tool'; from: Entity; to: Tool } | { ok: true; action: 'input'; from: Tool; to: Tool };

/** 出力ピン(from) → 入力ピン(to) の接続可否。ok なら action は 'reparent'（親子）か 'tool'（ツール接続）。 */
export function canConnect(entities: Entity[], tools: Tool[], fromId: string, toId: string, handles?: { source?: string | null; target?: string | null }): Connect {
  const callPin = handles?.source === CALL_OUT || handles?.target === CALL_IN;
  if (callPin) {   // 上下のピン: 担当が別の担当を呼ぶ（ADR 0043）
    if (handles?.source !== CALL_OUT || handles?.target !== CALL_IN) return { ok: false, reason: '呼ぶ接続は、下のピン（呼ぶ側）から上のピン（呼ばれる側）へつなぐ' };
    const caller = entities.find((e) => e.id === fromId), callee = entities.find((e) => e.id === toId);
    if (!caller || !callee) return { ok: false, reason: '接続先が見つからない' };
    if (caller.id === callee.id) return { ok: false, reason: '自分自身は呼べない' };
    if (caller.kind === 'orchestrator' || callee.kind === 'orchestrator') return { ok: false, reason: '猫神さまは、この接続では使えない（委任先一覧で管理する）' };
    if (caller.definition?.kind !== 'agent-md') return { ok: false, reason: `${caller.name} は定義ファイルがないので、担当を呼べない` };
    if ((caller.callee_ids || []).includes(callee.id)) return { ok: false, reason: 'すでに接続されている' };
    const reach = new Set<string>(), stack = [callee.id];   // 呼び先をたどって caller に戻るなら、輪になる
    while (stack.length) { const n = stack.pop()!; if (!reach.has(n)) { reach.add(n); stack.push(...(entities.find((e) => e.id === n)?.callee_ids || [])); } }
    if (reach.has(caller.id)) return { ok: false, reason: '呼び合いの輪になるので、つなげない' };
    return { ok: true, action: 'call', from: caller, to: callee };
  }
  const fromTool = tools.find((t) => t.id === fromId);
  if (fromTool?.kind === 'input') {   // 入力ノード → Python ノード（引数の既定値になる）
    const py = tools.find((t) => t.id === toId);
    if (py?.kind !== 'python') return { ok: false, reason: '入力ノードは、Python ノードにだけつなげる' };
    if ((py.input_ids || []).includes(fromId)) return { ok: false, reason: 'すでに接続されている' };
    if (py.style !== 'body') {   // 旧形式（関数ごと書く）: 入力ノードは、関数の引数に合うものだけ。「処理だけ」の形式は、つなぐと引数が自動で決まる（ADR 0045）
      const param = (py.params || []).find((p) => p.name === fromTool.param);
      if (!param) return { ok: false, reason: `関数 ${py.func} に引数 ${fromTool.param} がない` };
      if (param.type !== fromTool.dtype) return { ok: false, reason: `型が合わない（入力 ${fromTool.dtype}、引数 ${param.type}）` };
    }
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
  const fit = nestable(entities, to.kind, from, to);
  if (!fit.ok) return fit;
  if (to.parent_id === from.id) return { ok: false, reason: 'すでに親子になっている' };
  return { ok: true, action: 'reparent', from, to };
}

/** あるノードの配下に作れる種別（右クリックメニュー用） */
export const childKinds = (kind: Kind): Kind[] => (['suborchestrator', 'agent', 'subagent'] as Kind[]).filter((k) => PARENT_KINDS[k].includes(kind));

/** 新規ノードの作成時に選べる親（種別の規則に合うもの） */
export const parentChoices = (entities: Entity[], kind: Kind): Entity[] => entities.filter((e) => PARENT_KINDS[kind].includes(e.kind) && nestable(entities, kind, e, null).ok);

export function depthOf(entities: Entity[], id: string): number {
  const byId = new Map(entities.map((e) => [e.id, e]));
  let n = 0;
  for (let cur = byId.get(id); cur?.parent_id && byId.has(cur.parent_id) && n < 100; cur = byId.get(cur.parent_id)) n++;
  return n;
}
/** id の配下のいちばん深い子までの段数（子がなければ 0） */
export function heightOf(entities: Entity[], id: string): number {
  const kids = entities.filter((e) => e.parent_id === id);
  return kids.length ? 1 + Math.max(...kids.map((k) => heightOf(entities, k.id))) : 0;
}
/** child（新規なら null）を parent の下に置けるか。深さと、サブオーケストレーターの入れ子の条件（バックエンドが正。ここは操作中の即時の案内） */
export function nestable(entities: Entity[], kind: Kind, parent: Entity, child: Entity | null): { ok: true } | { ok: false; reason: string } {
  if (depthOf(entities, parent.id) + 1 + (child ? heightOf(entities, child.id) : 0) > MAX_DEPTH) return { ok: false, reason: `ツリーは ${MAX_DEPTH} 階層まで` };
  if (kind === 'suborchestrator' && parent.kind === 'suborchestrator') {
    for (const e of [parent, child]) if (e && e.definition?.kind !== 'agent-md') return { ok: false, reason: `入れ子にできるのは、定義ファイルのあるサブオーケストレーターだけ（${e.name} にはない）` };
  }
  return { ok: true };
}
