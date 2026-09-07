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

PUBLIC_ENV_MATCHES="$(
  git grep -n 'NEXT_PUBLIC_SUPABASE_' -- src Dockerfile .github/workflows \
    || true
)"

if [[ -n "$PUBLIC_ENV_MATCHES" ]]; then
  echo "Legacy NEXT_PUBLIC_SUPABASE build/runtime wiring detected:" >&2
  printf '%s\n' "$PUBLIC_ENV_MATCHES" >&2
  exit 1
fi

echo "PHASE 5 SUPABASE APPLICATION CLEANUP AUDIT PASSED"
echo "No application runtime flow, helper module, or build/workflow configuration depends on Supabase."
echo "Supabase CLI/tooling dependencies may remain temporarily for the final migration delta/orphan audit."
