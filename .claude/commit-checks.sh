#!/usr/bin/env bash
# Commit gate for What's Next — run by the /commit skill before it drafts a plan (its "Project commit-checks"
# step) and safe to run by hand any time: `bash .claude/commit-checks.sh`. A non-zero exit blocks the commit, so
# the typecheck and unit tests stay green on every commit. Add slower checks (lint, build) here as the project grows.
set -euo pipefail

# Repo root = this script's dir (.claude/) parent, so the gate resolves the app regardless of the caller's cwd.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root/web"

echo "▸ typecheck (tsc --noEmit)"
npm run --silent typecheck

echo "▸ unit tests (vitest run)"
npm run --silent test

echo "✓ commit checks passed"
