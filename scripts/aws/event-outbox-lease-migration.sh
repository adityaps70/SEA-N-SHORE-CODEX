#!/usr/bin/env bash
# Round 14 (3.10) guarded migration 0068: the nullable event_outbox.claimed_until lease column the
# outbox worker claims batches with, so it can call EventBridge outside any database transaction.
# Additive only: exactly the reviewed statement runs, nothing else. The action file holds "plan" or
# "migrate-once".
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0068_event_outbox_lease.sql"
ACTION_FILE="scripts/aws/event-outbox-lease-migration-action.txt"

[[ "${EVENT_OUTBOX_LEASE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "EVENT_OUTBOX_LEASE_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$EVENT_OUTBOX_LEASE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]
norm=lambda p: ' '.join('\n'.join(x for x in p.splitlines() if not x.lstrip().startswith('--')).split())
expected=[
  "alter table public.event_outbox add column if not exists claimed_until timestamptz;",
]
if [norm(p) for p in parts]!=expected: raise SystemExit('migration 0068 differs from the reviewed statements')
if any(re.search(r'security\s+definer',norm(p),re.I) for p in parts): raise SystemExit('SECURITY DEFINER is forbidden')
print('EVENT_OUTBOX_LEASE_SQL_GUARD=EXACT_REVIEWED_STATEMENTS')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }
count(){ data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

SOURCE_TABLE_SQL="SELECT count(*)::bigint FROM pg_tables WHERE schemaname='public' AND tablename='event_outbox'"
COLUMN_SQL="SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='event_outbox' AND column_name='claimed_until' AND data_type='timestamp with time zone' AND is_nullable='YES' AND column_default IS NULL"
UNPUBLISHED_SQL="SELECT count(*)::bigint FROM public.event_outbox WHERE published_at IS NULL"
report(){
  echo "EVENT_OUTBOX_LEASE_$1_COLUMN=$(count "$COLUMN_SQL")"
  echo "EVENT_OUTBOX_LEASE_$1_UNPUBLISHED=$(count "$UNPUBLISHED_SQL")"
}
applied(){ [[ "$(count "$COLUMN_SQL")" == "1" ]]; }

[[ "$(count "$SOURCE_TABLE_SQL")" == "1" ]] || { echo "public.event_outbox (migration 0003) is missing; refusing to apply." >&2; exit 1; }
if applied; then report AFTER; echo "EVENT_OUTBOX_LEASE_ALREADY_APPLIED=true"; exit 0; fi
report BEFORE

echo "EVENT_OUTBOX_LEASE_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "EVENT_OUTBOX_LEASE_PLAN_ONLY_NO_APPLY=true"; exit 0; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$EVENT_OUTBOX_LEASE_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-event-outbox-lease-0068')::bigint)" >/dev/null
# ADD COLUMN takes a brief ACCESS EXCLUSIVE lock on public.event_outbox, which every social write
# inserts into; never wait long behind live traffic, retry instead. The change itself is metadata only.
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

applied || { echo "event_outbox.claimed_until missing after apply." >&2; exit 1; }
report AFTER
echo "EVENT_OUTBOX_LEASE_APPLY_VERIFIED=true"
