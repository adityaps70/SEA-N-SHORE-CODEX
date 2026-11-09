#!/usr/bin/env bash
# Reverses migration 0098 (Round ARCH Phase 5) on the staging Aurora cluster through the RDS Data API. Run only by
# scripts/aws/notification-created-migration.sh when its owner-merged guard reads "revert-once <sha>".
#
# In one transaction, under the same advisory lock as the apply: drops the notifications_enqueue_created trigger,
# then the enqueue_notification_created() function, and removes the 0098 ledger row so a later migrate-once can
# apply it again. Nothing else: notifications and the outbox are untouched (events already queued are published as
# usual). Prints statuses and counts only.
#
# Evidence line (the workflow reads only this): NOTIFICATION_CREATED_MIGRATION_REVERT_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/notification-created-migration-action.txt"
RUNNER="scripts/aws/notification-created-migration.sh"
MIGRATION_NAME="0098_notification_created_event"

[[ "${NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing revert." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing revert." >&2; exit 1; }
git diff --quiet HEAD -- "$0" "$RUNNER" "$ACTION_FILE" || { echo "Revert files differ from the commit; refusing revert." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing revert." >&2; exit 1; }
# Both the committed guard and the action the workflow passed must say revert-once.
[[ "$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')" == "revert-once" ]] || { echo "The guard does not read revert-once; refusing revert." >&2; exit 1; }
[[ "$(tr -d '[:space:]' <<<"${NOTIFICATION_CREATED_MIGRATION_ACTION:-}")" == "revert-once" ]] || { echo "The requested action is not revert-once; refusing revert." >&2; exit 1; }
[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing revert." >&2; exit 1; }

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
CLUSTER_STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_STATUS" == "available" ]] || { echo "Aurora cluster status is '$CLUSTER_STATUS', not available; refusing revert." >&2; exit 1; }
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]] || { echo "Aurora Data API is not enabled; refusing revert." >&2; exit 1; }
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]] || { echo "Unexpected Aurora cluster; refusing revert." >&2; exit 1; }
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]] || { echo "Aurora master secret is not the managed rds!cluster secret; refusing revert." >&2; exit 1; }

data_api() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"
}
read_count() { data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }
begin_transaction() { aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text; }
rollback_transaction() { aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$1" >/dev/null 2>&1 || true; }

FUNCTION_COUNT_SQL="SELECT count(*)::bigint FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='enqueue_notification_created'"
TRIGGER_COUNT_SQL="SELECT count(*)::bigint FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='notifications' AND t.tgname='notifications_enqueue_created' AND NOT t.tgisinternal"
LEDGER_COUNT_SQL="SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$MIGRATION_NAME'"

echo "NOTIFICATION_CREATED_MIGRATION_REVERT_BEFORE function=$(read_count "$FUNCTION_COUNT_SQL") trigger=$(read_count "$TRIGGER_COUNT_SQL") ledger=$(read_count "$LEDGER_COUNT_SQL")"

TX_ID="$(begin_transaction)"
[[ -n "$TX_ID" ]]
COMMITTED=false
trap '[[ "$COMMITTED" == true ]] || rollback_transaction "$TX_ID"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
data_api --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-notification-created-$MIGRATION_NAME')::bigint)" >/dev/null
data_api --transaction-id "$TX_ID" --sql "DROP TRIGGER IF EXISTS notifications_enqueue_created ON public.notifications" >/dev/null
data_api --transaction-id "$TX_ID" --sql "DROP FUNCTION IF EXISTS public.enqueue_notification_created()" >/dev/null
data_api --transaction-id "$TX_ID" --sql "DELETE FROM public.sea_n_shore_applied_migrations WHERE name='$MIGRATION_NAME'" >/dev/null
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
COMMITTED=true

[[ "$(read_count "$TRIGGER_COUNT_SQL")" == 0 ]] || { echo "Trigger notifications_enqueue_created is still present after the revert." >&2; exit 1; }
[[ "$(read_count "$FUNCTION_COUNT_SQL")" == 0 ]] || { echo "Function enqueue_notification_created is still present after the revert." >&2; exit 1; }
[[ "$(read_count "$LEDGER_COUNT_SQL")" == 0 ]] || { echo "The ledger still lists $MIGRATION_NAME after the revert." >&2; exit 1; }
echo "NOTIFICATION_CREATED_MIGRATION_REVERT_VERIFIED=true"
