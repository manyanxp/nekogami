// Python の実行（ADR 0038）: ディレクトリのノードの中身を作業用にコピーして渡し、実行役（py-sandbox）の結果を、ノードの権限の範囲だけ元へ戻す。
// 実行役はネットワークなしの別コンテナで、見えるのはジョブ置き場だけ。ノードの外のファイルは、渡さないので見えない。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = {
  timeoutSec: 30, codeBytes: 100 * 1024,
  inFiles: 500, inFileBytes: 2 * 1024 * 1024, inTotalBytes: 20 * 1024 * 1024,   // ノード → 作業用コピー
  outFiles: 200, outFileBytes: 5 * 1024 * 1024,                                  // 作業用コピー → ノード
  waitSec: 150,                                                                    // 実行役の順番待ちを含む
};

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** dir の下の通常ファイルを、相対パス（/ 区切り）で返す。シンボリックリンクは無視し、数を returned.links に入れる */
function walk(dir, limit) {
  const files = [];
  let links = 0;
  const rec = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) links++;
      else if (e.isDirectory()) rec(p, r);
      else if (e.isFile()) { if (files.length >= limit) throw new Error(`ファイルが多すぎる（${limit} 個まで）`); files.push(r); }
    }
  };
  rec(dir, '');
  return { files, links };
}

/** ノードの中身を work/ にコピーして、{相対パス: ハッシュ} を返す。読み込みの権限がなければ空のまま */
function stageIn(box, work) {
  if (!box.node.perms.read) return {};
  const base = box.realBase();
  const { files } = walk(base, LIMITS.inFiles);
  const manifest = {};
  let total = 0;
  for (const rel of files) {
    const src = path.join(base, ...rel.split('/'));
    const size = fs.statSync(src).size;
    if (size > LIMITS.inFileBytes) continue;   // 大きすぎるファイルは渡さない（変更扱いにもしない）
    total += size;
    if (total > LIMITS.inTotalBytes) throw new Error(`渡すファイルの合計が大きすぎる（${LIMITS.inTotalBytes / 1024 / 1024} MB まで）。ノードの path を絞ってほしい`);
    const dst = path.join(work, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o777 });
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o666);
    manifest[rel] = sha(src);
  }
  return manifest;
}

/** 実行後の work/ を、ノードへ戻す。書き込み・削除の権限があるものだけ戻し、戻さなかったものは理由つきで返す */
function stageOut(box, work, manifest) {
  const { perms } = box.node;
  const { files, links } = walk(work, LIMITS.outFiles * 4);
  const done = { created: [], updated: [], deleted: [] }, skipped = [];
  let applied = 0;
  for (const rel of files) {
    const file = path.join(work, ...rel.split('/'));
    const isNew = !(rel in manifest);
    if (!isNew && sha(file) === manifest[rel]) continue;   // 変わっていない
    if (!perms.write) { skipped.push(`${rel}（書き込みの権限がない）`); continue; }
    if (fs.statSync(file).size > LIMITS.outFileBytes) { skipped.push(`${rel}（${LIMITS.outFileBytes / 1024 / 1024} MB を超える）`); continue; }
    if (++applied > LIMITS.outFiles) { skipped.push(`${rel}（戻すファイルが多すぎる）`); continue; }
    try { box.writeBytes(rel, fs.readFileSync(file)); (isNew ? done.created : done.updated).push(rel); }
    catch (e) { skipped.push(`${rel}（${e.message}）`); }
  }
  const present = new Set(files);
  for (const rel of Object.keys(manifest)) {
    if (present.has(rel)) continue;
    if (!perms.delete) { skipped.push(`${rel} の削除（削除の権限がない）`); continue; }
    try { box.delete(rel); done.deleted.push(rel); } catch (e) { skipped.push(`${rel} の削除（${e.message}）`); }
  }
  if (links) skipped.push(`シンボリックリンク ${links} 個（無視）`);
  return { done, skipped };
}

const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 残ったら、次の実行のときに掃除する */ } };
const sweep = (dir) => {   // 10 分より古いジョブは、呼んだ側が消えたものとして片付ける
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    try { if (n !== '.gitkeep' && Date.now() - fs.statSync(p).mtimeMs > 10 * 60 * 1000) rm(p); } catch { /* 無視 */ }
  }
};

const list = (title, a) => (a.length ? `${title}: ${a.join(', ')}\n` : '');

/** code を、ノード box の中身を使って実行する。jobsDir は、実行役と共有するジョブ置き場 */
export async function runPython({ box, code, jobsDir, timeoutSec = LIMITS.timeoutSec }) {
  box.need('run');
  if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > LIMITS.codeBytes) throw new Error(`code は文字列で、${LIMITS.codeBytes / 1024} KB まで`);
  fs.mkdirSync(jobsDir, { recursive: true });
  sweep(jobsDir);
  const id = crypto.randomUUID();
  const job = path.join(jobsDir, id), work = path.join(job, 'work');
  fs.mkdirSync(work, { recursive: true, mode: 0o777 });
  fs.chmodSync(job, 0o777); fs.chmodSync(work, 0o777);
  try {
    const manifest = stageIn(box, work);
    fs.writeFileSync(path.join(job, 'code.py'), code);
    fs.writeFileSync(path.join(job, 'job.json.tmp'), JSON.stringify({ timeout: Math.min(timeoutSec, LIMITS.timeoutSec) }));
    fs.renameSync(path.join(job, 'job.json.tmp'), path.join(job, 'job.json'));   // 最後に置く（実行役はこれを合図に取り出す）
    const resultFile = path.join(job, 'result.json');
    const deadline = Date.now() + LIMITS.waitSec * 1000;
    while (!fs.existsSync(resultFile)) {
      if (Date.now() > deadline) throw new Error('実行役（py-sandbox）が応答しない。`docker compose ps` で動いているか確認してほしい');
      await new Promise((r) => setTimeout(r, 150));
    }
    const r = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const { done, skipped } = stageOut(box, work, manifest);
    const head = r.timed_out ? `時間切れ（${LIMITS.timeoutSec} 秒）で止めた` : `終了コード: ${r.exit}`;
    return [head, r.stdout && `--- 標準出力 ---\n${r.stdout}`, r.stderr && `--- 標準エラー ---\n${r.stderr}`,
      `--- ファイルの反映（${box.node.path}）---\n` + (list('新規', done.created) + list('更新', done.updated) + list('削除', done.deleted) + list('戻さなかった', skipped) || '変更なし')]
      .filter(Boolean).join('\n');
  } finally {
    rm(job);
  }
}
