import { describe, expect, it } from 'vitest';
import { parseSse } from './api';
import { helpText, matchCommands } from './commands';

describe('parseSse', () => {
  it('チャンクの切れ目をまたぐ', () => {
    const a = parseSse('data: {"a":1}\n\ndata: {"b"');
    expect(a.events).toEqual([{ a: 1 }]);
    expect(parseSse(a.rest + ':2}\n\n').events).toEqual([{ b: 2 }]);
  });
  it('壊れた行は捨てる', () => expect(parseSse('data: {x\n\n: ping\n\n').events).toEqual([]));
});
describe('commands', () => {
  const cs = [{ name: 'azure-sage', kind: 'delegate', type: 'session', how: '', description: 'd' }, { name: 'my-azure', kind: 'agent', type: 'agent', how: '', description: '' }] as never[];
  it('前方一致が先、部分一致が後', () => expect(matchCommands('/az', cs)!.map((c) => c.name)).toEqual(['azure-sage', 'my-azure']));
  it('コマンド名の途中でなければ null', () => { expect(matchCommands('hello', cs)).toBeNull(); expect(matchCommands('/a b', cs)).toBeNull(); });
  it('help', () => expect(helpText([])).toContain('取得できませんでした'));
});
