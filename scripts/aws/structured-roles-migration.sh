#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0062_structured_roles.sql"
ACTION_FILE="scripts/aws/structured-roles-migration-action.txt"

[[ "${STRUCTURED_ROLES_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "STRUCTURED_ROLES_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$STRUCTURED_ROLES_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]
if len(parts)!=11: raise SystemExit(f'expected 11 statements, found {len(parts)}')
for p in parts:
    code='\n'.join(x for x in p.splitlines() if not x.lstrip().startswith('--')).strip()
    if re.search(r'\b(drop\s+(table|column|type|schema|index)|truncate|delete\s+from)\b',code,re.I):
        raise SystemExit('destructive SQL forbidden')
    if not code.endswith(';'): raise SystemExit('statement missing semicolon')
    if len(code.encode('utf-8'))>60000: raise SystemExit('statement too large for the Data API')
print('STRUCTURED_ROLES_SQL_GUARD=NON_DESTRUCTIVE')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }
count(){ data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

BASE_COLUMNS="$(count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND ((table_name='profiles' AND column_name IN ('persona','profile_type')) OR (table_name='maritime_profiles' AND column_name='rank') OR (table_name='jobs' AND column_name IN ('rank','job_domain','department')))")"
[[ "$BASE_COLUMNS" == "6" ]] || { echo "profiles, maritime_profiles and jobs must already have persona, rank, job_domain and department." >&2; exit 1; }

NEW_COLUMNS_SQL="SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND ((table_name='profiles' AND column_name IN ('role_department_key','role_key','role_other_text','cadet_stage_key','cadet_course_key','target_department_key','target_role_key','occupation_text')) OR (table_name='jobs' AND column_name IN ('department_key','accepted_role_keys','role_other_text','min_match_to_apply')))"
schema_applied(){ count "SELECT CASE WHEN ($NEW_COLUMNS_SQL) = 12 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_structured_role_check') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_structured_role_check' AND pg_get_constraintdef(oid) ILIKE '%min_match_to_apply%') AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='jobs_accepted_role_keys_idx') THEN 1 ELSE 0 END::bigint"; }

PROFILE_RANKED="(coalesce(p.persona, CASE p.profile_type::text WHEN 'seafarer' THEN 'seafarer' WHEN 'recruiter' THEN 'recruiter_hr' WHEN 'trainer' THEN 'trainer_instructor' ELSE 'shore_professional' END) IN ('seafarer','shore_professional','recruiter_hr','trainer_instructor'))"
report(){
  local stage="$1" new_columns
  new_columns="$(count "$NEW_COLUMNS_SQL")"
  echo "STRUCTURED_ROLES_${stage}_PROFILES_WITH_RANK_TEXT=$(count "SELECT count(*)::bigint FROM public.profiles p JOIN public.maritime_profiles mp ON mp.user_id = p.id WHERE mp.rank IS NOT NULL AND $PROFILE_RANKED")"
  echo "STRUCTURED_ROLES_${stage}_JOBS_WITH_RANK_TEXT=$(count "SELECT count(*)::bigint FROM public.jobs j WHERE j.rank IS NOT NULL")"
  echo "STRUCTURED_ROLES_${stage}_OPEN_JOBS=$(count "SELECT count(*)::bigint FROM public.jobs j WHERE j.status = 'published' AND j.deleted_at IS NULL")"
  if [[ "$new_columns" == "12" ]]; then
    echo "STRUCTURED_ROLES_${stage}_PROFILES_MAPPED=$(count "SELECT count(*)::bigint FROM public.profiles p JOIN public.maritime_profiles mp ON mp.user_id = p.id WHERE mp.rank IS NOT NULL AND $PROFILE_RANKED AND p.role_key IS NOT NULL")"
    echo "STRUCTURED_ROLES_${stage}_PROFILES_UNMAPPED=$(count "SELECT count(*)::bigint FROM public.profiles p JOIN public.maritime_profiles mp ON mp.user_id = p.id WHERE mp.rank IS NOT NULL AND $PROFILE_RANKED AND p.role_key IS NULL")"
    echo "STRUCTURED_ROLES_${stage}_SEAFARERS_AND_CADETS_WITHOUT_KEY=$(count "SELECT count(*)::bigint FROM public.profiles p WHERE p.onboarding_completed_at IS NOT NULL AND p.account_status = 'active' AND ((coalesce(p.persona, CASE WHEN p.profile_type::text = 'seafarer' THEN 'seafarer' END) = 'seafarer' AND p.role_key IS NULL) OR (p.persona = 'student_cadet' AND p.target_role_key IS NULL))")"
    echo "STRUCTURED_ROLES_${stage}_JOBS_MAPPED=$(count "SELECT count(*)::bigint FROM public.jobs j WHERE j.rank IS NOT NULL AND j.department_key IS NOT NULL")"
    echo "STRUCTURED_ROLES_${stage}_JOBS_UNMAPPED=$(count "SELECT count(*)::bigint FROM public.jobs j WHERE j.rank IS NOT NULL AND j.department_key IS NULL")"
    echo "STRUCTURED_ROLES_${stage}_OPEN_JOBS_MIN_MATCH_70=$(count "SELECT count(*)::bigint FROM public.jobs j WHERE j.status = 'published' AND j.deleted_at IS NULL AND j.min_match_to_apply = 70")"
    echo "STRUCTURED_ROLES_${stage}_OPEN_JOBS_MIN_MATCH_0=$(count "SELECT count(*)::bigint FROM public.jobs j WHERE j.status = 'published' AND j.deleted_at IS NULL AND j.min_match_to_apply = 0")"
  fi
}

NEW_COLUMNS="$(count "$NEW_COLUMNS_SQL")"
if [[ "$(schema_applied)" == "1" ]]; then report AFTER; echo "STRUCTURED_ROLES_ALREADY_APPLIED=true"; exit 0; fi
[[ "$NEW_COLUMNS" == "0" ]] || { echo "Partially applied schema ($NEW_COLUMNS of 12 new columns); refusing to continue." >&2; exit 1; }
report BEFORE

echo "STRUCTURED_ROLES_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "STRUCTURED_ROLES_PLAN_ONLY_NO_APPLY=true"; exit 0; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$STRUCTURED_ROLES_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-structured-roles-0062')::bigint)" >/dev/null
while IFS= read -r encoded; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  data_api --transaction-id "$TX" --sql "$SQL" >/dev/null
done < <(python3 - "$MIGRATION" <<'PY'
import base64,re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
for p in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]:
    print(base64.b64encode(p.encode()).decode())
PY
)
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null
committed=true

[[ "$(schema_applied)" == "1" ]] || { echo "structured role columns, constraints or indexes missing after apply." >&2; exit 1; }
report AFTER
echo "STRUCTURED_ROLES_APPLY_VERIFIED=true"
