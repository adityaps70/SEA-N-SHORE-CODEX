#!/usr/bin/env bash
# Round 14 (2.6) guarded migration 0065: the additive auth_email_events table and its two indexes,
# used for per-IP and per-email limits on sign-up, confirmation-code resend and password reset.
# The action file holds "plan" or "migrate-once".
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0065_auth_email_limits.sql"
ACTION_FILE="scripts/aws/auth-email-limits-migration-action.txt"

[[ "${AUTH_EMAIL_LIMITS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "AUTH_EMAIL_LIMITS_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$AUTH_EMAIL_LIMITS_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]
if len(parts)!=3: raise SystemExit(f'expected 3 statements, found {len(parts)}')
for p in parts:
    code='\n'.join(x for x in p.splitlines() if not x.lstrip().startswith('--')).strip()
    if not re.match(r'^create (table if not exists public\.auth_email_events \(|index if not exists auth_email_events_\w+\s+on public\.auth_email_events )', code, re.I):
        raise SystemExit('only CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS on public.auth_email_events are allowed')
    if re.search(r'\b(drop|truncate|delete|update|alter|insert|grant|revoke|references)\b',code,re.I):
        raise SystemExit('destructive SQL forbidden')
    if code.count(';')!=1 or not code.endswith(';'): raise SystemExit('each statement must end with exactly one semicolon')
print('AUTH_EMAIL_LIMITS_SQL_GUARD=ADDITIVE_ONLY')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }
count(){ data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

TABLE_SQL="SELECT count(*)::bigint FROM pg_tables WHERE schemaname='public' AND tablename='auth_email_events'"
INDEXES_SQL="SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND tablename='auth_email_events' AND indexname IN ('auth_email_events_action_email_created_idx','auth_email_events_action_ip_created_idx')"
report(){
  echo "AUTH_EMAIL_LIMITS_$1_TABLE=$(count "$TABLE_SQL")"
  echo "AUTH_EMAIL_LIMITS_$1_INDEXES=$(count "$INDEXES_SQL")"
}
applied(){ [[ "$(count "$TABLE_SQL")" == "1" && "$(count "$INDEXES_SQL")" == "2" ]]; }

if applied; then report AFTER; echo "AUTH_EMAIL_LIMITS_ALREADY_APPLIED=true"; exit 0; fi
report BEFORE

echo "AUTH_EMAIL_LIMITS_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "AUTH_EMAIL_LIMITS_PLAN_ONLY_NO_APPLY=true"; exit 0; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$AUTH_EMAIL_LIMITS_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-auth-email-limits-0065')::bigint)" >/dev/null
# A new table locks nothing that live traffic uses; still never wait long behind a lock, retry instead.
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

applied || { echo "auth_email_events table or indexes missing after apply." >&2; exit 1; }
report AFTER
echo "AUTH_EMAIL_LIMITS_APPLY_VERIFIED=true"
