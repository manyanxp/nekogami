// 一覧の表示用データの組み立て（DOM に触れない純粋関数）
import type { Entity, Kind } from './types';

export const KIND_LABEL: Record<Kind, string> = { orchestrator: 'オーケストレーター', suborchestrator: 'サブオーケストレーター', agent: 'エージェント', subagent: 'サブエージェント' };

export interface TreeRow extends Entity { depth: number; hasChildren: boolean; collapsed: boolean }

/**
 * 親子関係を保った表示順に並べ、depth を付ける。
 * - protected（猫神さま）は一覧に出さず、その子を最上位（depth 0）として出す
 * - collapsed（ID の Set）の子孫は隠す。ただし検索・種別フィルタ中は、一致を見逃さないよう折りたたみを無視する
 */
export function toTree(items: Entity[], { q = '', kind = '', collapsed = new Set<string>() }: { q?: string; kind?: string; collapsed?: Set<string> } = {}): TreeRow[] {
  const byParent = new Map<string, Entity[]>();
  for (const e of items) {
    const k = e.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(e);
  }
  const hit = (e: Entity) => (!kind || e.kind === kind) && (!q || `${e.name} ${e.description} ${(e.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const filtering = !!(q || kind);
  const out: TreeRow[] = [];
  const walk = (pid: string, depth: number) => {
    for (const e of [...(byParent.get(pid) || [])].sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.protected) { walk(e.id, depth); continue; }
      const hasChildren = (byParent.get(e.id) || []).length > 0;
      const isCollapsed = hasChildren && collapsed.has(e.id);
      if (hit(e)) out.push({ ...e, depth, hasChildren, collapsed: isCollapsed });
      if (!isCollapsed || filtering) walk(e.id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

const PARENTS: Record<string, Kind[]> = {
  suborchestrator: ['orchestrator'], agent: ['orchestrator', 'suborchestrator'], subagent: ['agent', 'suborchestrator', 'orchestrator'],
};
export const parentOptions = (items: Entity[], kind: string, selfId?: string) => items.filter((e) => (PARENTS[kind] || []).includes(e.kind) && e.id !== selfId);

export interface EntityForm {
  kind: Kind; name: string; parent_id: string; description: string; model: string; tags: string; enabled: boolean;
  rt_type: Entity['runtime']['type']; rt_url: string; rt_compose: string; rt_service: string; icon: string | null;
}
export const emptyForm = (): EntityForm => ({ kind: 'agent', name: '', parent_id: '', description: '', model: '', tags: '', enabled: true, rt_type: 'external', rt_url: '', rt_compose: '', rt_service: '', icon: null });
export const formFromEntity = (e: Entity): EntityForm => ({
  kind: e.kind, name: e.name, parent_id: e.parent_id || '', description: e.description, model: e.model, tags: e.tags.join(', '), enabled: e.enabled,
  rt_type: e.runtime.type, rt_url: e.runtime.url || '', rt_compose: e.runtime.compose_file || '', rt_service: e.runtime.service || '', icon: e.icon || null,
});
export function formToEntity(f: EntityForm) {
  const runtime: Record<string, string> = { type: f.rt_type, url: f.rt_url.trim() };
  if (f.rt_type === 'docker') { runtime.compose_file = f.rt_compose.trim(); runtime.service = f.rt_service.trim(); }
  return {
    kind: f.kind, name: f.name.trim(), parent_id: f.parent_id || null, description: f.description.trim(), model: f.model.trim(),
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), enabled: f.enabled, runtime, icon: f.icon,
  };
}
