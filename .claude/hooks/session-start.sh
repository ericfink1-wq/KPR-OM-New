#!/bin/bash
set -euo pipefail

# Claude Code on the web — install workspace deps so typecheck + vitest tests work
# from the first turn. Local sessions already have their environment, so skip there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install all pnpm workspace dependencies (install, not ci, so the cached container
# reuses the store). Idempotent and non-interactive.
pnpm install

# Build the shared TS project references the web app + API server typecheck against
# (TS6305 build-order noise is expected; never fail the hook on it).
npx tsc -b lib/api-zod lib/api-client-react lib/db || true
