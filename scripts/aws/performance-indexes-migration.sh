#!/usr/bin/env bash
# Round 14 (3.6) guarded migration 0063: additive performance indexes (posts by author, profiles
# by updated_at, pg_trgm name search on groups, companies and events). The action file holds
# "plan" or "migrate-once".
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0063_performance_indexes.sql"
ACTION_FILE="scripts/aws/performance-indexes-migration-action.txt"

[[ "${PERFORMANCE_INDEXES_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "PERFORMANCE_INDEXES_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$PERFORMANCE_INDEXES_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]
if len(parts)!=6: raise SystemExit(f'expected 6 statements, found {len(parts)}')
for p in parts:
    code='\n'.join(x for x in p.splitlines() if not x.lstrip().startswith('--')).strip()
    if not re.match(r'^create (index if not exists|extension if not exists pg_trgm;)', code, re.I):
        raise SystemExit('only CREATE INDEX IF NOT EXISTS and CREATE EXTENSION IF NOT EXISTS pg_trgm are allowed')
    if re.search(r'\b(drop|truncate|delete|update|alter|insert)\b',code,re.I):
        raise SystemExit('destructive SQL forbidden')
    if not code.endswith(';'): raise SystemExit('statement missing semicolon')
print('PERFORMANCE_INDEXES_SQL_GUARD=ADDITIVE_ONLY')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }
count(){ data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

INDEXES_SQL="SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('posts_author_created_live_idx','profiles_updated_at_idx','community_groups_name_trgm_idx','companies_name_trgm_idx','events_title_trgm_idx')"
EXTENSION_SQL="SELECT count(*)::bigint FROM pg_extension WHERE extname='pg_trgm'"
report(){
  echo "PERFORMANCE_INDEXES_$1_INDEXES=$(count "$INDEXES_SQL")"
  echo "PERFORMANCE_INDEXES_$1_PG_TRGM=$(count "$EXTENSION_SQL")"
}

if [[ "$(count "$INDEXES_SQL")" == "5" && "$(count "$EXTENSION_SQL")" == "1" ]]; then report AFTER; echo "PERFORMANCE_INDEXES_ALREADY_APPLIED=true"; exit 0; fi
report BEFORE
[[ "$(count "SELECT count(*)::bigint FROM pg_available_extensions WHERE name='pg_trgm'")" == "1" ]] || { echo "pg_trgm is not available on this cluster." >&2; exit 1; }

echo "PERFORMANCE_INDEXES_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "PERFORMANCE_INDEXES_PLAN_ONLY_NO_APPLY=true"; exit 0; }
[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PERFORMANCE_INDEXES_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-performance-indexes-0063')::bigint)" >/dev/null
# Never wait long behind live traffic for a table lock; retry the run instead.
data_api --transaction-id "$TX" --sql "SET LOCAL lock_timeout = '5s'" >/dev/null
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

[[ "$(count "$INDEXES_SQL")" == "5" && "$(count "$EXTENSION_SQL")" == "1" ]] || { echo "performance indexes missing after apply." >&2; exit 1; }
report AFTER
echo "PERFORMANCE_INDEXES_APPLY_VERIFIED=true"
