"""Docker Compose による起動・停止・状態取得。台帳に登録された compose_file / service のみ操作できる。"""
import json
import subprocess
from pathlib import Path

from . import config


class DockerError(RuntimeError):
    pass


def _run(args, cwd, timeout):
    if not config.DOCKER_ENABLED:
        raise DockerError('Docker 操作は無効 (PORTAL_DOCKER=0)')
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise DockerError('docker コマンドが見つからない')
    except subprocess.TimeoutExpired:
        raise DockerError(f'タイムアウト ({timeout}s)')
    if r.returncode != 0:
        raise DockerError((r.stderr or r.stdout).strip()[-800:] or f'exit {r.returncode}')
    return r.stdout


def _base(rt, project_dir: Path):
    # 引数は配列で渡す（シェルを介さない）。値は registry で検証済み
    return ['docker', 'compose', '-f', str(project_dir / rt['compose_file'])]


def status(rt, project_dir: Path):
    """state: running | stopped | not_created | unknown(エラー時は detail)"""
    try:
        out = _run(_base(rt, project_dir) + ['ps', '-a', '--format', 'json', rt['service']], project_dir, 15)
    except DockerError as e:
        return {'state': 'unknown', 'detail': str(e)}
    rows = []
    for line in out.splitlines():
        line = line.strip()
        if line:
            parsed = json.loads(line)
            rows += parsed if isinstance(parsed, list) else [parsed]
    if not rows:
        return {'state': 'not_created'}
    st = rows[0].get('State', '')
    return {'state': 'running' if st == 'running' else 'stopped', 'detail': rows[0].get('Status', '')}


def start(rt, project_dir: Path):
    _run(_base(rt, project_dir) + ['up', '-d', rt['service']], project_dir, 300)


def stop(rt, project_dir: Path):
    _run(_base(rt, project_dir) + ['stop', rt['service']], project_dir, 120)
