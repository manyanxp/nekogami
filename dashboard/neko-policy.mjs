// 猫神さま本人（メインスレッド）が使える道具を、委任に限る（ADR 0048）。調べる・書く・Web を見るのは、担当に任せる。
// 配下の担当（agentID のある呼び出し）には適用しない。許すのは次だけ:
//   - Agent / Task … 担当（サブオーケストレーター）を呼ぶ
//   - Bash … bin/delegate.sh の形だけ（別セッション型を呼ぶ。形の検査は server.mjs の DELEGATE_CMD）
//   - Read … 委任先の一覧（nekogamisama/suborchestrators.json）だけ。これが読めないと、誰に任せるか分からない
import path from 'node:path';

export const NEKO_TARGET = 'nekogamisama';
const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'Bash']);

/** 猫神さま本人が toolName を使ってよいか。{ ok, reason } */
export function checkNekoTool({ toolName, input, nekoDir }) {
  if (DELEGATION_TOOLS.has(toolName)) return { ok: true };
  if (toolName === 'Read') {
    const p = path.resolve(nekoDir, String(input?.file_path || ''));
    if (p === path.join(path.resolve(nekoDir), 'suborchestrators.json')) return { ok: true };
    return { ok: false, reason: '猫神さまは自分でファイルを読まない。委任先の一覧（suborchestrators.json）以外は、担当に任せる' };
  }
  return { ok: false, reason: `猫神さまは自分で ${toolName} を使わない。担当（サブオーケストレーター）に任せる` };
}
