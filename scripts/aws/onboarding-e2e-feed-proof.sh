#!/usr/bin/env bash
# Round 14: the Home feed avatar proof (feed-avatar-staging-e2e.mjs) posts as this run's disposable
# E2E users. Its own UI cleanup can miss a post when a run fails part-way, so this removes, by exact
# body and exact author, only the proof posts of this run and of the stale runs listed in
# scripts/aws/onboarding-e2e-stale-feed-proof-runs.txt, and proves they are gone. Reposts of a proof
# post go with it (posts.repost_of_post_id cascades).
set -euo pipefail
umask 077
export AWS_PAGER=""
EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
STALE_RUNS_FILE="scripts/aws/onboarding-e2e-stale-feed-proof-runs.txt"
[[ "${ONBOARDING_E2E_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ONBOARDING_E2E_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ONBOARDING_E2E_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
[[ "${E2E_RUN_ID:-}" =~ ^[0-9]+$ ]] || { echo "E2E_RUN_ID must be the numeric workflow run id." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ -n "$SECRET_ARN" ]]
sql() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" --sql "$1" --output json
}

RUNS=("$E2E_RUN_ID")
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(tr -d '[:space:]' <<<"$line")"
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[0-9]+$ ]] || { echo "Stale feed proof run ids must be numeric." >&2; exit 1; }
  RUNS+=("$line")
done < "$STALE_RUNS_FILE"

for run in "${RUNS[@]}"; do
  # The feed proof's three users (author, reposter, fallback) and its two exact post bodies.
  AUTHORS="'sea-n-shore-e2e-${run}-seafarer@example.com','sea-n-shore-e2e-${run}-shore@example.com','sea-n-shore-e2e-${run}-enthusiast@example.com'"
  BODIES="'Feed avatar hydration staging proof ${run}','Feed avatar fallback staging proof ${run}'"
  PROOF_SQL="SELECT p.id FROM public.posts p JOIN public.identity_accounts ia ON ia.profile_id = p.author_id WHERE ia.provider = 'cognito' AND ia.email IN (${AUTHORS}) AND p.body IN (${BODIES})"
  FOUND="$(sql "SELECT count(*)::text FROM (${PROOF_SQL}) t" | jq -r '.records[0][0].stringValue')"
  [[ "$FOUND" =~ ^[0-9]+$ && "$FOUND" -le 2 ]] || { echo "Expected at most two feed proof posts for run ${run}, found ${FOUND}; refusing." >&2; exit 1; }
  if [[ "$FOUND" != "0" ]]; then
    sql "DELETE FROM public.posts WHERE id IN (${PROOF_SQL})" >/dev/null
  fi
  REMAINING="$(sql "SELECT count(*)::text FROM (${PROOF_SQL}) t" | jq -r '.records[0][0].stringValue')"
  [[ "$REMAINING" == "0" ]] || { echo "Feed proof posts of run ${run} are still present." >&2; exit 1; }
  echo "ONBOARDING_E2E_FEED_PROOF_REMOVED run=${run} posts=${FOUND}"
done
echo "ONBOARDING_E2E_FEED_PROOF_CLEANUP_VERIFIED=true"
