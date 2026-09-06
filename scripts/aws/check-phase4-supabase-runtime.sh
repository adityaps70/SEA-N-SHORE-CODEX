#!/usr/bin/env bash
set -euo pipefail

MATCHES="$(
  git grep -nE '@/lib/supabase|@supabase/|createServerSupabaseClient|createBrowserSupabaseClient|supabase\.from\(|supabase\.rpc\(|auth\.uid' -- src \
    | grep -E '\.(ts|tsx):' \
    | grep -v '^src/lib/supabase/' \
    | grep -vE '\.test\.(ts|tsx):' \
    || true
)"

if [[ -n "$MATCHES" ]]; then
  echo "Supabase runtime dependency detected outside retained rollback helpers:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi

echo "PHASE 4 SUPABASE RUNTIME AUDIT PASSED"
echo "Retained src/lib/supabase/* and Supabase package/tooling dependencies are classified for later removal after final cutover."
