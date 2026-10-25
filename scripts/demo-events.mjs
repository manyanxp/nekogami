// API キーなしでダッシュボードの見た目を確認するためのデモ。
// 実際の Claude Code が送るのと同じ形のフックイベントを /hooks に送ります。
// 使い方: (dashboard で npm start した状態で) node scripts/demo-events.mjs
const URL_ = process.env.TRACE_URL || 'http://127.0.0.1:4317/hooks';
const sid = 'demo-' + Math.random().toString(16).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const tid = () => `toolu_demo_${++n}`;
async function post(ev) {
  await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sid, cwd: process.cwd(), permission_mode: 'default', ...ev }) });
}
async function tool(agent, tool_name, tool_input, tool_response, ms) {
  const id = tid();
  await post({ hook_event_name: 'PreToolUse', ...agent, tool_name, tool_input, tool_use_id: id });
  await sleep(ms);
  await post({ hook_event_name: 'PostToolUse', ...agent, tool_name, tool_input, tool_response, tool_use_id: id });
}
const R = (i) => ({ agent_id: `${sid}-res-${i}`, agent_type: 'azure-researcher' });
const REV = { agent_id: `${sid}-rev`, agent_type: 'azure-reviewer' };
const ARC = { agent_id: `${sid}-arc`, agent_type: 'azure-architect' };

await post({ hook_event_name: 'SessionStart', source: 'startup' });
await post({ hook_event_name: 'UserPromptSubmit', prompt: 'Agent 365 と Microsoft Foundry の関係と導入前提を整理し、PoC 構成を提案して' });
await sleep(600);

const topics = ['Agent 365 の前提条件', 'Foundry hosted agent', 'トレースと評価'];
for (let i = 0; i < 3; i++) {
  post({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: `deleg-${i}`, tool_input: { subagent_type: 'azure-researcher', description: topics[i] } });
}
await sleep(300);
await Promise.all(topics.map(async (t, i) => {
  await post({ hook_event_name: 'SubagentStart', ...R(i) });
  await tool(R(i), 'mcp__microsoft-learn__microsoft_docs_search', { query: t }, { results: ['…'] }, 900 + i * 300);
  await tool(R(i), 'mcp__microsoft-learn__microsoft_docs_fetch', { url: 'https://learn.microsoft.com/azure/foundry/agents/concepts/agent-365-integration' }, '# Agent 365 integration …', 1500 + i * 400);
  await post({ hook_event_name: 'SubagentStop', ...R(i), last_assistant_message: `## 観点: ${t}\n### 事実\n- …` });
  await post({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: `deleg-${i}`, tool_response: 'done' });
}));

await post({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'deleg-rev', tool_input: { subagent_type: 'azure-reviewer', description: '調査結果の精査' } });
await post({ hook_event_name: 'SubagentStart', ...REV });
await tool(REV, 'WebFetch', { url: 'https://learn.microsoft.com/microsoft-agent-365/overview' }, '…', 1800);
await post({ hook_event_name: 'PostToolUseFailure', ...REV, tool_name: 'WebFetch', tool_use_id: 'x-fail', error: 'HTTP 404 (demo)' });
await sleep(800);
await post({ hook_event_name: 'SubagentStop', ...REV, last_assistant_message: '## 精査結果\n- Frontier プレビュー参加が前提（確度: 高）' });
await post({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'deleg-rev', tool_response: 'done' });

await post({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'deleg-arc', tool_input: { subagent_type: 'azure-architect', description: 'PoC 構成提案' } });
await post({ hook_event_name: 'SubagentStart', ...ARC });
await tool(ARC, 'mcp__microsoft-learn__microsoft_code_sample_search', { query: 'Foundry hosted agent bicep' }, '…', 1200);
await tool(ARC, 'Write', { file_path: 'reports/20261023-agent365-foundry-poc.md' }, 'ok', 400);
await post({ hook_event_name: 'SubagentStop', ...ARC, last_assistant_message: '提案を reports/20261023-agent365-foundry-poc.md に保存しました' });
await post({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'deleg-arc', tool_response: 'done' });
await post({ hook_event_name: 'Stop', last_assistant_message: '結論: …（デモ）' });
console.log('demo events sent:', sid);
