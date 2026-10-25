// フックイベントから「どのエージェントが選ばれたか」を取り出す。
// ツールの入力は、イベントに載せるときに 2000 文字で切られる。subagent_type は JSON の末尾（prompt の後）にあるので、
// 長い依頼文だと切り捨てられてしまう。切る前の生の入力から、ここで取り出して `route` として別に持たせる。
const DELEGATE_RE = /delegate\.sh\s+([a-z0-9][a-z0-9-]*)/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function routeOf(h) {
  if (h?.hook_event_name !== 'PreToolUse') return null;
  const input = h.tool_input && typeof h.tool_input === 'object' ? h.tool_input : {};
  if ((h.tool_name === 'Agent' || h.tool_name === 'Task') && typeof input.subagent_type === 'string' && NAME_RE.test(input.subagent_type)) {
    return { to: input.subagent_type, via: 'agent', description: String(input.description || '').slice(0, 120) };
  }
  if (h.tool_name === 'Bash' && typeof input.command === 'string') {
    const m = input.command.match(DELEGATE_RE);
    if (m) return { to: m[1], via: 'session', description: '' };
  }
  return null;
}
