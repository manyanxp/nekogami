// Agent Console — トレース可視化 & チャットサーバー（猫神さま・サブオーケストレーターと話す）
//  - POST /hooks      : Claude Code の HTTP フックを受信（CLI でも SDK でも同じ）
//  - GET  /events     : ブラウザへ Server-Sent Events でリアルタイム配信
//  - POST /api/chat   : Claude Agent SDK でエージェントに話しかける
//  - POST /api/stop   : 実行中の応答を中断
//  - POST /api/reset  : 新しい会話を開始
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nyaify } from './nya.mjs';
import { buildTargets, publicTargets } from './targets.mjs';
import { readIds } from './ids.mjs';
import { routeOf } from './route.mjs';
import { readTheme } from './theme.mjs';
import { z } from 'zod';
import { DIR_PREFIX, buildDirServers, checkDirAccess, loadDirNodes } from './fs-tools.mjs';
import { runPython } from './py-exec.mjs';
import { PY_PREFIX, buildPyServers, checkPyAccess, loadPyNodes } from './py-tools.mjs';
import { LLM_PREFIX, buildLlmServers, checkLlmAccess, loadLlmNodes } from './llm-tools.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(HERE, '..');
const PORT = Number(process.env.TRACE_PORT || 4317);
const REGISTRY_FILE = process.env.REGISTRY_FILE || path.join(PROJECT_DIR, 'portal', 'data', 'registry.json');   // ポータルの台帳（担当 UUID）
const THEME_FILE = process.env.THEME_FILE || path.join(PROJECT_DIR, 'portal', 'data', 'theme.json');   // ポータルの管理ページで設定したテーマ
const HOST = process.env.TRACE_HOST || '127.0.0.1';
// ディレクトリのノード（ADR 0037）が指す作業領域。ノードの path は、ここからの相対パス
const FS_ROOT = path.resolve(process.env.FS_ROOT || path.join(PROJECT_DIR, 'workspace'));
// LLM ノード（ADR 0040）が呼ぶローカル LLM（Ollama）。compose の `local-llm` プロファイルで起動する
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/+$/, '');
// Python の実行（ADR 0038）のジョブ置き場。実行役（py-sandbox）と共有する
const JOBS_DIR = path.resolve(process.env.SANDBOX_JOBS || path.join(PROJECT_DIR, 'sandbox', 'jobs'));
const CHAT_MODEL = process.env.CHAT_MODEL || undefined; // 未指定なら .claude/settings.json の model
const ALLOW_AZURE_MCP = process.env.ALLOW_AZURE_MCP !== '0';
// 既定の相手を決める従来の環境変数（PROJECT_DIR からの相対）。'.' = Azure Sage、'nekogamisama' = 猫神さま。CHAT_TARGET=<名前> でも指定できる
const CHAT_DIR = path.resolve(PROJECT_DIR, process.env.CHAT_PROJECT_DIR || '.');
if (CHAT_DIR !== PROJECT_DIR && !CHAT_DIR.startsWith(PROJECT_DIR + path.sep)) throw new Error('CHAT_PROJECT_DIR は PROJECT_DIR 配下を指定してください');
// チャットの相手。リクエストの `agent` で選ぶ（ポータルは nekogamisama を指定する）。セッションは相手ごとに別。
// 相手の一覧は、猫神さまの委任先一覧（suborchestrators.json）に追随するので、リクエストのたびに作る（ADR 0020）
const chatTargets = () => buildTargets(PROJECT_DIR);
const DEFAULT_TARGET = process.env.CHAT_TARGET || (CHAT_DIR === path.join(PROJECT_DIR, 'nekogamisama') ? 'nekogamisama' : 'azure-sage'); // 従来の CHAT_PROJECT_DIR も引き継ぐ
// トレースに出るエージェントの発言の語尾。空文字で無効化
const NYA_SUFFIX = process.env.NYA_SUFFIX ?? 'にゃ';
// 猫神さまからサブオーケストレーターへの委任だけ許可する Bash。依頼文は単一引用符で囲まれ、その中に単一引用符を含まない形に限る
// （単一引用符の内側はシェルが解釈しないので、コマンド連結や展開を持ち込めない）
const DELEGATE_CMD = /^(?:\.\/|nekogamisama\/)?bin\/delegate\.sh [a-z0-9][a-z0-9-]{0,63} '[^']+'$/;

// ---------- サブエージェント名 → モデル（frontmatter から取得） ----------
function loadAgentModels() {
  const dir = path.join(PROJECT_DIR, '.claude', 'agents');
  const map = {};
  try {
    // .claude/agents/<グループ>/<name>.md のように階層化されている（Claude Code も再帰的に読む）。名前は frontmatter の name が正
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      if (!f.endsWith('.md') || f.split(path.sep).some((p) => p.startsWith('.'))) continue;
      const fm = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) continue;
      const name = fm[1].match(/^name:\s*(.+)$/m)?.[1].trim();
      const model = fm[1].match(/^model:\s*(.+)$/m)?.[1].trim();
      if (name) map[name] = model || 'inherit';
    }
  } catch { /* agents フォルダがなくても動く */ }
  return map;
}
let agentModels = loadAgentModels();

/** 担当（エージェント定義）の名前 → 定義ファイルの tools（無ければ null = 全ツールを継承）。ディレクトリへの接続の確認に使う */
function loadAgentTools() {
  const dir = path.join(PROJECT_DIR, '.claude', 'agents');
  const map = {};
  try {
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      if (!f.endsWith('.md') || f.split(path.sep).some((p) => p.startsWith('.'))) continue;
      const fm = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const name = fm?.[1].match(/^name:\s*(.+)$/m)?.[1].trim();
      if (!name) continue;
      const tools = fm[1].match(/^tools:\s*(.*)$/m)?.[1];
      map[name] = tools === undefined ? null : tools.split(',').map((t) => t.trim()).filter(Boolean);
    }
  } catch { /* agents フォルダがなくても動く */ }
  return map;
}
// 実行中の担当（サブエージェント）の ID → 担当の名前。SubagentStart のフックで覚える（canUseTool が渡す agentID から、呼んだ担当を知るため）
const agentTypeById = new Map();
const rememberAgent = (id, type) => { agentTypeById.set(id, type); if (agentTypeById.size > 1000) agentTypeById.delete(agentTypeById.keys().next().value); };

// ---------- SSE ブロードキャスト ----------
const clients = new Set();
const history = [];
const HISTORY_MAX = 3000;
let seq = 0;

function record(ev) {
  history.push(ev);
  if (history.length > HISTORY_MAX) history.shift();
}
function send(ev, { store = true, broadcastIt = true } = {}) {
  ev.id = ++seq;
  ev.ts ??= Date.now();
  if (store) record(ev);
  if (!broadcastIt) return;
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(data);
}

const clip = (v, n = 2000) => {
  if (v == null) return undefined;
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return s.length > n ? `${s.slice(0, n)}\n…(+${s.length - n} chars)` : s;
};

function normalizeHook(h) {
  return {
    kind: 'hook',
    event: h.hook_event_name,
    sessionId: h.session_id,
    agentId: h.agent_id || null,
    agentType: h.agent_type || null,
    model: h.agent_type ? agentModels[h.agent_type] : (h.model || undefined),
    toolName: h.tool_name,
    toolUseId: h.tool_use_id,
    input: clip(h.tool_input),
    output: clip(h.tool_response ?? h.error),
    prompt: clip(h.prompt, 1000),
    // エージェント自身の発言（last_assistant_message）にだけ語尾を付ける。システム通知（message）には付けない
    message: h.last_assistant_message != null ? nyaify(clip(h.last_assistant_message, 1500), NYA_SUFFIX) : clip(h.message, 1500),
    source: h.source,
    // チャットの応答中に届いたフックは、その相手（猫神さまなど）の会話のトレースとして印を付ける。ポータルが絞り込みに使う
    ...chatInfoOfHook(h),
    route: routeOf(h),   // 切る前の入力から取り出す（ADR 0019）
  };
}

// ---------- チャット（Claude Agent SDK） ----------
let sdk = null;
// 会話は「相手 × 利用者」ごとに別（ポータルのログインユーザー。ADR 0035）。利用者なし = Agent Console 自身の画面
// キーは相手だけ、または `相手@利用者`。以下の sessionIds / running / chatMeta はこのキーで引く
const USER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const keyOf = (target, user) => (user ? `${target}@${user}` : target);
const sessionIds = {};   // 会話（キー）ごとの Claude セッション ID
const running = new Map();   // 応答中の会話（キー）→ AbortController。会話ごとに 1 つずつ、別の会話とは同時に動ける
const chatMeta = new Map();   // 応答中の会話（キー）→ { target, user }

/** フックを、どの会話中の出来事か判定する。session_id が一致する会話を優先し、応答中が 1 つだけならその会話とする */
function chatOfHook(h) {
  for (const k of running.keys()) if (h.session_id && sessionIds[k] === h.session_id) return k;
  return running.size === 1 ? [...running.keys()][0] : null;
}
function chatInfoOfHook(h) {
  const m = chatMeta.get(chatOfHook(h));
  return { chat: m?.target ?? null, chatUser: m?.user };
}
const runningChats = () => [...chatMeta.values()];

const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent', 'Task', 'TodoWrite', 'ToolSearch']);
const DOC_DIRS = ['reports', 'research'];
const WRITABLE_DIRS = ['reports', 'research'].map((d) => path.join(PROJECT_DIR, d) + path.sep);

async function canUseTool(toolName, input, target, user, opts) {
  let allowed = false;
  let reason = '';
  if (SAFE_TOOLS.has(toolName) || toolName.startsWith('mcp__microsoft-learn__')) {
    allowed = true;
  } else if (toolName.startsWith('mcp__azure__')) {
    allowed = ALLOW_AZURE_MCP;
    reason = allowed ? '' : 'Azure MCP はこのサーバーで無効化されています (ALLOW_AZURE_MCP=0)';
  } else if (toolName.startsWith(`mcp__${DIR_PREFIX}`) || toolName.startsWith(`mcp__${LLM_PREFIX}`) || toolName.startsWith(`mcp__${PY_PREFIX}`)) {   // ディレクトリ・LLM・Python のノード。ノードの権限と、呼んだ担当の接続の両方を確かめる
    const callerName = opts?.agentID ? agentTypeById.get(opts.agentID) : chatTargets().get(target)?.agent;
    const callerTools = loadAgentTools()[callerName];
    const r = toolName.startsWith(`mcp__${DIR_PREFIX}`)
      ? checkDirAccess({ toolName, nodes: loadDirNodes(REGISTRY_FILE), callerName, callerTools })
      : toolName.startsWith(`mcp__${PY_PREFIX}`)
        ? checkPyAccess({ toolName, nodes: loadPyNodes(REGISTRY_FILE), callerName, callerTools })
        : checkLlmAccess({ toolName, nodes: loadLlmNodes(REGISTRY_FILE), callerName, callerTools });
    allowed = r.ok;
    reason = r.reason || '';
  } else if (toolName === 'Write' || toolName === 'Edit') {
    const p = path.resolve(PROJECT_DIR, String(input?.file_path || ''));
    allowed = WRITABLE_DIRS.some((d) => p.startsWith(d));
    reason = allowed ? '' : 'reports/ と research/ 以外への書き込みは許可されていません';
  } else if (toolName === 'Bash') {
    allowed = target === 'nekogamisama' && DELEGATE_CMD.test(String(input?.command || ''));
    reason = allowed ? '' : 'Bash は nekogamisama/bin/delegate.sh <名前> \'<依頼文>\' の形だけ許可されています';
  } else {
    reason = `${toolName} はチャットモードでは許可されていません`;
  }
  send({ kind: 'permission', toolName, allowed, reason, chat: target, user });
  return allowed ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: reason };
}

function handleSdkMessage(m, target, user) {
  switch (m.type) {
    case 'system':
      if (m.subtype === 'init') {
        sessionIds[keyOf(target, user)] = m.session_id;
        send({ kind: 'session', agent: target, user, sessionId: m.session_id, model: m.model, mcp: m.mcp_servers, agents: agentModels });
      }
      break;
    case 'stream_event': {
      if (m.parent_tool_use_id) break; // サブエージェントの逐次出力はトレース側で扱う
      const ev = m.event;
      if (ev?.type === 'message_start') send({ kind: 'chat', agent: target, user, type: 'message_start' }, { store: false });
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        send({ kind: 'chat', agent: target, user, type: 'delta', text: ev.delta.text }, { store: false });
      }
      break;
    }
    case 'assistant': {
      const text = (m.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (!text) break;
      if (m.parent_tool_use_id) {
        send({ kind: 'sdk', chat: target, chatUser: user, type: 'subagent_text', parent: m.parent_tool_use_id, text: nyaify(clip(text, 800), NYA_SUFFIX) });
      } else {
        // 再接続時の再描画用に保存（逐次 delta は既に配信済みなので配信しない）
        send({ kind: 'chat', agent: target, user, type: 'assistant_full', text }, { broadcastIt: false });
      }
      break;
    }
    case 'result':
      send({
        kind: 'chat', agent: target, user, type: 'result',
        isError: m.is_error, subtype: m.subtype,
        cost: m.total_cost_usd, durationMs: m.duration_ms, turns: m.num_turns,
        modelUsage: m.modelUsage,
      });
      break;
  }
}

async function runChat(text, target, user) {
  const key = keyOf(target, user);
  if (!sdk) {
    try { sdk = await import('@anthropic-ai/claude-agent-sdk'); }
    catch (e) { send({ kind: 'chat', agent: target, user, type: 'error', text: `Agent SDK を読み込めません。dashboard で npm install を実行してください。\n${e.message}` }); return; }
  }
  const ac = new AbortController();
  running.set(key, ac);
  chatMeta.set(key, { target, user });
  send({ kind: 'chat', agent: target, user, type: 'user', text });
  send({ kind: 'chat', agent: target, user, type: 'busy' }, { store: false });
  try {
    const q = sdk.query({
      prompt: text,
      options: {
        cwd: chatTargets().get(target).cwd,
        agent: chatTargets().get(target).agent,   // agent 型の相手は、メインスレッドをそのエージェントにする
        settingSources: ['project'], // CLAUDE.md / .claude/agents / settings.json(フック含む) / .mcp.json
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        resume: sessionIds[key] || undefined,
        model: CHAT_MODEL,
        includePartialMessages: true,
        abortController: ac,
        mcpServers: {   // 権限のある操作だけ公開する
          ...buildDirServers({ sdk, z, nodes: loadDirNodes(REGISTRY_FILE), root: FS_ROOT, run: (box, code) => runPython({ box, code, jobsDir: JOBS_DIR }) }),
          ...buildLlmServers({ sdk, z, nodes: loadLlmNodes(REGISTRY_FILE), baseUrl: OLLAMA_URL }),
          ...buildPyServers({ sdk, z, nodes: loadPyNodes(REGISTRY_FILE), run: (code) => runPython({ code, jobsDir: JOBS_DIR }) }),
        },
        canUseTool: (n, i, o) => canUseTool(n, i, target, user, o),
      },
    });
    for await (const m of q) handleSdkMessage(m, target, user);
  } catch (e) {
    send({ kind: 'chat', agent: target, user, type: 'error', text: ac.signal.aborted ? '中断しました' : String(e?.message || e) });
  } finally {
    running.delete(key);
    chatMeta.delete(key);
    send({ kind: 'chat', agent: target, user, type: 'idle' }, { store: false });
  }
}

// ---------- Claude ログイン（claude auth login をブラウザ画面から操作） ----------
let login = null; // { proc, url, state: 'starting'|'waiting_code'|'verifying'|'done'|'failed', log }
function authStatus() {
  return new Promise((resolve) => {
    execFile('claude', ['auth', 'status'], { timeout: 15000 }, (err, out) => {
      try { resolve(JSON.parse(out)); } catch { resolve({ loggedIn: false, error: String(err?.message || 'unknown') }); }
    });
  });
}
function startLogin(mode) {
  if (login?.proc && ['starting', 'waiting_code', 'verifying'].includes(login.state)) login.proc.kill();
  const args = ['auth', 'login', mode === 'console' ? '--console' : '--claudeai'];
  const proc = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'true' } });
  const st = { proc, url: null, state: 'starting', log: '' };
  login = st;
  const onData = (d) => {
    st.log = (st.log + d).slice(-4000);
    const m = st.log.match(/https:\/\/\S+/);
    if (m && !st.url) { st.url = m[0]; st.state = 'waiting_code'; }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('exit', async (code) => { st.state = code === 0 ? 'done' : 'failed'; });
  proc.on('error', (e) => { st.state = 'failed'; st.log += String(e); });
  setTimeout(() => { if (login === st && ['starting', 'waiting_code'].includes(st.state)) { st.proc.kill(); st.state = 'failed'; st.log += '\nタイムアウト'; } }, 10 * 60 * 1000);
}
const loginView = () => login && { state: login.state, url: login.url, log: login.state === 'failed' ? login.log.slice(-500) : undefined };

// ---------- HTTP ----------
function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
// 画面は web/（Next.js）が配信する。この Console は API と SSE（/events, /hooks, /api/*）だけを受け持つ
const WEB_URL = (process.env.WEB_URL || '').replace(/\/$/, '');   // 未指定なら、アクセスされたホスト名の :4400 へ送る

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST' && url.pathname === '/hooks') {
      const body = await readBody(req);
      try {
        const hook = JSON.parse(body);
        if (hook.hook_event_name === 'SubagentStart' && hook.agent_id && hook.agent_type) rememberAgent(hook.agent_id, hook.agent_type);
        send(normalizeHook(hook));
      } catch { /* 壊れた入力は無視 */ }
      res.writeHead(200); return res.end(); // 空ボディ = 何も変更しない
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ kind: 'hello', running: running.has(DEFAULT_TARGET), runningTargets: runningChats().map((m) => m.target), runningChats: runningChats(), sessionId: sessionIds[DEFAULT_TARGET] || null, defaultAgent: DEFAULT_TARGET, targets: publicTargets(chatTargets(), PROJECT_DIR), agents: agentModels })}\n\n`);
      for (const ev of history) res.write(`data: ${JSON.stringify({ ...ev, replay: true })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/ids') return json(res, 200, readIds(REGISTRY_FILE));
    if (req.method === 'GET' && url.pathname === '/api/theme') return json(res, 200, readTheme(THEME_FILE));
    if (req.method === 'GET' && url.pathname === '/api/targets') return json(res, 200, { default: DEFAULT_TARGET, running: runningChats().map((m) => m.target), runningChats: runningChats(), items: publicTargets(chatTargets(), PROJECT_DIR) });
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const { message, agent, user } = JSON.parse(await readBody(req) || '{}');
      if (!message?.trim()) return json(res, 400, { error: 'message is required' });
      if (user !== undefined && !USER_RE.test(String(user))) return json(res, 400, { error: 'user の形式が不正' });
      const target = agent ?? DEFAULT_TARGET;
      if (!chatTargets().has(target)) return json(res, 400, { error: `agent は ${[...chatTargets().keys()].join(' / ')} のいずれか` });
      if (running.has(keyOf(target, user))) return json(res, 409, { error: '応答中です。停止するか完了を待ってください。' });
      agentModels = loadAgentModels();
      runChat(message.trim(), target, user);
      return json(res, 202, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      const st = await authStatus();
      return json(res, 200, { loggedIn: !!st.loggedIn, authMethod: st.authMethod, email: st.email, login: loginView() });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const { mode } = JSON.parse(await readBody(req) || '{}');
      startLogin(mode);
      return json(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/code') {
      const { code } = JSON.parse(await readBody(req) || '{}');
      if (!login || login.state !== 'waiting_code') return json(res, 409, { error: 'ログイン待ちではありません' });
      if (!code?.trim()) return json(res, 400, { error: 'code is required' });
      login.state = 'verifying';
      login.proc.stdin.write(code.trim() + '\n');
      return json(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      await new Promise((r) => execFile('claude', ['auth', 'logout'], () => r()));
      login = null;
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      const { agent, user } = JSON.parse(await readBody(req) || '{}');   // 相手を指定したときはその相手だけ、無ければ全部止める。止められるのは同じ利用者の会話だけ
      for (const [k, ac] of running) { const m = chatMeta.get(k); if ((!agent || agent === m?.target) && m?.user === user) ac.abort(); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const { agent, user } = JSON.parse(await readBody(req) || '{}');   // 消せるのは同じ利用者の会話だけ（利用者なし = Agent Console 自身の会話とトレース）
      if (agent !== undefined && !chatTargets().has(agent)) return json(res, 400, { error: 'unknown agent' });
      const mine = (k) => { const m = chatMeta.get(k); return m?.user === user && (!agent || m.target === agent); };
      if ([...running.keys()].some(mine)) return json(res, 409, { error: '応答中はリセットできません' });
      for (const k of Object.keys(sessionIds)) {
        const [t, u] = k.split('@');
        if (u === user && (!agent || t === agent)) delete sessionIds[k];
      }
      for (let i = history.length - 1; i >= 0; i--) {   // トレースなど他の履歴や、他の利用者の会話は残す
        const ev = history[i];
        const evUser = ev.user ?? ev.chatUser;
        const evAgent = ev.kind === 'chat' ? ev.agent : ev.chat;
        if (evUser === user && (!agent ? true : evAgent === agent)) history.splice(i, 1);
      }
      send({ kind: 'reset', agent, user }, { store: false });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/docs') {
      const items = [];
      for (const d of DOC_DIRS) {
        const dir = path.join(PROJECT_DIR, d);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.md')) continue;
          const st = fs.statSync(path.join(dir, f));
          if (st.isFile()) items.push({ path: `${d}/${f}`, name: f, dir: d, mtime: st.mtimeMs, size: st.size });
        }
      }
      items.sort((x, y) => y.mtime - x.mtime);
      return json(res, 200, { items });
    }
    if (req.method === 'GET' && url.pathname === '/api/doc') {
      const rel = url.searchParams.get('path') || '';
      const file = path.resolve(PROJECT_DIR, rel);
      const ok = rel.endsWith('.md') && DOC_DIRS.some((d) => file.startsWith(path.join(PROJECT_DIR, d) + path.sep));
      if (!ok || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      return res.end(fs.readFileSync(file, 'utf8'));
    }
    if (req.method === 'GET' && url.pathname === '/') {   // 昔の入口。画面は Next.js 側
      const web = WEB_URL || `http://${url.hostname}:4400`;
      res.writeHead(302, { location: `${web}/console${url.search}` });
      return res.end();
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Console: http://${HOST}:${PORT}`);
  console.log(`project: ${PROJECT_DIR}`);
  console.log(`chat   : ${[...chatTargets().keys()].join(', ')}（既定: ${DEFAULT_TARGET}）`);
  console.log(`agents : ${JSON.stringify(agentModels)}`);
});
