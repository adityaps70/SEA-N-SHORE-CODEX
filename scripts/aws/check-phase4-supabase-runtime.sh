#!/usr/bin/env bash
set -euo pipefail

ALL_MATCHES="$(
  git grep -nE '@/lib/supabase|@supabase/|createServerSupabaseClient|createBrowserSupabaseClient|supabase\.from\(|supabase\.rpc\(|auth\.uid' -- src \
    | grep -E '\.(ts|tsx):' \
    | grep -v '^src/lib/supabase/' \
    | grep -vE '\.test\.(ts|tsx):' \
    || true
)"

if [[ -n "$ALL_MATCHES" ]]; then
  echo "Supabase application runtime dependency detected:" >&2
  printf '%s\n' "$ALL_MATCHES" >&2
  exit 1
fi

echo "PHASE 5 AUTH RUNTIME AUDIT PASSED"
echo "No application runtime flow depends on Supabase auth, DB/RLS/RPC/session behavior, or Supabase Storage."
echo "Retained src/lib/supabase/* and Supabase package/tooling dependencies are non-runtime cleanup targets only."
