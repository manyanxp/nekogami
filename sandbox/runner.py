"""Python の実行役（ADR 0038）。ジョブ置き場 /jobs を見張り、1 件ずつ実行して結果を書く。

ジョブ: /jobs/<id>/job.json（{"timeout": 秒}）、code.py、work/（作業用のコピー。コードの作業ディレクトリ）
結果:   /jobs/<id>/result.json（exit / stdout / stderr / timed_out）
このコンテナはネットワークなし・読み取り専用で動く。メモリ・時間・出力・プロセス数の上限はここでも掛ける。
"""
import json
import os
import resource
import signal
import subprocess
import sys
import time
from pathlib import Path

JOBS = Path(os.environ.get('JOBS_DIR', '/jobs'))
MAX_TIMEOUT = 30          # 秒（これより長い依頼は丸める）
MAX_OUTPUT = 100 * 1024   # バイト（標準出力・標準エラーそれぞれ）
MAX_MEMORY = 1024 * 1024 * 1024   # アドレス空間の上限。numpy / pandas は仮想メモリを多めに取る。実メモリの上限は compose の mem_limit
MAX_FILE = 10 * 1024 * 1024       # 1 ファイルの書き込み上限
MAX_PROCS = 64


def _limits():
    os.setsid()   # タイムアウトのときに、子プロセスごと止められるようにする
    resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY, MAX_MEMORY))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE, MAX_FILE))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCS, MAX_PROCS))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _clip(data: bytes) -> str:
    text = data[:MAX_OUTPUT].decode('utf-8', 'replace')
    return text + (f'\n…（{len(data)} バイトのうち先頭 {MAX_OUTPUT} バイトだけ）' if len(data) > MAX_OUTPUT else '')


def run_job(job: Path) -> dict:
    try:
        timeout = min(max(float(json.loads((job / 'job.json.running').read_text()).get('timeout', MAX_TIMEOUT)), 1), MAX_TIMEOUT)
    except (OSError, ValueError, TypeError):
        timeout = MAX_TIMEOUT
    work = job / 'work'
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(work), 'LANG': 'C.UTF-8', 'PYTHONIOENCODING': 'utf-8',
           'MPLBACKEND': 'Agg', 'MPLCONFIGDIR': '/tmp/mpl', 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1'}
    # -I: 作業ディレクトリや環境変数の PYTHON* から、コードや設定を拾わない
    proc = subprocess.Popen([sys.executable, '-I', '-B', str(job / 'code.py')], cwd=work, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=_limits)
    timed_out = False
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
    return {'exit': proc.returncode, 'timed_out': timed_out, 'stdout': _clip(out), 'stderr': _clip(err)}


def claim() -> Path | None:
    """ジョブの置かれた順に、1 件を取り出す。取り出したら job.json を job.json.running に改名する（二重実行しない）"""
    for job_json in sorted(JOBS.glob('*/job.json'), key=lambda p: p.stat().st_mtime):
        try:
            job_json.rename(job_json.with_name('job.json.running'))
            return job_json.parent
        except OSError:
            continue
    return None


def main():
    while True:
        job = claim()
        if not job:
            time.sleep(0.2)
            continue
        try:
            result = run_job(job)
        except Exception as e:   # 実行役自身の失敗も、結果として返す（呼んだ側を待たせない）
            result = {'exit': None, 'timed_out': False, 'stdout': '', 'stderr': f'実行役のエラー: {e}'}
        tmp = job / 'result.json.tmp'
        tmp.write_text(json.dumps(result, ensure_ascii=False))
        tmp.rename(job / 'result.json')


if __name__ == '__main__':
    main()
