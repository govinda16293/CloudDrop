#!/usr/bin/env bash
# Run CloudDrop on this computer: mock AWS + API on :8787, the site on :5173.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/python ] || [ ! -d frontend/node_modules ]; then
  echo "Run 'make setup' first." >&2
  exit 1
fi

.venv/bin/python -m local.server --seed &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM

npm --prefix frontend run dev
