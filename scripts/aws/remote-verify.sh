#!/usr/bin/env bash
set -euo pipefail

EXPECTED_WORKTREE="/home/ssm-user/SEA-N-SHORE-CODEX/.worktrees/aws-native-phase-0-1"
CURRENT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

[[ "$CURRENT_ROOT" == "$EXPECTED_WORKTREE" ]] || {
  echo "Remote verification must run from the AWS migration worktree." >&2
  exit 1
}

export PATH="$HOME/bin:$PATH"

command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required." >&2; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "Terraform is required." >&2; exit 1; }

if [[ ! -x ./node_modules/.bin/vitest ]] || [[ ! -d ./node_modules/pg ]]; then
  echo "=== DEPENDENCY SYNC ==="
  npx -y npm@11.6.0 install \
    --include=dev \
    --no-audit \
    --no-fund \
    --package-lock=false
fi

[[ -x ./node_modules/.bin/vitest ]] || {
  echo "Vitest is unavailable after dependency sync." >&2
  exit 1
}

[[ -d ./node_modules/pg ]] || {
  echo "PostgreSQL driver is unavailable after dependency sync." >&2
  exit 1
}

echo "=== REMOTE COMMIT ==="
git rev-parse --verify HEAD

echo
echo "=== SHELL SYNTAX ==="
for script in scripts/aws/*.sh; do
  bash -n "$script"
done

echo
echo "=== TERRAFORM FORMAT ==="
terraform fmt -check -recursive infra/aws

for directory in infra/aws/bootstrap infra/aws/app; do
  echo
  echo "=== TERRAFORM VALIDATE: $directory ==="
  terraform -chdir="$directory" init -backend=false -input=false >/dev/null
  terraform -chdir="$directory" validate
done

echo
echo "=== REMOTE EXECUTION CONTRACT ==="
node --test scripts/aws/remote-execution-config.test.mjs

echo
echo "=== LINT ==="
npm run lint

echo
echo "=== TYPECHECK ==="
npm run typecheck

echo
echo "=== FULL TEST SUITE ==="
./node_modules/.bin/vitest run

echo
echo "AWS REMOTE VERIFICATION PASSED"
