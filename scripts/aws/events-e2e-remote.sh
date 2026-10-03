#!/usr/bin/env bash
set -euo pipefail

PHASE="${1:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
COGNITO_POOL_NAME="${COGNITO_POOL_NAME:-sea-n-shore-staging-users}"
HOST="${E2E_HOST_EMAIL:-}"
ATTENDEE="${E2E_ATTENDEE_EMAIL:-}"
EVENT_TITLE="${E2E_EVENT_TITLE:-}"
EVENT_ID="${E2E_EVENT_ID:-}"
EDITED_SUMMARY="${E2E_EDITED_SUMMARY:-}"

for EMAIL in "$HOST" "$ATTENDEE"; do
  [[ "$EMAIL" == sea-n-shore-events-e2e-* && "$EMAIL" == *@example.com ]] || { echo "Unsafe disposable Events E2E email." >&2; exit 1; }
done
[[ "$EVENT_TITLE" == "E2E Maritime Event "* ]] || { echo "Unsafe Events E2E title." >&2; exit 1; }
[[ -z "$EVENT_ID" || "$EVENT_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "Unsafe Events E2E event id." >&2; exit 1; }

resolve_pool() {
  POOL_ID=$(aws cognito-idp list-user-pools --region "$AWS_REGION" --max-results 60 --query "UserPools[?Name=='$COGNITO_POOL_NAME'].Id | [0]" --output text)
  [[ -n "$POOL_ID" && "$POOL_ID" != None ]]
}
resolve_db() {
  CLUSTER_JSON=$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier sea-n-shore-staging-aurora --output json)
  CLUSTER_ARN=$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")
  SECRET_ARN=$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")
  [[ "$CLUSTER_ARN" == 'arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora' ]]
  [[ -n "$SECRET_ARN" ]]
}
sql() { aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --sql "$1" --output json; }
profile_ids_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$HOST','$ATTENDEE')"
host_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$HOST'"
attendee_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$ATTENDEE'"
resolve_event_id() {
  resolve_db
  if [[ -z "$EVENT_ID" ]]; then
    RESULT=$(sql "SELECT e.id::text FROM public.events e WHERE e.title='$EVENT_TITLE' AND e.host_user_id=($host_id_sql) ORDER BY e.created_at DESC LIMIT 1")
    EVENT_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$RESULT")
  fi
  [[ "$EVENT_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "Events E2E event not found." >&2; exit 1; }
}

case "$PHASE" in
  confirm)
    resolve_pool
    for EMAIL in "$HOST" "$ATTENDEE"; do aws cognito-idp admin-confirm-sign-up --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL"; done
    echo 'EVENTS_E2E_CONFIRM_VERIFIED=true'
    ;;
  verify-attendance)
    resolve_event_id
    ROW=$(sql "SELECT e.status::text, e.category::text, e.event_type::text, e.format::text, e.timezone::text, e.registration_mode::text, (e.host_user_id=($host_id_sql))::text, (SELECT count(*) FROM public.event_attendees ea WHERE ea.event_id=e.id)::text, (SELECT count(*) FROM public.event_attendees ea WHERE ea.event_id=e.id AND ea.user_id=($attendee_id_sql))::text FROM public.events e WHERE e.id='$EVENT_ID'::uuid" | jq -r '.records[0] | map(.stringValue // "") | @tsv')
    [[ "$ROW" == $'published\ttraining\tmasterclass\tonline\tUTC\topen\ttrue\t1\t1' ]] || { echo "Unexpected durable attendance state: $ROW" >&2; exit 1; }
    echo 'EVENTS_E2E_ATTENDANCE_VERIFIED=true'
    ;;
  verify-withdrawal)
    resolve_event_id
    COUNT=$(sql "SELECT count(*)::text FROM public.event_attendees WHERE event_id='$EVENT_ID'::uuid" | jq -r '.records[0][0].stringValue // empty')
    [[ "$COUNT" == 0 ]]
    echo 'EVENTS_E2E_WITHDRAWAL_VERIFIED=true'
    ;;
  verify-cancelled)
    resolve_event_id
    ROW=$(sql "SELECT status::text, summary::text, (SELECT count(*) FROM public.event_attendees WHERE event_id='$EVENT_ID'::uuid)::text FROM public.events WHERE id='$EVENT_ID'::uuid" | jq -r '.records[0] | map(.stringValue // "") | @tsv')
    [[ "$ROW" == $'cancelled\t'"$EDITED_SUMMARY"$'\t0' ]] || { echo "Unexpected durable cancelled state: $ROW" >&2; exit 1; }
    echo 'EVENTS_E2E_CANCELLED_VERIFIED=true'
    ;;
  cleanup)
    resolve_db
    resolve_pool
    sql "DELETE FROM public.event_attendees WHERE event_id IN (SELECT id FROM public.events WHERE title='$EVENT_TITLE' AND host_user_id IN ($profile_ids_sql))" >/dev/null
    sql "DELETE FROM public.events WHERE title='$EVENT_TITLE' AND host_user_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.audit_events WHERE actor_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.user_roles WHERE user_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.profiles WHERE id IN ($profile_ids_sql)" >/dev/null
    LEFT=$(sql "SELECT ((SELECT count(*) FROM public.events WHERE title='$EVENT_TITLE') + (SELECT count(*) FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$HOST','$ATTENDEE')))::text" | jq -r '.records[0][0].stringValue // empty')
    [[ "$LEFT" == 0 ]] || { echo "Disposable Events E2E DB artifacts remain: $LEFT" >&2; exit 1; }
    for EMAIL in "$HOST" "$ATTENDEE"; do
      set +e
      GET=$(aws cognito-idp admin-get-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" 2>&1); STATUS=$?
      set -e
      if [[ $STATUS -eq 0 ]]; then aws cognito-idp admin-delete-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL"; elif ! grep -q UserNotFoundException <<<"$GET"; then printf '%s\n' "$GET" >&2; exit 1; fi
    done
    echo 'EVENTS_E2E_CLEANUP_VERIFIED=true'
    ;;
  *) echo "Unsupported Events E2E phase: $PHASE" >&2; exit 1 ;;
esac
