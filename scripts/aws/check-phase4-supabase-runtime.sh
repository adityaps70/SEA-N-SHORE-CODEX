#!/usr/bin/env bash
set -euo pipefail

RUNTIME_MATCHES="$(
  git grep -nE '@/lib/supabase|@supabase/|createServerSupabaseClient|createBrowserSupabaseClient|supabase\.from\(|supabase\.rpc\(|auth\.uid' -- src \
    | grep -E '\.(ts|tsx):' \
    | grep -vE '\.test\.(ts|tsx):' \
    || true
)"

if [[ -n "$RUNTIME_MATCHES" ]]; then
  echo "Supabase application runtime dependency detected:" >&2
  printf '%s\n' "$RUNTIME_MATCHES" >&2
  exit 1
fi

if [[ -d src/lib/supabase ]]; then
  echo "Legacy src/lib/supabase helpers still exist." >&2
  find src/lib/supabase -maxdepth 1 -type f -print >&2
  exit 1
fi

PACKAGE_MATCHES="$(
  grep -nE '"@supabase/(ssr|supabase-js)"|"supabase"[[:space:]]*:' package.json \
    || true
)"

if [[ -n "$PACKAGE_MATCHES" ]]; then
  echo "Supabase application/tooling package dependency detected:" >&2
  printf '%s\n' "$PACKAGE_MATCHES" >&2
  exit 1
fi

PUBLIC_ENV_MATCHES="$(
  git grep -n 'NEXT_PUBLIC_SUPABASE_' -- src Dockerfile .github/workflows \
    | grep -v '^.github/workflows/aws-remote-verify.yml:' \
    || true
)"

if [[ -n "$PUBLIC_ENV_MATCHES" ]]; then
  echo "Legacy NEXT_PUBLIC_SUPABASE build/runtime wiring detected:" >&2
  printf '%s\n' "$PUBLIC_ENV_MATCHES" >&2
  exit 1
fi

TERRAFORM_APP_MATCHES="$(
  git grep -nE 'supabase_url|supabase_publishable_key|NEXT_PUBLIC_SUPABASE_' -- infra/aws/app \
    || true
)"

if [[ -n "$TERRAFORM_APP_MATCHES" ]]; then
  echo "Legacy Supabase application Terraform wiring detected:" >&2
  printf '%s\n' "$TERRAFORM_APP_MATCHES" >&2
  exit 1
fi

VERCEL_RUNTIME_MATCHES="$(
  git grep -nEi '(@vercel/|VERCEL_URL|VERCEL_ENV|vercel\.json|\.vercel/)' -- src Dockerfile infra/aws .github/workflows package.json next.config.ts \
    | grep -v '^.github/workflows/aws-remote-verify.yml:' \
    || true
)"

if [[ -n "$VERCEL_RUNTIME_MATCHES" ]]; then
  echo "Vercel-specific application/build/runtime dependency detected:" >&2
  printf '%s\n' "$VERCEL_RUNTIME_MATCHES" >&2
  exit 1
fi

echo "AWS APPLICATION INDEPENDENCE AUDIT PASSED"
echo "No application runtime flow, helper module, package dependency, public env wiring, app Terraform definition, or Vercel-specific build/runtime dependency is active in the AWS branch."
echo "Legacy Supabase schema/tests and migration scripts may remain temporarily as source evidence for final delta/orphan reconciliation."
