#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 24 or newer is required and was not found on PATH." >&2
  exit 1
fi
exec node scripts/download-mvp-assets.ts "$@"
