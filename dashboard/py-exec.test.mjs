import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DirBox } from './fs-tools.mjs';
import { runPython } from './py-exec.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const node = (perms) => ({ name: 'data', path: 'data', description: '', perms: { list: false, read: false, write: false, delete: false, exec: false, ...perms } });

/** 実行役の代わり: ジョブを 1 件取り出し、work/ に対して fn を実行して、結果を書く */
function fakeRunner(jobsDir, fn, result = {}) {
  const seen = [];
  const t = setInterval(() => {
    for (const n of fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir) : []) {
      const jf = path.join(jobsDir, n, 'job.json');
      if (!fs.existsSync(jf)) continue;
      fs.renameSync(jf, `${jf}.running`);
      const work = path.join(jobsDir, n, 'work');
      seen.push({ code: fs.readFileSync(path.join(jobsDir, n, 'code.py'), 'utf8'), files: fs.readdirSync(work, { recursive: true }).sort() });
      fn(work);
      fs.writeFileSync(path.join(jobsDir, n, 'result.json'), JSON.stringify({ exit: 0, timed_out: false, stdout: 'out', stderr: '', ...result }));
    }
  }, 20);
  return { seen, stop: () => clearInterval(t) };
}
const setup = (perms, files = {}) => {
  const root = tmp('px-root-'), jobs = tmp('px-jobs-');
  const box = new DirBox(root, node(perms));
  for (const [k, v] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, 'data', k)), { recursive: true }); fs.writeFileSync(path.join(root, 'data', k), v); }
  return { root, jobs, box, real: (k) => path.join(root, 'data', k) };
};

test('Python 実行の権限がなければ実行しない（ジョブも作らない）', async () => {
  const { box, jobs } = setup({ read: true, write: true });
  await assert.rejects(runPython({ box, code: 'print(1)', jobsDir: jobs }), /Python 実行/);
  assert.deepEqual(fs.readdirSync(jobs), []);
});

test('読み込みの権限がなければ、中身を渡さない。書き込みがあれば、作ったファイルは戻る', async () => {
  const { box, jobs, real } = setup({ exec: true, write: true }, { 'secret.csv': 'a,b' });
  const r = fakeRunner(jobs, (w) => fs.writeFileSync(path.join(w, 'out.txt'), 'hi'));
  const text = await runPython({ box, code: 'x', jobsDir: jobs });
  r.stop();
  assert.deepEqual(r.seen[0].files, []);                               // secret.csv は渡していない
  assert.equal(fs.readFileSync(real('out.txt'), 'utf8'), 'hi');
  assert.match(text, /新規: out\.txt/);
  assert.match(text, /--- 標準出力 ---\nout/);
  assert.deepEqual(fs.readdirSync(jobs), []);                          // ジョブは片付く
});

test('書き込みの権限がなければ、変更は戻らない。削除も同じ', async () => {
  const { box, jobs, real } = setup({ exec: true, read: true }, { 'a.csv': 'old', 'b.csv': 'keep' });
  const r = fakeRunner(jobs, (w) => { fs.writeFileSync(path.join(w, 'a.csv'), 'new'); fs.writeFileSync(path.join(w, 'n.txt'), 'x'); fs.unlinkSync(path.join(w, 'b.csv')); });
  const text = await runPython({ box, code: 'x', jobsDir: jobs });
  r.stop();
  assert.deepEqual(r.seen[0].files, ['a.csv', 'b.csv']);              // 読み込みの権限があるので渡す
  assert.equal(fs.readFileSync(real('a.csv'), 'utf8'), 'old');
  assert.equal(fs.existsSync(real('n.txt')), false);
  assert.equal(fs.existsSync(real('b.csv')), true);
  assert.match(text, /a\.csv（書き込みの権限がない）/);
  assert.match(text, /b\.csv の削除（削除の権限がない）/);
});

test('書き込み・削除の権限があれば、更新と削除が戻る。変えていないファイルは触らない', async () => {
  const { box, jobs, real } = setup({ exec: true, read: true, write: true, delete: true }, { 'a.csv': 'old', 'b.csv': 'gone', 'c.csv': 'same' });
  const before = fs.statSync(real('c.csv')).mtimeMs;
  const r = fakeRunner(jobs, (w) => { fs.writeFileSync(path.join(w, 'a.csv'), 'new'); fs.unlinkSync(path.join(w, 'b.csv')); fs.mkdirSync(path.join(w, 'sub')); fs.writeFileSync(path.join(w, 'sub', 'x.bin'), Buffer.from([0, 255, 1])); });
  const text = await runPython({ box, code: 'x', jobsDir: jobs });
  r.stop();
  assert.equal(fs.readFileSync(real('a.csv'), 'utf8'), 'new');
  assert.equal(fs.existsSync(real('b.csv')), false);
  assert.equal(fs.statSync(real('c.csv')).mtimeMs, before);
  assert.deepEqual([...fs.readFileSync(real('sub/x.bin'))], [0, 255, 1]);   // バイナリ（画像など）も戻る
  assert.match(text, /更新: a\.csv/); assert.match(text, /削除: b\.csv/);
});

test('シンボリックリンクは渡さず、戻しもしない', async () => {
  const { box, jobs, root } = setup({ exec: true, read: true, write: true }, { 'a.txt': 'a' });
  const outside = tmp('px-out-'); fs.writeFileSync(path.join(outside, 's.txt'), 'SECRET');
  fs.symlinkSync(path.join(outside, 's.txt'), path.join(root, 'data', 'link.txt'));
  const r = fakeRunner(jobs, (w) => fs.symlinkSync('/etc/passwd', path.join(w, 'evil')));
  const text = await runPython({ box, code: 'x', jobsDir: jobs });
  r.stop();
  assert.deepEqual(r.seen[0].files, ['a.txt']);
  assert.equal(fs.existsSync(path.join(root, 'data', 'evil')), false);
  assert.match(text, /シンボリックリンク 1 個/);
});

test('時間切れ・エラー終了も、結果として返す。コードが大きすぎれば拒否', async () => {
  const { box, jobs } = setup({ exec: true });
  const r = fakeRunner(jobs, () => {}, { exit: -9, timed_out: true, stdout: '', stderr: 'boom' });
  const text = await runPython({ box, code: 'while True: pass', jobsDir: jobs });
  r.stop();
  assert.match(text, /時間切れ/); assert.match(text, /boom/);
  await assert.rejects(runPython({ box, code: 'x'.repeat(100 * 1024 + 1), jobsDir: jobs }), /KB まで/);
  await assert.rejects(runPython({ box, code: '  ', jobsDir: jobs }), /KB まで/);
});
