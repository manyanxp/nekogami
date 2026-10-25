#!/usr/bin/env bash
# 猫神さま Portal を起動する: FastAPI（:4401）と Next.js（:4400）。ブラウザで開くのは http://127.0.0.1:4400
#   scripts/portal.sh            初回は依存を入れてビルドし、本番モードで起動
#   scripts/portal.sh dev        Next.js を開発モード（ホットリロード）で起動
#   scripts/portal.sh setup      依存の導入だけ行う
#   scripts/portal.sh lan        画面を 0.0.0.0 で公開する（WSL2 の Mirrored 構成などで、Mac など別 PC のブラウザから開く）
#                                開く先は http://<この PC の IP>:4400。認証はないので、信頼できる LAN だけで使うこと
#   PORTAL_ALLOWED_HOSTS=名前,IP ...  lan モードで許可する Host / Origin を追加（既定は hostname -I と hostname）
# 必要: Python 3.10+、Node.js 20.9+（Agent Console は別途 docker compose か `npm start`）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-start}"
if [ "$MODE" = "lan" ]; then
  MODE="start"
  export PORTAL_BIND="0.0.0.0"
  # API は 127.0.0.1 のまま（画面が中継する）。ただしブラウザの Origin はそのまま届くので、公開ホスト名を許可する
  if [ -z "${PORTAL_ALLOWED_HOSTS:-}" ]; then
    PORTAL_ALLOWED_HOSTS="$(hostname -I 2>/dev/null | tr ' ' ',' | sed 's/,*$//'),$(hostname)"
  fi
  export PORTAL_ALLOWED_HOSTS
fi
export PORTAL_BIND="${PORTAL_BIND:-127.0.0.1}"
API_PORT="${PORTAL_PORT:-4401}"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 が見つかりません（$2）" >&2; exit 1; }; }
need python3 "Python 3.10 以上を入れてください"
need node "Node.js 20.9 以上を入れてください"
need npm "Node.js に同梱されます"

PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "[setup] Python の仮想環境を作ります (.venv)"
  python3 -m venv .venv
fi
if ! "$PY" -c "import fastapi, uvicorn, httpx" 2>/dev/null; then
  echo "[setup] FastAPI などを入れます"
  "$PY" -m pip install --quiet -r portal/backend/requirements.txt
fi
if [ ! -d web/node_modules ]; then
  echo "[setup] Next.js の依存を入れます (web/)"
  (cd web && npm ci --no-audit --no-fund)
fi
[ "$MODE" = "setup" ] && { echo "[setup] 完了"; exit 0; }

if [ "$MODE" != "dev" ] && [ ! -d web/.next ]; then
  echo "[build] Next.js をビルドします"
  (cd web && npm run build)
fi

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

(cd portal/backend && PORTAL_PORT="$API_PORT" exec "$PY" -m portal_api) &
pids+=($!)
if [ "$MODE" = "dev" ]; then (cd web && exec npm run dev) & else (cd web && exec npm run start) & fi
pids+=($!)
echo "猫神さま Portal: http://127.0.0.1:4400   （API: http://127.0.0.1:${API_PORT}）"
if [ "$PORTAL_BIND" != "127.0.0.1" ]; then
  echo "LAN 公開中（${PORTAL_BIND}:4400）。他の PC からは http://$(hostname -I | awk '{print $1}'):4400 を開く"
fi
wait -n
