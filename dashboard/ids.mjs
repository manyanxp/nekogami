// ポータルの台帳（portal/data/registry.json）から、名前 → UUID を読む。Agent Console のフロー図に、担当する UUID を出すため。
import fs from 'node:fs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function cleanIds(d) {
  const out = {};
  for (const e of Array.isArray(d?.entities) ? d.entities : []) {
    if (e && typeof e.name === 'string' && NAME_RE.test(e.name) && typeof e.id === 'string' && UUID_RE.test(e.id)) out[e.name] = e.id.toLowerCase();
  }
  return out;
}

export function readIds(file) {
  try { return cleanIds(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return {}; }
}
