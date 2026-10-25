// 足りないときの一時エージェントの自動作成（ADR 0043）。
// サブオーケストレーターが `spawn` ツールを呼ぶと、その場で担当を作って動かし、結果を返して消える（保存しない）。
// 作った担当は読み取り系のツールだけ。呼んだ担当がつないでいる読み取り系のツールのうち、引き継げるものだけを使う。
// 動きは、トレースとポータルのターミナルに「自動作成/<名前>」として出す（フックと同じ形のイベントを送る）。
import crypto from 'node:crypto';

export const SPAWN_SERVER = 'neko-spawn';
export const SPAWN_ENTRY = `mcp__${SPAWN_SERVER}__*`;
export const READ_ONLY = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
export const MAX_SPAWNS = 3;          // 1 回の依頼（チャットの応答）で作れる数
export const MAX_TURNS = 12;
export const TIMEOUT_MS = 180_000;
export const MAX_RESULT = 20_000;     // 文字
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const AUTO_PREFIX = '自動作成/';

/** 自動作成の許可: 呼んだ担当が、自分の tools に `mcp__neko-spawn__*` を持つ（管理ページのスイッチ）ときだけ */
export function checkSpawnAccess({ toolName, callerName, callerTools }) {
  if (toolName !== `mcp__${SPAWN_SERVER}__spawn`) return { ok: false, reason: `${toolName} は自動作成のツールではない` };
  if (!callerName) return { ok: false, reason: '呼んだ担当を特定できないので許可しない' };
  if (!callerTools?.includes(SPAWN_ENTRY) && !callerTools?.includes(toolName)) return { ok: false, reason: `${callerName} には、担当の自動作成が許可されていない（管理ページでスイッチを入れる）` };
  return { ok: true };
}

/** 引き継げるツール: 呼んだ担当の tools（指定なし = 全部）のうち読み取り系。希望（want）があれば、その範囲に絞る */
export function inheritTools(callerTools, want) {
  const have = callerTools == null ? READ_ONLY : READ_ONLY.filter((t) => callerTools.some((c) => c.split('(')[0] === t));
  return want?.length ? have.filter((t) => want.includes(t)) : have;
}

const clip = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return s.length > n ? `${s.slice(0, n)}…` : s; };

/**
 * 一時エージェントを 1 体、作って動かして消す。
 * deps: query（SDK の query）、emit（トレースに出すイベント）、signal（中断）、cwd、model
 * 戻り値: { ok, text }。失敗は ok=false（例外にしない: 呼んだ担当が続きを判断できるように）
 */
export async function runSpawn({ name, role, task, tools, callerName }, { query, emit, signal, cwd, model }) {
  const agentType = `${AUTO_PREFIX}${name}`;
  const agentId = `auto-${crypto.randomUUID().slice(0, 8)}`;
  const allowed = tools;
  const ev = (event, extra = {}) => emit({ event, agentId, agentType, auto: true, ...extra });
  ev('SubagentStart', { prompt: clip(`${callerName} が作成: ${role}`, 300), model });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => ac.abort(), { once: true });
  let text = '', failed = '';
  const calls = new Map();
  try {
    const q = query({
      prompt: task,
      options: {
        cwd, model, maxTurns: MAX_TURNS, abortController: ac,
        settingSources: [],                       // プロジェクトの設定・フック・MCP は読まない
        systemPrompt: `あなたは、${callerName} が必要に応じてその場で作った、使い捨ての担当「${name}」です。役割: ${role}\n` +
          '渡された依頼だけを、使えるツール（読み取りのみ）で調べ、結果を簡潔にまとめて返します。事実と推測を分け、出典があれば示します。' +
          '作成・変更・削除はできません。ほかの担当は呼べません。',
        allowedTools: allowed,
        canUseTool: async (n, input) => allowed.includes(n)
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: `${n} は自動作成の担当には許可されていない（使えるのは ${allowed.join(', ') || 'なし'}）` },
      },
    });
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const b of m.message?.content || []) if (b.type === 'tool_use') { calls.set(b.id, b.name); ev('PreToolUse', { toolName: b.name, toolUseId: b.id, input: clip(b.input?.file_path || b.input?.pattern || b.input?.query || b.input?.url || b.input, 200) }); }
      } else if (m.type === 'user') {
        for (const b of (Array.isArray(m.message?.content) ? m.message.content : [])) if (b.type === 'tool_result' && calls.has(b.tool_use_id)) { ev(b.is_error ? 'PostToolUseFailure' : 'PostToolUse', { toolName: calls.get(b.tool_use_id), toolUseId: b.tool_use_id }); calls.delete(b.tool_use_id); }
      } else if (m.type === 'result') {
        if (m.is_error || m.subtype !== 'success') failed = `実行が完了しなかった（${m.subtype || 'error'}）`;
        else text = String(m.result || '');
      }
    }
  } catch (e) {
    failed = ac.signal.aborted ? (signal?.aborted ? '中断された' : `時間切れ（${TIMEOUT_MS / 1000} 秒）`) : String(e?.message || e);
  } finally {
    clearTimeout(timer);
  }
  const ok = !failed && !!text.trim();
  if (!ok && !failed) failed = '空の結果が返った';
  ev('SubagentStop', { message: clip(ok ? `${text}\n（自動作成の担当を削除しました）` : `${failed}（自動作成の担当を削除しました）`, 400) });
  return ok ? { ok, text: text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}\n…（${text.length} 文字のうち先頭だけ）` : text } : { ok, text: failed };
}

/**
 * 自動作成のサーバー（MCP）。1 回の依頼ごとに作り直す（作成数の数え直しのため）。
 * ctx: { sdk, z, query, emit, signal, cwd, model }。呼んだ担当の名前とツールは、canUseTool が入力へ書き込む（モデルが指定した値は上書きされる）
 */
export function buildSpawnServer(ctx) {
  const { sdk, z } = ctx;
  let made = 0;
  return {
    [SPAWN_SERVER]: sdk.createSdkMcpServer({
      name: SPAWN_SERVER,
      tools: [sdk.tool('spawn',
        `配下の担当だけでは足りないときに、使い捨ての担当をその場で作って依頼する（読み取りのみ。1 回の依頼で ${MAX_SPAWNS} 体まで。終われば消える）。既存の配下で足りるときは使わない。`,
        {
          name: z.string().describe('担当の名前（小文字英数字とハイフン、30 文字まで）'),
          role: z.string().describe('担当の役割（500 文字まで）'),
          task: z.string().describe('依頼の内容。前提・目的・期待する出力の形を含める（4000 文字まで）'),
          tools: z.array(z.string()).optional().describe(`使わせるツール。省略すると、あなたが持つ読み取り系すべて。選べるのは ${READ_ONLY.join(', ')}`),
          _caller: z.string().optional().describe('内部用。指定しない'),
          _caller_tools: z.array(z.string()).nullable().optional().describe('内部用。指定しない'),
        },
        async (a) => {
          const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
          if (!NAME_RE.test(a.name || '')) return fail('name は小文字英数字とハイフン（先頭は英数字、30 文字まで）');
          if (!a.role?.trim() || a.role.length > 500) return fail('role は 1〜500 文字');
          if (!a.task?.trim() || a.task.length > 4000) return fail('task は 1〜4000 文字');
          if (!a._caller) return fail('呼んだ担当を特定できない');
          if (made >= MAX_SPAWNS) return fail(`自動作成は 1 回の依頼で ${MAX_SPAWNS} 体まで。作った担当の結果をまとめて答える`);
          const tools = inheritTools(a._caller_tools, a.tools);
          if (!tools.length) return fail('引き継げる読み取り系のツールがない（Read / Glob / Grep / WebSearch / WebFetch のいずれかを、先に担当へつなぐ）');
          made += 1;
          const r = await runSpawn({ name: a.name, role: a.role.trim(), task: a.task.trim(), tools, callerName: a._caller }, ctx);
          return { content: [{ type: 'text', text: r.text }], isError: !r.ok };
        })],
    }),
  };
}
