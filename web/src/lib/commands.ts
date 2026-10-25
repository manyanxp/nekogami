// チャットの / コマンド（サブオーケストレーター・エージェントの呼び出し）の候補。ADR 0026。
import type { ChatCommand } from './types';

/** 入力が「/」で始まり、まだコマンド名を打っている途中なら、候補（前方一致 → 部分一致、最大 30）を返す。そうでなければ null */
export function matchCommands(input: string, commands: ChatCommand[]): ChatCommand[] | null {
  const m = input.match(/^\/([A-Za-z0-9._-]*)$/);
  if (!m) return null;
  const q = m[1].toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const inc = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
  return [...starts, ...inc].slice(0, 30);
}

export function helpText(commands: ChatCommand[]): string {
  if (!commands.length) return 'コマンドを取得できませんでした（Agent Console / ポータルのバックエンドを確認してください）。';
  const line = (c: ChatCommand) => `  /${c.name}  ${c.kind === 'delegate' ? `［委任先・${c.type === 'agent' ? 'Agent' : '別セッション'}］` : '［エージェント］'} ${c.description || ''}`.trimEnd();
  return ['/名前 依頼文 で、猫神さまにその相手を指名して依頼します。', '', ...commands.map(line), '', '  /help  この一覧', '先頭に空白を入れると、/ で始まる文をそのまま送れます。'].join('\n');
}
