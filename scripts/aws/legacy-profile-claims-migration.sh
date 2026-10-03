#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0058_legacy_profile_claims.sql"
ACTION_FILE="scripts/aws/legacy-profile-claims-migration-action.txt"

[[ "${LEGACY_PROFILE_CLAIMS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LEGACY_PROFILE_CLAIMS_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LEGACY_PROFILE_CLAIMS_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re, sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]
if len(parts)!=4: raise SystemExit(f'expected 4 statements, found {len(parts)}')
for p in parts:
    code='\n'.join(x for x in p.splitlines() if not x.lstrip().startswith('--')).strip()
    if re.search(r'\b(drop\s+(table|column|type|schema)|truncate|delete\s+from)\b',code,re.I):
        raise SystemExit('destructive SQL forbidden')
    if not code.endswith(';'): raise SystemExit('statement missing semicolon')
print('LEGACY_PROFILE_CLAIMS_SQL_GUARD=ADDITIVE')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }
COUNT="$(data_api --sql "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='legacy_profile_claims'" --output json | jq -r '.records[0][0].longValue')"
if [[ "$COUNT" == "1" ]]; then echo "LEGACY_PROFILE_CLAIMS_ALREADY_APPLIED=true"; exit 0; fi
echo "LEGACY_PROFILE_CLAIMS_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "LEGACY_PROFILE_CLAIMS_PLAN_ONLY_NO_APPLY"; exit 0; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEGACY_PROFILE_CLAIMS_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-legacy-profile-claims-0058')::bigint)" >/dev/null
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
AFTER="$(data_api --sql "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='legacy_profile_claims'" --output json | jq -r '.records[0][0].longValue')"
[[ "$AFTER" == "1" ]]
echo "LEGACY_PROFILE_CLAIMS_APPLY_VERIFIED=true"
