#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0015_post_reposts.sql"
ACTION_FILE="scripts/aws/post-reposts-migration-action.txt"
EXPECTED_STATEMENTS=6
ENUM_STATEMENT="alter type public.post_type add value if not exists 'repost';"

[[ "${POST_REPOSTS_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "POST_REPOSTS_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$POST_REPOSTS_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported post repost migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" "$EXPECTED_STATEMENTS" "$ENUM_STATEMENT" <<'PY'
import re, sys
path, expected, enum_statement = sys.argv[1], int(sys.argv[2]), sys.argv[3]
sql = open(path, encoding='utf-8').read().strip()
if re.search(r'\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\.', sql, re.I):
    raise SystemExit('Post repost migration contains unapproved destructive or data-mutating SQL')
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'Post repost migration must contain {expected} statements; found {len(parts)}')
if ' '.join(parts[0].split()).lower() != ' '.join(enum_statement.split()).lower():
    raise SystemExit('Post repost migration enum statement changed')
starts = [
    r'^alter\s+type\s+public\.post_type\s+add\s+value\s+if\s+not\s+exists\s+\'repost\'',
    r'^alter\s+table\s+public\.posts\s+add\s+column\s+repost_of_post_id\b',
    r'^alter\s+table\s+public\.posts\s+drop\s+constraint\s+posts_body_check\b',
    r'^alter\s+table\s+public\.posts\s+add\s+constraint\s+posts_body_check\b',
    r'^alter\s+table\s+public\.posts\s+add\s+constraint\s+posts_repost_shape_check\b',
    r'^create\s+unique\s+index\s+posts_active_repost_unique_idx\b',
]
for part, pattern in zip(parts, starts):
    statement = '\n'.join(line for line in part.splitlines() if not line.lstrip().startswith('--')).strip()
    if not re.match(pattern, statement, re.I):
        raise SystemExit('Post repost migration statement order or scope changed')
    if not statement.endswith(';'):
        raise SystemExit('Every post repost migration statement must end with a semicolon')
print('POST_REPOSTS_MIGRATION_SQL_GUARD=CANONICAL_REPOST_ONLY')
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
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json
}
read_count() { execute_read "$1" | jq -r '.records[0][0].longValue'; }

read_shape() {
  local ENUM_VALUES REPOST_COLUMN REPOST_CONSTRAINTS REPOST_INDEXES
  ENUM_VALUES="$(read_count "SELECT count(*)::bigint FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='post_type' AND e.enumlabel='repost'")"
  REPOST_COLUMN="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='repost_of_post_id'")"
  REPOST_CONSTRAINTS="$(read_count "SELECT count(*)::bigint FROM pg_constraint c WHERE c.conrelid='public.posts'::regclass AND ((c.conname='posts_body_check' AND pg_get_constraintdef(c.oid) ILIKE '%repost%') OR c.conname='posts_repost_shape_check')")"
  REPOST_INDEXES="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND tablename='posts' AND indexname='posts_active_repost_unique_idx'")"
  printf '%s %s %s %s\n' "$ENUM_VALUES" "$REPOST_COLUMN" "$REPOST_CONSTRAINTS" "$REPOST_INDEXES"
}

read -r ENUM_VALUES REPOST_COLUMN REPOST_CONSTRAINTS REPOST_INDEXES < <(read_shape)
echo "POST_REPOSTS_SHAPE_BEFORE=$ENUM_VALUES/$REPOST_COLUMN/$REPOST_CONSTRAINTS/$REPOST_INDEXES"

if [[ "$ENUM_VALUES/$REPOST_COLUMN/$REPOST_CONSTRAINTS/$REPOST_INDEXES" == "1/1/2/1" ]]; then
  echo "POST_REPOSTS_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

if [[ "$ENUM_VALUES/$REPOST_COLUMN/$REPOST_CONSTRAINTS/$REPOST_INDEXES" == "0/0/0/0" ]]; then
  echo "POST_REPOSTS_MIGRATION_PLAN_VERIFIED=ENUM_THEN_SCHEMA"
elif [[ "$ENUM_VALUES/$REPOST_COLUMN/$REPOST_CONSTRAINTS/$REPOST_INDEXES" == "1/0/0/0" ]]; then
  echo "POST_REPOSTS_MIGRATION_PLAN_VERIFIED=ENUM_COMMITTED_SCHEMA_PENDING"
else
  echo "Partial or unexpected post repost schema detected; refusing automatic migration." >&2
  exit 1
fi

if [[ "$ACTION" == "plan" ]]; then
  echo "POST_REPOSTS_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$POST_REPOSTS_MIGRATION_EXPECTED_SHA" ]]

if [[ "$ENUM_VALUES" == "0" ]]; then
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$ENUM_STATEMENT" >/dev/null
fi
[[ "$(read_count "SELECT count(*)::bigint FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='post_type' AND e.enumlabel='repost'")" == "1" ]]
echo "POST_REPOSTS_ENUM_COMMITTED=true"

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
for part in parts[1:]:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "5" ]]

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
      --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

read -r ENUM_VALUES REPOST_COLUMN REPOST_CONSTRAINTS REPOST_INDEXES < <(read_shape)
echo "POST_REPOSTS_SHAPE_AFTER=$ENUM_VALUES/$REPOST_COLUMN/$REPOST_CONSTRAINTS/$REPOST_INDEXES"
[[ "$ENUM_VALUES/$REPOST_COLUMN/$REPOST_CONSTRAINTS/$REPOST_INDEXES" == "1/1/2/1" ]]
echo "POST_REPOSTS_MIGRATION_APPLY_VERIFIED=true"
