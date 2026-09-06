#!/usr/bin/env bash
set -euo pipefail

ALL_MATCHES="$(
  git grep -nE '@/lib/supabase|@supabase/|createServerSupabaseClient|createBrowserSupabaseClient|supabase\.from\(|supabase\.rpc\(|auth\.uid' -- src \
    | grep -E '\.(ts|tsx):' \
    | grep -v '^src/lib/supabase/' \
    | grep -vE '\.test\.(ts|tsx):' \
    || true
)"

# Protected application flows no longer depend on Supabase DB/RLS/RPC/session
# behavior or Supabase Storage. One explicit legacy boundary remains by design:
# - auth/callback: legacy public Supabase OAuth callback, not used by the current
#   Cognito password sign-in flow; replace/remove when Cognito Google federation lands.
UNCLASSIFIED_MATCHES="$(
  printf '%s\n' "$ALL_MATCHES" \
    | grep -vE '^(src/app/auth/callback/route\.ts):' \
    || true
)"

if [[ -n "$UNCLASSIFIED_MATCHES" ]]; then
  echo "Unclassified Supabase runtime dependency detected:" >&2
  printf '%s\n' "$UNCLASSIFIED_MATCHES" >&2
  exit 1
fi

echo "PHASE 5A SUPABASE PROTECTED-RUNTIME AUDIT PASSED"

if grep -q '^src/app/auth/callback/route\.ts:' <<<"$ALL_MATCHES"; then
  echo "CLASSIFIED: src/app/auth/callback/route.ts -> Cognito Google federation / later cleanup"
fi

echo "Retained src/lib/supabase/* and Supabase package/tooling dependencies remain quarantined for final removal after auth callback cleanup."
