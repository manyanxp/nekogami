import { describe, expect, it } from 'vitest';
import { formToEntity, emptyForm, parentOptions, toTree } from './model';
import type { Entity } from './types';

const E = (id: string, kind: Entity['kind'], name: string, parent_id: string | null = null, o: Partial<Entity> = {}): Entity =>
  ({ id, kind, name, parent_id, description: '', model: '', enabled: true, tags: [], runtime: { type: 'builtin' }, tool_ids: [], pos: null, ...o });
const ents = [E('n', 'orchestrator', 'nekogamisama', null, { protected: true }), E('s', 'suborchestrator', 'azure-sage', 'n'), E('a1', 'subagent', 'azure-a', 's'),
  E('a2', 'subagent', 'azure-b', 's'), E('g', 'agent', 'helper', 'n'), E('g1', 'subagent', 'helper-sub', 'g')];

describe('toTree', () => {
  it('protected を隠し、その子を depth 0 に出す', () => {
    expect(toTree(ents).map((r) => `${r.depth}:${r.name}`)).toEqual(['0:azure-sage', '1:azure-a', '1:azure-b', '0:helper', '1:helper-sub']);
  });
  it('折りたたむと子が隠れ、検索中は無視する', () => {
    expect(toTree(ents, { collapsed: new Set(['s']) }).map((r) => r.name)).toEqual(['azure-sage', 'helper', 'helper-sub']);
    expect(toTree(ents, { q: 'azure-a', collapsed: new Set(['s']) }).map((r) => r.name)).toEqual(['azure-a']);
  });
  it('種別フィルタ', () => expect(toTree(ents, { kind: 'agent' }).map((r) => r.name)).toEqual(['helper']));
});
it('親の選択肢', () => expect(parentOptions(ents, 'subagent').map((e) => e.name)).toEqual(['nekogamisama', 'azure-sage', 'helper']));
it('formToEntity: タグ分割・docker の項目', () => {
  const f = { ...emptyForm(), name: ' x ', tags: 'a, b,,', rt_type: 'docker' as const, rt_compose: 'c.yml', rt_service: 's' };
  const e = formToEntity(f);
  expect(e.name).toBe('x'); expect(e.tags).toEqual(['a', 'b']); expect(e.runtime).toEqual({ type: 'docker', url: '', compose_file: 'c.yml', service: 's' });
});
