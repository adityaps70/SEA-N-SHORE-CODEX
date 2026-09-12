#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
BASE_MIGRATION_FILE="infra/aws/database/migrations/0012_events_engine.sql"
PRODUCT_MIGRATION_FILE="infra/aws/database/migrations/0013_events_product_fields.sql"
ACTION_FILE="scripts/aws/events-migration-action.txt"
EXPECTED_BASE_STATEMENTS=5
EXPECTED_PRODUCT_STATEMENTS=3
EXPECTED_BASE_EVENT_COLUMNS=19
EXPECTED_ATTENDEE_COLUMNS=3
EXPECTED_BASE_INDEXES=3
EXPECTED_PRODUCT_COLUMNS=8
EXPECTED_PRODUCT_INDEXES=2

[[ "${EVENTS_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "EVENTS_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$EVENTS_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$BASE_MIGRATION_FILE" "$PRODUCT_MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported events migration action." >&2; exit 1 ;; esac

verify_sql() {
  python3 - "$1" "$2" <<'PY'
import re, sys
path, expected = sys.argv[1], int(sys.argv[2])
sql = open(path, encoding='utf-8').read().strip()
if re.search(r'\bdrop\b|\btruncate\b|\bdelete\s+from\b', sql, re.I):
    raise SystemExit(f'{path} contains destructive SQL')
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'{path} must contain {expected} statements; found {len(parts)}')
for part in parts:
    if not part.endswith(';'):
        raise SystemExit(f'Every statement in {path} must end with a semicolon')
print(f'EVENTS_MIGRATION_SQL_GUARD={path}:ADDITIVE_ONLY')
PY
}
verify_sql "$BASE_MIGRATION_FILE" "$EXPECTED_BASE_STATEMENTS"
verify_sql "$PRODUCT_MIGRATION_FILE" "$EXPECTED_PRODUCT_STATEMENTS"
echo "BASE_MIGRATION_SHA256=$(sha256sum "$BASE_MIGRATION_FILE" | cut -d' ' -f1)"
echo "PRODUCT_MIGRATION_SHA256=$(sha256sum "$PRODUCT_MIGRATION_FILE" | cut -d' ' -f1)"

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
  local BASE_EVENT_COLUMNS ATTENDEE_COLUMNS BASE_INDEXES PRODUCT_COLUMNS PRODUCT_INDEXES
  BASE_EVENT_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name IN ('id','host_user_id','title','summary','description','format','status','start_at','end_at','timezone','location_name','location_address','meeting_url','topics','speakers','capacity','banner_url','created_at','updated_at')")"
  ATTENDEE_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='event_attendees' AND column_name IN ('event_id','user_id','created_at')")"
  BASE_INDEXES="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('events_discovery_idx','events_host_idx','event_attendees_user_idx')")"
  PRODUCT_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name IN ('category','event_type','city','country','agenda','speaker_details','registration_mode','registration_closes_at')")"
  PRODUCT_INDEXES="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('events_product_filter_idx','events_location_filter_idx')")"
  printf '%s %s %s %s %s\n' "$BASE_EVENT_COLUMNS" "$ATTENDEE_COLUMNS" "$BASE_INDEXES" "$PRODUCT_COLUMNS" "$PRODUCT_INDEXES"
}

read -r BASE_EVENT_COLUMNS ATTENDEE_COLUMNS BASE_INDEXES PRODUCT_COLUMNS PRODUCT_INDEXES < <(read_shape)
echo "EVENTS_MIGRATION_SHAPE_BEFORE=$BASE_EVENT_COLUMNS/$ATTENDEE_COLUMNS/$BASE_INDEXES/$PRODUCT_COLUMNS/$PRODUCT_INDEXES"
BASE_COMPLETE="$EXPECTED_BASE_EVENT_COLUMNS/$EXPECTED_ATTENDEE_COLUMNS/$EXPECTED_BASE_INDEXES"
BASE_SHAPE="$BASE_EVENT_COLUMNS/$ATTENDEE_COLUMNS/$BASE_INDEXES"
PRODUCT_COMPLETE="$EXPECTED_PRODUCT_COLUMNS/$EXPECTED_PRODUCT_INDEXES"
PRODUCT_SHAPE="$PRODUCT_COLUMNS/$PRODUCT_INDEXES"

if [[ "$BASE_SHAPE" != "0/0/0" && "$BASE_SHAPE" != "$BASE_COMPLETE" ]]; then echo "Partial or unexpected base events schema detected; refusing automatic migration." >&2; exit 1; fi
if [[ "$PRODUCT_SHAPE" != "0/0" && "$PRODUCT_SHAPE" != "$PRODUCT_COMPLETE" ]]; then echo "Partial or unexpected events product schema detected; refusing automatic migration." >&2; exit 1; fi
if [[ "$BASE_SHAPE" == "0/0/0" && "$PRODUCT_SHAPE" != "0/0" ]]; then echo "Product schema exists without base events schema; refusing automatic migration." >&2; exit 1; fi
if [[ "$BASE_SHAPE" == "$BASE_COMPLETE" && "$PRODUCT_SHAPE" == "$PRODUCT_COMPLETE" ]]; then echo "EVENTS_MIGRATION_ALREADY_APPLIED=true"; exit 0; fi

echo "EVENTS_MIGRATION_PLAN_VERIFIED=ADDITIVE_FORWARD_APPLY"
if [[ "$ACTION" == "plan" ]]; then echo "EVENTS_MIGRATION_PLAN_ONLY_NO_APPLY"; exit 0; fi
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$EVENTS_MIGRATION_EXPECTED_SHA" ]]

FILES=()
COUNTS=()
if [[ "$BASE_SHAPE" == "0/0/0" ]]; then FILES+=("$BASE_MIGRATION_FILE"); COUNTS+=("$EXPECTED_BASE_STATEMENTS"); fi
if [[ "$PRODUCT_SHAPE" == "0/0" ]]; then FILES+=("$PRODUCT_MIGRATION_FILE"); COUNTS+=("$EXPECTED_PRODUCT_STATEMENTS"); fi

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() { if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
for index in "${!FILES[@]}"; do
  mapfile -t STATEMENT_B64 < <(python3 - "${FILES[$index]}" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
for part in parts: print(base64.b64encode(part.encode()).decode())
PY
  )
  [[ "${#STATEMENT_B64[@]}" == "${COUNTS[$index]}" ]]
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
  done
done
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true
read -r BASE_EVENT_COLUMNS ATTENDEE_COLUMNS BASE_INDEXES PRODUCT_COLUMNS PRODUCT_INDEXES < <(read_shape)
echo "EVENTS_MIGRATION_SHAPE_AFTER=$BASE_EVENT_COLUMNS/$ATTENDEE_COLUMNS/$BASE_INDEXES/$PRODUCT_COLUMNS/$PRODUCT_INDEXES"
[[ "$BASE_EVENT_COLUMNS/$ATTENDEE_COLUMNS/$BASE_INDEXES" == "$BASE_COMPLETE" ]]
[[ "$PRODUCT_COLUMNS/$PRODUCT_INDEXES" == "$PRODUCT_COMPLETE" ]]
echo "EVENTS_MIGRATION_APPLY_VERIFIED=true"
