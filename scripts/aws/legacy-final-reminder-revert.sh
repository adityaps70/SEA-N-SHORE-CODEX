#!/usr/bin/env bash
# Reverses migration 0099 (P4: the final legacy reminder) on the staging Aurora cluster through the RDS Data API. Run
# only by scripts/aws/legacy-final-reminder-migration.sh when its owner-merged guard reads "revert-once <sha>".
#
# REFUSES if any final reminder was ever handed to the worker: a row with attempts > 0 or a status of sent, sending,
# queued or failed. Those rows are the only record that a person already got (or may have got) their last legacy
# email, so they are never dropped. Only an unused mode (nothing, or only prepared/cancelled/skipped rows that were
# never attempted) can be reverted.
#
# In one transaction, under the same advisory lock as the apply: locks the final reminder table, counts the rows
# handed to the worker (and refuses, rolling back, if there are any), drops
# public.legacy_profile_invite_final_reminders and public.legacy_final_reminder_controls, and removes the 0099 ledger
# row so a later migrate-once can apply it again. Nothing else: invitations, second reminders, the do-not-email list
# and the email log are untouched. Prints statuses and counts only.
#
# Evidence line (the workflow reads only this): LEGACY_FINAL_REMINDER_MIGRATION_REVERT_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/legacy-final-reminder-migration-action.txt"
RUNNER="scripts/aws/legacy-final-reminder-migration.sh"
MIGRATION_NAME="0099_legacy_final_reminders"

[[ "${LEGACY_FINAL_REMINDER_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LEGACY_FINAL_REMINDER_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LEGACY_FINAL_REMINDER_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing revert." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing revert." >&2; exit 1; }
git diff --quiet HEAD -- "$0" "$RUNNER" "$ACTION_FILE" || { echo "Revert files differ from the commit; refusing revert." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing revert." >&2; exit 1; }
# Both the committed guard and the action the workflow passed must say revert-once.
[[ "$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')" == "revert-once" ]] || { echo "The guard does not read revert-once; refusing revert." >&2; exit 1; }
[[ "$(tr -d '[:space:]' <<<"${LEGACY_FINAL_REMINDER_MIGRATION_ACTION:-}")" == "revert-once" ]] || { echo "The requested action is not revert-once; refusing revert." >&2; exit 1; }
[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEGACY_FINAL_REMINDER_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing revert." >&2; exit 1; }

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

FINAL_TABLE_COUNT_SQL="SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='legacy_profile_invite_final_reminders'"
CONTROLS_TABLE_COUNT_SQL="SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='legacy_final_reminder_controls'"
HANDED_TO_WORKER_SQL="SELECT count(*)::bigint FROM public.legacy_profile_invite_final_reminders WHERE attempts > 0 OR status IN ('sent', 'sending', 'queued', 'failed')"
LEDGER_COUNT_SQL="SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$MIGRATION_NAME'"

FINAL_TABLE_BEFORE="$(read_count "$FINAL_TABLE_COUNT_SQL")"
echo "LEGACY_FINAL_REMINDER_MIGRATION_REVERT_BEFORE final_table=$FINAL_TABLE_BEFORE controls_table=$(read_count "$CONTROLS_TABLE_COUNT_SQL") ledger=$(read_count "$LEDGER_COUNT_SQL")"

TX_ID="$(begin_transaction)"
[[ -n "$TX_ID" ]]
COMMITTED=false
trap '[[ "$COMMITTED" == true ]] || rollback_transaction "$TX_ID"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
data_api --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-legacy-final-reminder-$MIGRATION_NAME')::bigint)" >/dev/null
read_count_tx() { data_api --transaction-id "$TX_ID" --sql "$1" --output json | jq -r '.records[0][0].longValue'; }
if [[ "$FINAL_TABLE_BEFORE" == 1 ]]; then
  # No sweep or admin action can hand a final reminder to the worker between the count and the drop.
  data_api --transaction-id "$TX_ID" --sql "LOCK TABLE public.legacy_profile_invite_final_reminders IN ACCESS EXCLUSIVE MODE" >/dev/null
  HANDED="$(read_count_tx "$HANDED_TO_WORKER_SQL")"
  echo "LEGACY_FINAL_REMINDER_MIGRATION_REVERT_HANDED_TO_WORKER=$HANDED"
  [[ "$HANDED" == 0 ]] || { echo "Final reminders were already handed to the worker; refusing revert (nothing was changed)." >&2; exit 1; }
fi
data_api --transaction-id "$TX_ID" --sql "DROP TABLE IF EXISTS public.legacy_profile_invite_final_reminders" >/dev/null
data_api --transaction-id "$TX_ID" --sql "DROP TABLE IF EXISTS public.legacy_final_reminder_controls" >/dev/null
data_api --transaction-id "$TX_ID" --sql "DELETE FROM public.sea_n_shore_applied_migrations WHERE name='$MIGRATION_NAME'" >/dev/null
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
COMMITTED=true

[[ "$(read_count "$FINAL_TABLE_COUNT_SQL")" == 0 ]] || { echo "Table legacy_profile_invite_final_reminders is still present after the revert." >&2; exit 1; }
[[ "$(read_count "$CONTROLS_TABLE_COUNT_SQL")" == 0 ]] || { echo "Table legacy_final_reminder_controls is still present after the revert." >&2; exit 1; }
[[ "$(read_count "$LEDGER_COUNT_SQL")" == 0 ]] || { echo "The ledger still lists $MIGRATION_NAME after the revert." >&2; exit 1; }
echo "LEGACY_FINAL_REMINDER_MIGRATION_REVERT_VERIFIED=true"
