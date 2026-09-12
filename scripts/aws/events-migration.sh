#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0012_events_engine.sql"
ACTION_FILE="scripts/aws/events-migration-action.txt"
EXPECTED_STATEMENTS=5
EXPECTED_EVENT_COLUMNS=19
EXPECTED_ATTENDEE_COLUMNS=3
EXPECTED_INDEXES=3

[[ "${EVENTS_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "EVENTS_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$EVENTS_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported events migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" "$EXPECTED_STATEMENTS" <<'PY'
import re, sys
path, expected = sys.argv[1], int(sys.argv[2])
sql = open(path, encoding='utf-8').read().strip()
if re.search(r'\bdrop\b|\btruncate\b|\bdelete\s+from\b', sql, re.I):
    raise SystemExit('Events migration contains destructive SQL')
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'Events migration must contain {expected} statements; found {len(parts)}')
for part in parts:
    if not part.endswith(';'):
        raise SystemExit('Every events migration statement must end with a semicolon')
print('EVENTS_MIGRATION_SQL_GUARD=ADDITIVE_ONLY')
PY

echo "MIGRATION_SHA256=$(sha256sum "$MIGRATION_FILE" | cut -d' ' -f1)"
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
  local EVENT_COLUMNS ATTENDEE_COLUMNS INDEXES
  EVENT_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name IN ('id','host_user_id','title','summary','description','format','status','start_at','end_at','timezone','location_name','location_address','meeting_url','topics','speakers','capacity','banner_url','created_at','updated_at')")"
  ATTENDEE_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='event_attendees' AND column_name IN ('event_id','user_id','created_at')")"
  INDEXES="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('events_discovery_idx','events_host_idx','event_attendees_user_idx')")"
  printf '%s %s %s\n' "$EVENT_COLUMNS" "$ATTENDEE_COLUMNS" "$INDEXES"
}

read -r EVENT_COLUMNS ATTENDEE_COLUMNS INDEXES < <(read_shape)
echo "EVENTS_MIGRATION_SHAPE_BEFORE=$EVENT_COLUMNS/$ATTENDEE_COLUMNS/$INDEXES"
EXPECTED_SHAPE="$EXPECTED_EVENT_COLUMNS/$EXPECTED_ATTENDEE_COLUMNS/$EXPECTED_INDEXES"
SHAPE="$EVENT_COLUMNS/$ATTENDEE_COLUMNS/$INDEXES"
if [[ "$SHAPE" == "$EXPECTED_SHAPE" ]]; then echo "EVENTS_MIGRATION_ALREADY_APPLIED=true"; exit 0; fi
if [[ "$SHAPE" != "0/0/0" ]]; then echo "Partial or unexpected events schema detected; refusing automatic migration." >&2; exit 1; fi
echo "EVENTS_MIGRATION_PLAN_VERIFIED=FULL_ADDITIVE_APPLY"
if [[ "$ACTION" == "plan" ]]; then echo "EVENTS_MIGRATION_PLAN_ONLY_NO_APPLY"; exit 0; fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$EVENTS_MIGRATION_EXPECTED_SHA" ]]
mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
for part in parts: print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "$EXPECTED_STATEMENTS" ]]
TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() { if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true
read -r EVENT_COLUMNS ATTENDEE_COLUMNS INDEXES < <(read_shape)
echo "EVENTS_MIGRATION_SHAPE_AFTER=$EVENT_COLUMNS/$ATTENDEE_COLUMNS/$INDEXES"
[[ "$EVENT_COLUMNS/$ATTENDEE_COLUMNS/$INDEXES" == "$EXPECTED_SHAPE" ]]
echo "EVENTS_MIGRATION_APPLY_VERIFIED=true"
