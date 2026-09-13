#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0014_messaging.sql"
ACTION_FILE="scripts/aws/messaging-migration-action.txt"
EXPECTED_STATEMENTS=9
EXPECTED_TABLES=3
EXPECTED_COLUMNS=23
EXPECTED_INDEXES=3
EXPECTED_TRIGGER=1
EXPECTED_FUNCTION=1
EXPECTED_LAST_MESSAGE_FK=1

[[ "${MESSAGING_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "MESSAGING_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$MESSAGING_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported messaging migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" "$EXPECTED_STATEMENTS" <<'PY'
import re, sys
path, expected = sys.argv[1], int(sys.argv[2])
sql = open(path, encoding='utf-8').read().strip()
if re.search(r'\b(drop|truncate)\b|\b(delete|update|insert)\s+\b', sql, re.I):
    raise SystemExit('Messaging migration contains destructive or data-changing SQL')
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'Expected {expected} messaging statements; found {len(parts)}')
allowed = [
    r'^create\s+table\s+public\.(conversations|messages|conversation_participants)\b',
    r'^alter\s+table\s+public\.conversations\s+add\s+constraint\s+conversations_last_message_fk\b',
    r'^create\s+index\s+(conversation_participants_profile_idx|conversations_last_message_idx|messages_conversation_cursor_idx)\b',
    r'^create\s+or\s+replace\s+function\s+private\.set_conversation_updated_at\(\)',
    r'^create\s+trigger\s+conversations_set_updated_at\b',
]
for part in parts:
    if not part.endswith(';'):
        raise SystemExit('Every messaging migration statement must end with a semicolon')
    if not any(re.match(pattern, part, re.I | re.S) for pattern in allowed):
        raise SystemExit('Unexpected messaging migration statement: ' + part[:100])
print('MESSAGING_MIGRATION_SQL_GUARD=EXPECTED_DDL_ONLY')
PY

echo "MESSAGING_MIGRATION_SHA256=$(sha256sum "$MIGRATION_FILE" | cut -d' ' -f1)"

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

execute_read() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json
}
read_count() { execute_read "$1" | jq -r '.records[0][0].longValue'; }

read_shape() {
  local TABLES COLUMNS INDEXES TRIGGER_COUNT FUNCTION_COUNT FK_COUNT
  TABLES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('conversations','messages','conversation_participants')")"
  COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND ((table_name='conversations' AND column_name IN ('id','type','direct_user_low_id','direct_user_high_id','last_message_id','last_message_at','created_at','updated_at')) OR (table_name='messages' AND column_name IN ('id','conversation_id','sender_profile_id','client_message_id','body','created_at','edited_at','deleted_at')) OR (table_name='conversation_participants' AND column_name IN ('conversation_id','profile_id','joined_at','last_read_message_id','last_read_at','muted_at','archived_at')))")"
  INDEXES="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('conversation_participants_profile_idx','conversations_last_message_idx','messages_conversation_cursor_idx')")"
  TRIGGER_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='conversations' AND t.tgname='conversations_set_updated_at' AND NOT t.tgisinternal")"
  FUNCTION_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='set_conversation_updated_at'")"
  FK_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='conversations' AND con.conname='conversations_last_message_fk' AND con.contype='f'")"
  printf '%s %s %s %s %s %s\n' "$TABLES" "$COLUMNS" "$INDEXES" "$TRIGGER_COUNT" "$FUNCTION_COUNT" "$FK_COUNT"
}

read -r TABLES COLUMNS INDEXES TRIGGER_COUNT FUNCTION_COUNT FK_COUNT < <(read_shape)
SHAPE="$TABLES/$COLUMNS/$INDEXES/$TRIGGER_COUNT/$FUNCTION_COUNT/$FK_COUNT"
COMPLETE="$EXPECTED_TABLES/$EXPECTED_COLUMNS/$EXPECTED_INDEXES/$EXPECTED_TRIGGER/$EXPECTED_FUNCTION/$EXPECTED_LAST_MESSAGE_FK"
echo "MESSAGING_MIGRATION_SHAPE_BEFORE=$SHAPE"

if [[ "$SHAPE" == "$COMPLETE" ]]; then
  echo "MESSAGING_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi
if [[ "$SHAPE" != "0/0/0/0/0/0" ]]; then
  echo "Partial or unexpected messaging schema detected; refusing automatic migration." >&2
  exit 1
fi

echo "MESSAGING_MIGRATION_PLAN_VERIFIED=ADDITIVE_FORWARD_APPLY"
if [[ "$ACTION" == "plan" ]]; then
  echo "MESSAGING_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$MESSAGING_MIGRATION_EXPECTED_SHA" ]]

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
for part in parts:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "$EXPECTED_STATEMENTS" ]]
for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

read -r TABLES COLUMNS INDEXES TRIGGER_COUNT FUNCTION_COUNT FK_COUNT < <(read_shape)
SHAPE="$TABLES/$COLUMNS/$INDEXES/$TRIGGER_COUNT/$FUNCTION_COUNT/$FK_COUNT"
echo "MESSAGING_MIGRATION_SHAPE_AFTER=$SHAPE"
[[ "$SHAPE" == "$COMPLETE" ]]
echo "MESSAGING_MIGRATION_APPLY_VERIFIED=true"
