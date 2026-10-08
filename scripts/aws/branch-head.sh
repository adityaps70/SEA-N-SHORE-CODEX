#!/usr/bin/env bash
# Bootstrap host: prints "<sha><TAB>refs/heads/feat/aws-native-phase-0-1", like `git ls-remote origin <ref>`.
# The repository is private and the host holds no GitHub credentials, so the GitHub runner that dispatched this SSM
# command publishes the live branch head (git ls-remote with the job's token, every 5 s; scripts/aws/ci-checkout.sh
# serve-head) to the private migration bucket. Only a copy written in the last 20 seconds is accepted; anything else
# prints nothing and fails, so every moved-branch check that compares against it refuses.
set -euo pipefail
umask 077

BUCKET="sea-n-shore-staging-310356785722-migration"
REF="refs/heads/feat/aws-native-phase-0-1"
MAX_AGE_SECONDS=20
# Tests may lower the number of 2-second attempts (never raise it).
ATTEMPTS="${SEA_N_SHORE_BRANCH_HEAD_ATTEMPTS:-30}"
[[ "$ATTEMPTS" =~ ^[0-9]+$ ]] && (( ATTEMPTS >= 1 && ATTEMPTS <= 30 )) || ATTEMPTS=30

[[ "${1:-}" == "$REF" ]] || { echo "branch-head: only $REF is supported." >&2; exit 1; }
KEY="${SEA_N_SHORE_CHECKOUT_HEAD_KEY:-}"
[[ "$KEY" =~ ^ci-checkouts/[0-9]+-[0-9]+-[A-Za-z0-9_-]+-[0-9]+-[0-9a-f]{40}\.head$ ]] || {
  echo "branch-head: no branch-head key from the runner (SEA_N_SHORE_CHECKOUT_HEAD_KEY)." >&2
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

for _ in $(seq 1 "$ATTEMPTS"); do
  if aws s3api get-object --region ap-south-1 --bucket "$BUCKET" --key "$KEY" "$TMP/head" > "$TMP/object.json" 2>/dev/null; then
    WRITTEN="$(date -u -d "$(jq -r '.LastModified' "$TMP/object.json")" +%s 2>/dev/null || echo 0)"
    AGE=$(( $(date -u +%s) - WRITTEN ))
    if (( AGE >= -5 && AGE <= MAX_AGE_SECONDS )) && grep -qxE "[0-9a-f]{40}"$'\t'"${REF}" "$TMP/head"; then
      cat "$TMP/head"
      exit 0
    fi
  fi
  sleep 2
done
echo "branch-head: no fresh branch head from the runner." >&2
exit 1
