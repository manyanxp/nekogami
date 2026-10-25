// Agent Console の会話の相手（ADR 0020）。猫神さま、Azure Sage、猫神さまの委任先一覧（nekogamisama/suborchestrators.json）の各項目。
//   session 型: その dir（プロジェクト配下）で会話する。
//   agent 型  : プロジェクトのルートで、メインスレッドをそのエージェント（.claude/agents/ の定義）にして会話する（SDK の `agent` オプション）。
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function buildTargets(projectDir) {
  const root = path.resolve(projectDir);
  const nekoDir = path.join(root, 'nekogamisama');
  const inside = (p) => p === root || p.startsWith(root + path.sep);
  const targets = new Map();
  targets.set('nekogamisama', { name: 'nekogamisama', label: '猫神さま', type: 'orchestrator', cwd: nekoDir, description: '全体を束ねる最上位のオーケストレーター' });
  targets.set('azure-sage', { name: 'azure-sage', label: 'Azure Sage', type: 'session', cwd: root, description: 'Azure 調査・開発提案のサブオーケストレーター' });
  let entries = {};
  try { entries = JSON.parse(fs.readFileSync(path.join(nekoDir, 'suborchestrators.json'), 'utf8')); } catch { /* 無ければ既定の 2 つだけ */ }
  if (entries && typeof entries === 'object') {
    for (const [name, e] of Object.entries(entries)) {
      if (!NAME_RE.test(name) || name === 'nekogamisama' || !e || typeof e !== 'object') continue;
      const description = String(e.description || '').slice(0, 300);
      if ((e.type || 'session') === 'agent') {
        if (typeof e.agent === 'string' && NAME_RE.test(e.agent)) targets.set(name, { name, label: name, type: 'agent', cwd: root, agent: e.agent, description });
      } else {
        const cwd = path.resolve(nekoDir, String(e.dir || ''));
        let ok = false;
        try { ok = inside(cwd) && fs.statSync(cwd).isDirectory(); } catch { /* 無いフォルダは出さない */ }
        if (ok) targets.set(name, { name, label: name, type: 'session', cwd, description });
      }
    }
  }
  // .claude/agents/ の定義ファイルも、それぞれ agent 型の相手にする（既にある名前は上書きしない）
  for (const d of allDefinitions(root)) {
    if (!targets.has(d.name)) targets.set(d.name, { name: d.name, label: d.name, type: 'agent', cwd: root, agent: d.name, description: d.description, fromDefinition: true });
  }
  return targets;
}

function allDefinitions(root) {
  const out = [];
  const walk = (dir, depth) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) { if (depth < 3) walk(full, depth + 1); continue; }
      if (!it.name.endsWith('.md')) continue;
      let fm = '';
      try { fm = fs.readFileSync(full, 'utf8').match(FM)?.[1] || ''; } catch { continue; }
      const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim();
      if (name && NAME_RE.test(name)) out.push({ name, description: (fm.match(/^description:\s*(.+)$/m)?.[1] || '').trim().slice(0, 300) });
    }
  };
  walk(path.join(root, '.claude', 'agents'), 0);
  return out;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---/;
function definitionsIn(projectDir, folder) {
  const dir = path.join(projectDir, '.claude', 'agents', folder);
  const out = [];
  try {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.md') || f.startsWith('.')) continue;
      const fm = fs.readFileSync(path.join(dir, f), 'utf8').match(FM)?.[1] || '';
      const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim();
      if (name && name !== folder) out.push({ name, model: fm.match(/^model:\s*(.+)$/m)?.[1].trim() || '' });
    }
  } catch { /* フォルダが無ければ配下なし */ }
  return out;
}

/** 相手の「チーム」: フロー図に待機状態で出す配下。猫神さまは委任先、ほかは .claude/agents/<相手の名前>/ の定義（agent 型は呼ぶエージェントのフォルダも） */
export function teamOf(projectDir, target, all) {
  if (target.name === 'nekogamisama') return [...all.values()].filter((t) => t.name !== 'nekogamisama' && !t.fromDefinition).map((t) => ({ name: t.name, model: '', role: t.type === 'agent' ? 'Agent' : '別セッション', agent: t.agent }));
  const seen = new Set();
  return [target.name, target.agent].filter(Boolean).flatMap((f) => definitionsIn(projectDir, f)).filter((d) => !seen.has(d.name) && seen.add(d.name));
}

/** ブラウザへ渡す形（パスは渡さない）。projectDir を渡すと、フロー図用のチームも付ける */
export const publicTargets = (targets, projectDir) => [...targets.values()].map(({ name, label, type, agent, description }) =>
  ({ name, label, type, agent, description, team: projectDir ? teamOf(projectDir, { name, agent }, targets) : undefined }));
