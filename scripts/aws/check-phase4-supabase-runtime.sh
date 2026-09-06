#!/usr/bin/env bash
set -euo pipefail

ALL_MATCHES="$(
  git grep -nE '@/lib/supabase|@supabase/|createServerSupabaseClient|createBrowserSupabaseClient|supabase\.from\(|supabase\.rpc\(|auth\.uid' -- src \
    | grep -E '\.(ts|tsx):' \
    | grep -v '^src/lib/supabase/' \
    | grep -vE '\.test\.(ts|tsx):' \
    || true
)"

# Phase 4 removes Supabase DB/RLS/RPC/session behavior from protected application
# flows. Two explicit boundaries remain by design for later migration phases:
# - auth/callback: legacy public Supabase OAuth callback, not used by the current
#   Cognito password sign-in flow; replace/remove when Cognito Google federation lands.
# - feed/media: Supabase Storage adapter retained only until the Phase 5 S3 cutover.
UNCLASSIFIED_MATCHES="$(
  printf '%s\n' "$ALL_MATCHES" \
    | grep -vE '^(src/app/auth/callback/route\.ts|src/features/feed/media\.ts):' \
    || true
)"

if [[ -n "$UNCLASSIFIED_MATCHES" ]]; then
  echo "Unclassified Supabase runtime dependency detected:" >&2
  printf '%s\n' "$UNCLASSIFIED_MATCHES" >&2
  exit 1
fi

echo "PHASE 4 SUPABASE PROTECTED-RUNTIME AUDIT PASSED"

if grep -q '^src/app/auth/callback/route\.ts:' <<<"$ALL_MATCHES"; then
  echo "CLASSIFIED: src/app/auth/callback/route.ts -> Cognito Google federation / later cleanup"
fi

if grep -q '^src/features/feed/media\.ts:' <<<"$ALL_MATCHES"; then
  echo "CLASSIFIED: src/features/feed/media.ts -> Phase 5 S3 storage cutover"
fi

echo "Retained src/lib/supabase/* and Supabase package/tooling dependencies remain quarantined for final removal after cutover."
