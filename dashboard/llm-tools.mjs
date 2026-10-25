// LLM ノード（ローカル LLM。ADR 0040）: 台帳の LLM ノードを、Agent SDK のプロセス内 MCP サーバー `llm-<名前>` として担当に公開する。
// 担当は `ask` ツールで質問できる。Ollama の API を直接呼ぶので、Claude Code のプロンプトで文脈を食わない。
// どの担当が使えるかは、ディレクトリのノードと同じく、担当の定義ファイルの tools（`mcp__llm-<名前>__*`）で決まる。
import fs from 'node:fs';

export const LLM_PREFIX = 'llm-';
export const MAX_INPUT = 24000;     // 文字。質問と、添えた資料の合計
export const MAX_ANSWER = 20000;    // 文字。長い答えは切り詰める
const NODE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;      // MCP のサーバー名（llm-<名前>）になる。API 側の規則と同じ
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);

/** ポータルの台帳（registry.json）から、LLM ノードを読む。読めない・不正なものは無いものとして扱う */
export function loadLlmNodes(registryFile) {
  try {
    const tools = JSON.parse(fs.readFileSync(registryFile, 'utf8')).tools || [];
    return tools
      .filter((t) => t.kind === 'llm' && NODE_NAME.test(t.name || '') && MODEL.test(t.model || ''))
      .map((t) => ({ name: t.name, model: t.model, description: String(t.description || ''), prompt: typeof t.prompt === 'string' ? t.prompt.slice(0, 8000) : '',
        temperature: num(t.temperature, 0, 2, 0.7), max_tokens: Math.trunc(num(t.max_tokens, 16, 4096, 1024)) }));
  } catch { return []; }
}

/** `mcp__llm-<名前>__ask` の判定。ノードが台帳にあり、呼んだ担当が接続している（tools に `mcp__llm-<名前>__*`）ときだけ許可する */
export function checkLlmAccess({ toolName, nodes, callerName, callerTools }) {
  const [, server, op] = String(toolName).split('__');
  if (!server?.startsWith(LLM_PREFIX) || op !== 'ask') return { ok: false, reason: `${toolName} は LLM ノードのツールではない` };
  const name = server.slice(LLM_PREFIX.length);
  if (!nodes.some((n) => n.name === name)) return { ok: false, reason: `LLM ノード ${name} は台帳にない` };
  if (!callerName) return { ok: false, reason: '呼んだ担当を特定できないので許可しない' };
  if (!callerTools?.includes(`mcp__${server}__*`) && !callerTools?.includes(toolName)) return { ok: false, reason: `${callerName} は LLM ノード ${name} に接続されていない（管理ページのノードグラフで接続する）` };
  return { ok: true };
}

/** Ollama に 1 回質問する（履歴は持たない）。システムプロンプトはノードのもの */
export async function askLlm(node, { prompt, context }, { baseUrl, fetchFn = fetch, timeoutMs = 180000 } = {}) {
  const text = [context, prompt].filter((s) => typeof s === 'string' && s.trim()).join('\n\n');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt（質問）が必要');
  if (text.length > MAX_INPUT) throw new Error(`質問と資料の合計は ${MAX_INPUT} 文字まで（このモデルの文脈は短い）`);
  const messages = [...(node.prompt ? [{ role: 'system', content: node.prompt }] : []), { role: 'user', content: text }];
  let res;
  try {
    res = await fetchFn(`${baseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      // think:false … 考える過程を出さない（速く、答えだけを返す）
      body: JSON.stringify({ model: node.model, messages, stream: false, think: false, options: { temperature: node.temperature, num_predict: node.max_tokens } }),
    });
  } catch (e) {
    throw new Error(`ローカル LLM（Ollama: ${baseUrl}）に接続できない。起動は \`docker compose --profile local-llm up -d ollama\`（${e.name === 'TimeoutError' ? '時間切れ' : e.message}）`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Ollama のエラー ${res.status}: ${String(body?.error || '').slice(0, 300)}（モデル ${node.model} は取得済みか: \`ollama pull ${node.model}\`）`);
  const answer = String(body?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!answer) throw new Error('空の答えが返った');
  return answer.length > MAX_ANSWER ? `${answer.slice(0, MAX_ANSWER)}\n…（${answer.length} 文字のうち先頭 ${MAX_ANSWER} 文字だけ）` : answer;
}

/** LLM ノードごとに、`ask` ツールを 1 つ持つ MCP サーバーを作る */
export function buildLlmServers({ sdk, z, nodes, baseUrl, fetchFn }) {
  const servers = {};
  for (const n of nodes) {
    const ask = sdk.tool('ask', `ローカル LLM「${n.name}」（${n.model}）に質問して、答えを文章で受け取る。${n.description ? `${n.description}。` : ''}ツールもファイルも使えず、読めるのは渡した文章だけ。文脈が短い（質問と資料は合計 ${MAX_INPUT} 文字まで）ので、要点だけを渡す`,
      { prompt: z.string().describe('質問や依頼'), context: z.string().optional().describe('判断の材料になる資料（任意）') },
      async (a) => {
        try { return { content: [{ type: 'text', text: await askLlm(n, a, { baseUrl, fetchFn }) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `エラー: ${e.message}` }], isError: true }; }
      });
    servers[`${LLM_PREFIX}${n.name}`] = sdk.createSdkMcpServer({ name: `${LLM_PREFIX}${n.name}`, version: '1.0.0', tools: [ask] });
  }
  return servers;
}
