#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0009_feed_social_interactions.sql"
ACTION_FILE="scripts/aws/feed-social-interactions-migration-action.txt"
EXPECTED_STATEMENTS=28

[[ "${FEED_SOCIAL_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "FEED_SOCIAL_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$FEED_SOCIAL_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported feed social migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" "$EXPECTED_STATEMENTS" <<'PY'
import re, sys
path, expected = sys.argv[1], int(sys.argv[2])
sql=open(path, encoding='utf-8').read().strip()
if re.search(r'\b(drop|truncate)\b|\bdelete\s+from\b|\bupdate\s+', sql, re.I):
    raise SystemExit('Feed social migration contains destructive/data-changing SQL')
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'Feed social migration must contain {expected} statements; found {len(parts)}')
allowed=re.compile(r"^(alter\s+type\s+public\.(post_reaction_type|network_notification_type)\s+add\s+value\s+if\s+not\s+exists\s+'[a-z_]+'|alter\s+table\s+public\.(post_comments|notifications)\s+add\s+(column\s+if\s+not\s+exists|constraint)\b|create\s+table\s+if\s+not\s+exists\s+public\.(comment_reactions|content_mentions)\b|create\s+(unique\s+)?index\s+if\s+not\s+exists\b)", re.I)
for part in parts:
    if not allowed.match(part) or not part.endswith(';'):
        raise SystemExit('Feed social migration statement outside approved additive families')
normalized=' '.join(sql.split()).lower()
required=[
  "add value if not exists 'support'", "add value if not exists 'respect'", "add value if not exists 'on_point'",
  'parent_comment_id uuid', 'post_comments_parent_same_post_fk', 'create table if not exists public.comment_reactions',
  'create table if not exists public.content_mentions', 'content_mentions_post_unique_idx', 'content_mentions_comment_unique_idx',
  'add column if not exists dedupe_key text', 'notifications_recipient_dedupe_unique_idx'
]
for token in required:
    if token not in normalized: raise SystemExit('Missing approved schema token: '+token)
print('FEED_SOCIAL_MIGRATION_SQL_GUARD=ADDITIVE_ONLY')
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
  local reactions social_types parent_col tables notif_cols parent_fk notif_fk parent_unique indexes
  reactions="$(read_count "SELECT count(*)::bigint FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='post_reaction_type' AND e.enumlabel IN ('like','support','respect','on_point')")"
  social_types="$(read_count "SELECT count(*)::bigint FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='network_notification_type' AND e.enumlabel IN ('post_comment','comment_reply','post_reaction','comment_reaction','post_mention','comment_mention')")"
  parent_col="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='post_comments' AND column_name='parent_comment_id'")"
  tables="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('comment_reactions','content_mentions')")"
  notif_cols="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name IN ('post_id','comment_id','reaction_type','dedupe_key')")"
  parent_fk="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conname='post_comments_parent_same_post_fk'")"
  notif_fk="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conname IN ('notifications_post_fk','notifications_comment_fk')")"
  parent_unique="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conname='post_comments_id_post_unique'")"
  indexes="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('comment_reactions_comment_idx','post_comments_parent_created_idx','content_mentions_post_unique_idx','content_mentions_comment_unique_idx','content_mentions_recipient_created_idx','notifications_recipient_dedupe_unique_idx','notifications_post_created_idx','notifications_comment_created_idx')")"
  printf '%s %s %s %s %s %s %s %s %s\n' "$reactions" "$social_types" "$parent_col" "$tables" "$notif_cols" "$parent_fk" "$notif_fk" "$parent_unique" "$indexes"
}

read -r REACTIONS SOCIAL_TYPES PARENT_COL TABLES NOTIF_COLS PARENT_FK NOTIF_FK PARENT_UNIQUE INDEXES < <(read_shape)
echo "FEED_SOCIAL_SHAPE_BEFORE=$REACTIONS/$SOCIAL_TYPES/$PARENT_COL/$TABLES/$NOTIF_COLS/$PARENT_FK/$NOTIF_FK/$PARENT_UNIQUE/$INDEXES"
if [[ "$REACTIONS/$SOCIAL_TYPES/$PARENT_COL/$TABLES/$NOTIF_COLS/$PARENT_FK/$NOTIF_FK/$PARENT_UNIQUE/$INDEXES" == "4/6/1/2/4/1/2/1/8" ]]; then
  echo "FEED_SOCIAL_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi
[[ "$REACTIONS/$SOCIAL_TYPES/$PARENT_COL/$TABLES/$NOTIF_COLS/$PARENT_FK/$NOTIF_FK/$PARENT_UNIQUE/$INDEXES" == "1/0/0/0/0/0/0/0/0" ]] || {
  echo "Partial or unexpected feed social schema detected; refusing automatic migration." >&2
  exit 1
}

echo "FEED_SOCIAL_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "FEED_SOCIAL_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$FEED_SOCIAL_MIGRATION_EXPECTED_SHA" ]]

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "$EXPECTED_STATEMENTS" ]]
TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true
read -r REACTIONS SOCIAL_TYPES PARENT_COL TABLES NOTIF_COLS PARENT_FK NOTIF_FK PARENT_UNIQUE INDEXES < <(read_shape)
echo "FEED_SOCIAL_SHAPE_AFTER=$REACTIONS/$SOCIAL_TYPES/$PARENT_COL/$TABLES/$NOTIF_COLS/$PARENT_FK/$NOTIF_FK/$PARENT_UNIQUE/$INDEXES"
[[ "$REACTIONS/$SOCIAL_TYPES/$PARENT_COL/$TABLES/$NOTIF_COLS/$PARENT_FK/$NOTIF_FK/$PARENT_UNIQUE/$INDEXES" == "4/6/1/2/4/1/2/1/8" ]]
echo "FEED_SOCIAL_MIGRATION_APPLY_VERIFIED=true"
