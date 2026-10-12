#!/usr/bin/env bash
# 在本机 WSL/Linux 的完整仓库中运行；服务器不执行此脚本。
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname -s)" = Linux ] || { echo 'Use local WSL/Linux to build native Linux dependencies.'; exit 1; }
export NEXT_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile
pnpm lint
pnpm test:unit
pnpm build
destination="${1:-../pchospital-api-linux.tar.gz}"
tar --exclude='.next/cache' --exclude='data/knowledge/index' \
  -czf "$destination" .next node_modules public src prisma tools data/knowledge \
  package.json pnpm-lock.yaml tsconfig.json next.config.ts prisma.config.ts
sha256sum "$destination"
