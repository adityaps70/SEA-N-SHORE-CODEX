#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0061_community_categories.sql"
ACTION_FILE="scripts/aws/community-categories-migration-action.txt"

[[ "${COMMUNITY_CATEGORIES_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "COMMUNITY_CATEGORIES_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$COMMUNITY_CATEGORIES_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]
if len(parts)!=7: raise SystemExit(f'expected 7 statements, found {len(parts)}')
for p in parts:
    code='\n'.join(x for x in p.splitlines() if not x.lstrip().startswith('--')).strip()
    if re.search(r'\b(drop\s+(table|column|type|schema)|truncate|delete\s+from)\b',code,re.I):
        raise SystemExit('destructive SQL forbidden')
    if not code.endswith(';'): raise SystemExit('statement missing semicolon')
print('COMMUNITY_CATEGORIES_SQL_GUARD=NON_DESTRUCTIVE')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }

TABLE_COUNT="$(data_api --sql "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='community_groups' AND column_name IN ('join_policy','owner_company_id','icon_path')" --output json | jq -r '.records[0][0].longValue')"
[[ "$TABLE_COUNT" == "3" ]] || { echo "community_groups must already have the 0057 columns." >&2; exit 1; }
ADMIN_COUNT="$(data_api --sql "SELECT count(*)::bigint FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id WHERE ur.role::text='administrator'" --output json | jq -r '.records[0][0].longValue')"
[[ "$ADMIN_COUNT" =~ ^[0-9]+$ && "$ADMIN_COUNT" -ge 1 ]] || { echo "No platform administrator to own the category communities." >&2; exit 1; }
echo "COMMUNITY_CATEGORIES_ADMIN_OWNER_AVAILABLE=true"

CATEGORY_NAMES_SQL="SELECT count(DISTINCT lower(btrim(name)))::bigint FROM public.community_groups WHERE lower(btrim(name)) IN ('maritime news','technical discussion','vetting & sire 2.0','career advice','safety lessons','achievement','learning','industry opinion')"
schema_applied(){ data_api --sql "SELECT count(*)::bigint FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='community_groups' AND c.column_name='category' AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='community_groups_category_check' AND pg_get_constraintdef(oid) ILIKE '%industry_opinion%')" --output json | jq -r '.records[0][0].longValue'; }
category_names(){ data_api --sql "$CATEGORY_NAMES_SQL" --output json | jq -r '.records[0][0].longValue'; }
if [[ "$(schema_applied)" == "1" && "$(category_names)" == "8" ]]; then echo "COMMUNITY_CATEGORIES_ALREADY_APPLIED=true"; exit 0; fi
echo "COMMUNITY_CATEGORIES_EXISTING_CATEGORY_NAMES=$(category_names)"

echo "COMMUNITY_CATEGORIES_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "COMMUNITY_CATEGORIES_PLAN_ONLY_NO_APPLY=true"; exit 0; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$COMMUNITY_CATEGORIES_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-community-categories-0061')::bigint)" >/dev/null
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

[[ "$(schema_applied)" == "1" ]] || { echo "category column or constraint missing after apply." >&2; exit 1; }
[[ "$(category_names)" == "8" ]] || { echo "expected all eight category communities after apply." >&2; exit 1; }
echo "COMMUNITY_CATEGORIES_APPLY_VERIFIED=true"
