#!/usr/bin/env bash
# Hotfix P5, read-only: how many jobs, profiles and saved alerts hold "N/A"-style visa values or a visa condition, how
# many open jobs For You used to hide from a member only for want of a listed required visa, and which other free-text
# match criteria hold "N/A"-style values. Counts only: never a job title, member, email or id. Changes nothing
# (SELECT count(*) statements only).
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"

[[ "${JOBS_VISA_COUNTS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "JOBS_VISA_COUNTS_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$JOBS_VISA_COUNTS_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws/jobs-visa-counts.sh .github/workflows/aws-jobs-visa-counts.yml

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

read_count() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" --sql "$1" --output json | jq -r '.records[0][0].longValue'
}

# The same rule as src/features/jobs/visa-display.ts: empty, "N/A", "NA", "none", "nil", "-", "not applicable", in any
# case or spacing (spaces, dots, slashes, underscores and dashes are ignored).
placeholder() {
  printf "lower(regexp_replace(coalesce(%s, ''), '[[:space:]./_-]+', '', 'g')) IN ('', 'na', 'none', 'nil', 'notapplicable')" "$1"
}
OPEN_JOB="j.status = 'published' AND j.deleted_at IS NULL AND (j.apply_until IS NULL OR j.apply_until >= current_date)"
MEMBER="p.account_status = 'active' AND p.onboarding_completed_at IS NOT NULL"
held() {
  # The member holds the visa the way matching used to compare (trimmed, any case; rejected or expired ones do not count).
  echo "EXISTS (SELECT 1 FROM public.profile_visas pv WHERE pv.profile_id = p.id AND pv.verification_state <> 'rejected' AND (pv.expires_on IS NULL OR pv.expires_on >= current_date) AND lower(btrim(pv.visa_type)) = lower(btrim($1)))"
}

# 1. Visa values on jobs and profiles.
JOB_ANY="EXISTS (SELECT 1 FROM public.job_visa_requirements v WHERE v.job_id = j.id)"
JOB_PLACEHOLDER="EXISTS (SELECT 1 FROM public.job_visa_requirements v WHERE v.job_id = j.id AND $(placeholder v.visa_name))"
echo "JOBS_VISA_COUNTS_JOBS with_visa=$(read_count "SELECT count(*)::bigint FROM public.jobs j WHERE $JOB_ANY") with_na_style=$(read_count "SELECT count(*)::bigint FROM public.jobs j WHERE $JOB_PLACEHOLDER") open_with_visa=$(read_count "SELECT count(*)::bigint FROM public.jobs j WHERE $OPEN_JOB AND $JOB_ANY") open_with_na_style=$(read_count "SELECT count(*)::bigint FROM public.jobs j WHERE $OPEN_JOB AND $JOB_PLACEHOLDER") na_style_values=$(read_count "SELECT count(*)::bigint FROM public.job_visa_requirements v WHERE $(placeholder v.visa_name)")"
PROFILE_ANY="EXISTS (SELECT 1 FROM public.profile_visas pv WHERE pv.profile_id = p.id)"
PROFILE_PLACEHOLDER="EXISTS (SELECT 1 FROM public.profile_visas pv WHERE pv.profile_id = p.id AND $(placeholder pv.visa_type))"
echo "JOBS_VISA_COUNTS_PROFILES with_visa=$(read_count "SELECT count(*)::bigint FROM public.profiles p WHERE $PROFILE_ANY") with_na_style=$(read_count "SELECT count(*)::bigint FROM public.profiles p WHERE $PROFILE_PLACEHOLDER") na_style_values=$(read_count "SELECT count(*)::bigint FROM public.profile_visas pv WHERE $(placeholder pv.visa_type)")"

# 2. Saved alerts with a visa condition (the sender now drops it and keeps the rest).
ALERT_VISA="jsonb_typeof(a.filters -> 'visas') = 'array' AND jsonb_array_length(a.filters -> 'visas') > 0"
echo "JOBS_VISA_COUNTS_ALERTS total=$(read_count "SELECT count(*)::bigint FROM public.job_alerts a WHERE true") with_visa_condition=$(read_count "SELECT count(*)::bigint FROM public.job_alerts a WHERE $ALERT_VISA") enabled_with_visa_condition=$(read_count "SELECT count(*)::bigint FROM public.job_alerts a WHERE a.enabled = true AND $ALERT_VISA")"

# 3. For You: open jobs listing a required visa the member does not hold were "Not eligible: needs X visa" and left
# out. Pairs (member, job) over active members give the average per member; an upper bound, since some of those jobs
# also miss on rank or the minimum match.
MISSING_VISA="EXISTS (SELECT 1 FROM public.job_visa_requirements v WHERE v.job_id = j.id AND v.required = true AND NOT $(held v.visa_name))"
MEMBERS="$(read_count "SELECT count(*)::bigint FROM public.profiles p WHERE $MEMBER")"
PAIRS="$(read_count "SELECT count(*)::bigint FROM public.profiles p CROSS JOIN public.jobs j WHERE $MEMBER AND $OPEN_JOB AND $MISSING_VISA")"
MEMBERS_AFFECTED="$(read_count "SELECT count(*)::bigint FROM public.profiles p WHERE $MEMBER AND EXISTS (SELECT 1 FROM public.jobs j WHERE $OPEN_JOB AND $MISSING_VISA)")"
OPEN_REQUIRED="$(read_count "SELECT count(*)::bigint FROM public.jobs j WHERE $OPEN_JOB AND EXISTS (SELECT 1 FROM public.job_visa_requirements v WHERE v.job_id = j.id AND v.required = true)")"
AVERAGE="$(awk -v pairs="$PAIRS" -v members="$MEMBERS" 'BEGIN { if (members > 0) printf "%.1f", pairs / members; else printf "0.0" }')"
echo "JOBS_VISA_COUNTS_FOR_YOU members=$MEMBERS open_jobs_with_required_visa=$OPEN_REQUIRED members_missing_a_visa=$MEMBERS_AFFECTED member_job_pairs_hidden_by_visa=$PAIRS average_jobs_per_member_up_to=$AVERAGE"

# 4. Other free-text criteria that are still compared as text and can fail on "N/A" (reported, not changed).
VESSEL_PLACEHOLDER="EXISTS (SELECT 1 FROM unnest(j.vessel_types) AS vt(value) WHERE $(placeholder vt.value))"
REGION_PLACEHOLDER="EXISTS (SELECT 1 FROM unnest(j.sailing_regions) AS sr(value) WHERE $(placeholder sr.value))"
CERT_PLACEHOLDER="EXISTS (SELECT 1 FROM public.job_certificate_requirements r WHERE r.job_id = j.id AND $(placeholder r.certificate_name))"
LOCATION_PLACEHOLDER="j.job_domain = 'shore' AND j.location IS NOT NULL AND $(placeholder j.location)"
line="JOBS_VISA_COUNTS_OTHER_TEXT"
for pair in "certificates:$CERT_PLACEHOLDER" "vessel_types:$VESSEL_PLACEHOLDER" "sailing_regions:$REGION_PLACEHOLDER" "shore_location:$LOCATION_PLACEHOLDER"; do
  name="${pair%%:*}"
  predicate="${pair#*:}"
  line+=" $name=$(read_count "SELECT count(*)::bigint FROM public.jobs j WHERE $predicate")/$(read_count "SELECT count(*)::bigint FROM public.jobs j WHERE $OPEN_JOB AND $predicate")"
done
echo "$line (all/open jobs)"
echo "JOBS_VISA_COUNTS_READ_ONLY_VERIFIED=true"
