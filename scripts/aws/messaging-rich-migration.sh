#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0024_messaging_rich_media.sql"
ACTION_FILE="scripts/aws/messaging-rich-migration-action.txt"

[[ "${MESSAGING_RICH_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "MESSAGING_RICH_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$MESSAGING_RICH_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported rich messaging migration action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != 4:
    raise SystemExit(f'expected exactly four rich messaging statements; found {len(parts)}')

patterns = [
    r'^alter\s+table\s+public\.messages\s+add\s+column\s+reply_to_message_id\b',
    r'^alter\s+table\s+public\.messages\s+drop\s+constraint\s+messages_body_check\b',
    r'^create\s+index\s+messages_reply_to_message_idx\b',
    r'^create\s+table\s+public\.message_reactions\b',
]

for index, statement in enumerate(parts):
    code='\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not re.match(patterns[index], code, re.I | re.S):
        raise SystemExit(f'unexpected rich messaging statement {index + 1}')
    if re.search(r'\b(drop\s+table|drop\s+column|truncate|delete\s+from|update\s+|insert\s+into)\b', code, re.I):
        raise SystemExit('rich messaging migration contains forbidden destructive/data-changing SQL')
    dropped=set(re.findall(r'drop\s+constraint\s+(?:if\s+exists\s+)?([a-z0-9_]+)', code, re.I))
    if not dropped.issubset({'messages_body_check'}):
        raise SystemExit(f'unexpected constraint replacement: {sorted(dropped)}')
    if not code.endswith(';'):
        raise SystemExit('rich messaging migration statement missing semicolon')
print(f'MESSAGING_RICH_SQL_GUARD=EXPECTED_ADDITIVE_DDL statements={len(parts)}')
PY

echo "MESSAGING_RICH_MIGRATION_SHA256=$(sha256sum "$MIGRATION" | cut -d' ' -f1)"
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

FOUNDATION_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('messages','conversation_participants','conversations')")"
[[ "$FOUNDATION_COUNT" == "3" ]] || { echo "Messaging foundation is missing; refusing rich messaging migration." >&2; exit 1; }

shape() {
  local MESSAGE_COLUMNS BODY_CHECK ATTACHMENT_CHECK REPLY_FK REPLY_INDEX REACTION_TABLE REACTION_COLUMNS REACTION_PK REACTION_EMOJI_CHECK

  MESSAGE_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND ((column_name='reply_to_message_id' AND data_type='uuid') OR (column_name IN ('attachment_storage_path','attachment_name','attachment_mime_type') AND data_type='text') OR (column_name='attachment_size' AND data_type='bigint'))")"
  BODY_CHECK="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='messages' AND c.conname='messages_body_check' AND c.contype='c' AND position('attachment_storage_path' in pg_get_constraintdef(c.oid)) > 0 AND position('deleted_at' in pg_get_constraintdef(c.oid)) > 0")"
  ATTACHMENT_CHECK="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='messages' AND c.conname='messages_attachment_check' AND c.contype='c'")"
  REPLY_FK="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='messages' AND c.conname='messages_reply_to_message_fk' AND c.contype='f'")"
  REPLY_INDEX="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname='messages_reply_to_message_idx'")"
  REACTION_TABLE="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='message_reactions'")"
  REACTION_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='message_reactions' AND column_name IN ('message_id','profile_id','emoji','created_at')")"
  REACTION_PK="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='message_reactions' AND c.contype='p'")"
  REACTION_EMOJI_CHECK="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='message_reactions' AND c.conname='message_reactions_emoji_check' AND c.contype='c'")"

  printf '%s/%s/%s/%s/%s/%s/%s/%s/%s\n' "$MESSAGE_COLUMNS" "$BODY_CHECK" "$ATTACHMENT_CHECK" "$REPLY_FK" "$REPLY_INDEX" "$REACTION_TABLE" "$REACTION_COLUMNS" "$REACTION_PK" "$REACTION_EMOJI_CHECK"
}

BEFORE="$(shape)"
COMPLETE="5/1/1/1/1/1/4/1/1"
EMPTY="0/0/0/0/0/0/0/0/0"
echo "MESSAGING_RICH_MIGRATION_SHAPE_BEFORE=$BEFORE"

if [[ "$BEFORE" == "$COMPLETE" ]]; then
  echo "MESSAGING_RICH_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

[[ "$BEFORE" == "$EMPTY" ]] || {
  echo "Partial or unexpected rich messaging schema detected; refusing automatic migration." >&2
  exit 1
}

echo "MESSAGING_RICH_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "MESSAGING_RICH_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$MESSAGING_RICH_MIGRATION_EXPECTED_SHA" ]]

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "4" ]]

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-messaging-rich-0024')::bigint)" >/dev/null

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

AFTER="$(shape)"
echo "MESSAGING_RICH_MIGRATION_SHAPE_AFTER=$AFTER"
[[ "$AFTER" == "$COMPLETE" ]]
echo "MESSAGING_RICH_MIGRATION_APPLY_VERIFIED=true"
