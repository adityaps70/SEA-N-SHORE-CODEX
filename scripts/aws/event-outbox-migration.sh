#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0003_event_outbox.sql"

[[ "${EVENT_OUTBOX_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "EVENT_OUTBOX_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$EVENT_OUTBOX_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" scripts/aws/event-outbox-migration.sh scripts/aws/event-outbox-migration-action.txt
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < scripts/aws/event-outbox-migration-action.txt)"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported event outbox migration action." >&2; exit 1 ;; esac

# Fail closed if the migration ever grows beyond additive schema DDL.
python3 - "$MIGRATION_FILE" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read()
if re.search(r'\b(drop|alter|truncate|delete|update|insert)\b', sql, re.I):
    raise SystemExit('Migration contains non-additive or data-changing SQL')
statements=[s.strip() for s in sql.split(';') if s.strip()]
if len(statements) != 3:
    raise SystemExit(f'Expected exactly 3 additive DDL statements, got {len(statements)}')
for statement in statements:
    if not re.match(r'^create\s+(table|index)\s+if\s+not\s+exists\b', statement, re.I):
        raise SystemExit('Unexpected migration statement: '+statement[:80])
print('EVENT_OUTBOX_MIGRATION_SQL_GUARD=ADDITIVE_ONLY')
PY

echo "MIGRATION_SHA256=$(sha256sum "$MIGRATION_FILE" | cut -d' ' -f1)"

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
HTTP_ENDPOINT="$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")"
STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"
[[ "$STATUS" == "available" ]]
[[ "$HTTP_ENDPOINT" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

execute_read() {
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --sql "$1" \
    --output json
}

TABLE_COUNT="$(execute_read "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('event_outbox','notification_event_receipts')" | jq -r '.records[0][0].longValue')"
INDEX_COUNT="$(execute_read "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname='event_outbox_unpublished_idx'" | jq -r '.records[0][0].longValue')"

echo "EVENT_OUTBOX_TABLE_COUNT_BEFORE=$TABLE_COUNT"
echo "EVENT_OUTBOX_INDEX_COUNT_BEFORE=$INDEX_COUNT"

if [[ "$TABLE_COUNT" == "2" && "$INDEX_COUNT" == "1" ]]; then
  MODE_COLUMN="$(execute_read "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_event_receipts' AND column_name='processing_mode'" | jq -r '.records[0][0].longValue')"
  [[ "$MODE_COLUMN" == "1" ]] || { echo "Existing receipt table lacks processing_mode; refusing." >&2; exit 1; }
  echo "EVENT_OUTBOX_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

[[ "$TABLE_COUNT" == "0" && "$INDEX_COUNT" == "0" ]] || {
  echo "Partial event outbox schema detected; refusing automatic migration." >&2
  exit 1
}

echo "EVENT_OUTBOX_MIGRATION_PLAN_VERIFIED=CREATE_ONLY"
if [[ "$ACTION" == "plan" ]]; then
  echo "EVENT_OUTBOX_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$EVENT_OUTBOX_MIGRATION_EXPECTED_SHA" ]]

TX_ID="$(aws rds-data begin-transaction \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" \
  --database "$DATABASE_NAME" \
  --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

python3 - "$MIGRATION_FILE" > /tmp/event-outbox-statements.json <<'PY'
import json, sys
sql=open(sys.argv[1], encoding='utf-8').read()
print(json.dumps([s.strip() for s in sql.split(';') if s.strip()]))
PY

while IFS= read -r statement; do
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --transaction-id "$TX_ID" \
    --sql "$statement" >/dev/null
done < <(jq -r '.[]' /tmp/event-outbox-statements.json)

aws rds-data commit-transaction \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" \
  --transaction-id "$TX_ID" >/dev/null
committed=true

TABLE_COUNT_AFTER="$(execute_read "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('event_outbox','notification_event_receipts')" | jq -r '.records[0][0].longValue')"
INDEX_COUNT_AFTER="$(execute_read "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname='event_outbox_unpublished_idx'" | jq -r '.records[0][0].longValue')"
MODE_COLUMN_AFTER="$(execute_read "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_event_receipts' AND column_name='processing_mode'" | jq -r '.records[0][0].longValue')"
[[ "$TABLE_COUNT_AFTER" == "2" && "$INDEX_COUNT_AFTER" == "1" && "$MODE_COLUMN_AFTER" == "1" ]]
echo "EVENT_OUTBOX_MIGRATION_APPLY_VERIFIED=true"
