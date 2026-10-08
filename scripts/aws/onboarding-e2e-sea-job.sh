#!/usr/bin/env bash
# Round 14: a temporary sea job for the onboarding E2E's last step (a Maritime Enthusiast is refused
# on a sea job with a minimum match). "create" publishes one job owned by this run's E2E recruiter;
# "cleanup" closes and deletes only that one job (this run's title and recruiter), with its
# applications, and proves it is gone.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MODE="${1:-}"

case "$MODE" in create|cleanup) ;; *) echo "Usage: onboarding-e2e-sea-job.sh create|cleanup" >&2; exit 1 ;; esac
[[ "${ONBOARDING_E2E_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ONBOARDING_E2E_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ONBOARDING_E2E_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
[[ "${E2E_RUN_ID:-}" =~ ^[0-9]+$ ]] || { echo "E2E_RUN_ID must be the numeric workflow run id." >&2; exit 1; }
[[ "${E2E_RECRUITER_EMAIL:-}" =~ ^sea-n-shore-e2e-${E2E_RUN_ID}-recruiter@example\.com$ ]] || {
  echo "Unsafe or missing disposable E2E recruiter email." >&2
  exit 1
}
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ -n "$SECRET_ARN" ]]

JOB_TITLE="E2E temporary sea job ${E2E_RUN_ID}"
# The one temporary job of this run: this exact title, owned by this run's E2E recruiter.
RUN_JOB_SQL="SELECT j.id FROM public.jobs j JOIN public.identity_accounts ia ON ia.profile_id = j.created_by_user_id WHERE ia.provider = 'cognito' AND ia.email = '${E2E_RECRUITER_EMAIL}' AND j.title = '${JOB_TITLE}'"

sql() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" --sql "$1" --output json
}

if [[ "$MODE" == "create" ]]; then
  RECRUITER_ID="$(sql "SELECT p.id::text FROM public.identity_accounts ia JOIN public.profiles p ON p.id = ia.profile_id WHERE ia.provider = 'cognito' AND ia.email = '${E2E_RECRUITER_EMAIL}' AND p.onboarding_completed_at IS NOT NULL" \
    | jq -r 'if (.records | length) == 1 then .records[0][0].stringValue else empty end')"
  [[ "$RECRUITER_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "The E2E recruiter has no completed profile." >&2; exit 1; }
  EXISTING="$(sql "SELECT count(*)::text FROM (${RUN_JOB_SQL}) t" | jq -r '.records[0][0].stringValue')"
  [[ "$EXISTING" == "0" ]] || { echo "This run already has a temporary sea job; refusing to create another." >&2; exit 1; }

  JOB_ID="$(sql "INSERT INTO public.jobs (title, company_name, company_id, created_by_user_id, location, summary, description, apply_until, status, job_domain, department, rank, published_at, department_key, accepted_role_keys, min_match_to_apply) VALUES ('${JOB_TITLE}', 'E2E Manning', NULL, '${RECRUITER_ID}'::uuid, 'Mumbai', 'Temporary job for the onboarding E2E. It is removed when the run ends.', 'Temporary job for the onboarding E2E. It is removed when the run ends.', current_date + 1, 'published'::public.job_listing_status, 'sea', 'Deck officers', 'Master / Captain', now(), 'deck_officers', ARRAY['master']::text[], 70) RETURNING id::text" \
    | jq -r '.records[0][0].stringValue // empty')"
  [[ "$JOB_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "The temporary sea job was not created." >&2; exit 1; }
  echo "ONBOARDING_E2E_TEMP_SEA_JOB_ID=$JOB_ID"
  echo "ONBOARDING_E2E_TEMP_SEA_JOB_CREATED=true"
  exit 0
fi

FOUND="$(sql "SELECT count(*)::text FROM (${RUN_JOB_SQL}) t" | jq -r '.records[0][0].stringValue')"
echo "ONBOARDING_E2E_TEMP_SEA_JOB_FOUND=$FOUND"
[[ "$FOUND" == "0" || "$FOUND" == "1" ]] || { echo "Expected at most one temporary sea job for this run, found $FOUND; refusing." >&2; exit 1; }
if [[ "$FOUND" == "1" ]]; then
  sql "UPDATE public.jobs SET status = 'closed'::public.job_listing_status, updated_at = now() WHERE id = (${RUN_JOB_SQL})" >/dev/null
  APPLICATIONS="$(sql "DELETE FROM public.job_applications WHERE job_id = (${RUN_JOB_SQL})" | jq -r '.numberOfRecordsUpdated // 0')"
  # Every other table that references a job deletes on cascade.
  DELETED="$(sql "DELETE FROM public.jobs WHERE id = (${RUN_JOB_SQL})" | jq -r '.numberOfRecordsUpdated // 0')"
  [[ "$DELETED" == "1" ]] || { echo "The temporary sea job was not deleted." >&2; exit 1; }
  echo "ONBOARDING_E2E_TEMP_SEA_JOB_APPLICATIONS_DELETED=$APPLICATIONS"
fi
REMAINING="$(sql "SELECT count(*)::text FROM (${RUN_JOB_SQL}) t" | jq -r '.records[0][0].stringValue')"
[[ "$REMAINING" == "0" ]] || { echo "The temporary sea job is still present." >&2; exit 1; }
echo "ONBOARDING_E2E_TEMP_SEA_JOB_CLEANUP_VERIFIED=true"
