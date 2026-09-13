#!/usr/bin/env bash
set -euo pipefail

PHASE="${1:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
COGNITO_POOL_NAME="${COGNITO_POOL_NAME:-sea-n-shore-staging-users}"
SENDER="${E2E_SENDER_EMAIL:-}"
RECIPIENT="${E2E_RECIPIENT_EMAIL:-}"
CONVERSATION_ID="${E2E_CONVERSATION_ID:-}"
MESSAGE_BODY="${E2E_MESSAGE_BODY:-}"
INJECTED_BODY="${E2E_INJECTED_BODY:-}"
RUN_STARTED_AT="${E2E_RUN_STARTED_AT:-}"
DIAGNOSTIC_START_MS="${E2E_DIAGNOSTIC_START_MS:-}"
DIAGNOSTIC_END_MS="${E2E_DIAGNOSTIC_END_MS:-}"

if [[ "$PHASE" != diagnose-connect ]]; then
  for EMAIL in "$SENDER" "$RECIPIENT"; do
    [[ "$EMAIL" == sea-n-shore-realtime-e2e-* && "$EMAIL" == *@example.com ]] || { echo "Unsafe disposable Realtime E2E email." >&2; exit 1; }
  done
fi
[[ -z "$CONVERSATION_ID" || "$CONVERSATION_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "Unsafe realtime conversation id." >&2; exit 1; }

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
sender_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$SENDER'"
recipient_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$RECIPIENT'"
profile_ids_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$SENDER','$RECIPIENT')"
resolve_conversation() {
  resolve_db
  if [[ -z "$CONVERSATION_ID" ]]; then
    RESULT=$(sql "SELECT c.id::text FROM public.conversations c WHERE c.direct_user_low_id IN ($profile_ids_sql) AND c.direct_user_high_id IN ($profile_ids_sql) ORDER BY c.created_at DESC LIMIT 1")
    CONVERSATION_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$RESULT")
  fi
  [[ "$CONVERSATION_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "Realtime E2E conversation not found." >&2; exit 1; }
}

case "$PHASE" in
  confirm)
    resolve_pool
    for EMAIL in "$SENDER" "$RECIPIENT"; do
      aws cognito-idp admin-confirm-sign-up --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL"
    done
    echo 'REALTIME_E2E_CONFIRM_VERIFIED=true'
    ;;
  prepare)
    resolve_db
    PAIR=$(sql "SELECT LEAST(($sender_id_sql)::text,($recipient_id_sql)::text), GREATEST(($sender_id_sql)::text,($recipient_id_sql)::text)" | jq -r '.records[0] | map(.stringValue // "") | @tsv')
    LOW=$(cut -f1 <<<"$PAIR"); HIGH=$(cut -f2 <<<"$PAIR")
    [[ "$LOW" =~ ^[0-9a-f-]{36}$ && "$HIGH" =~ ^[0-9a-f-]{36}$ ]]
    sql "INSERT INTO public.connections (user_low_id,user_high_id,requested_by,status,responded_at) VALUES ('$LOW'::uuid,'$HIGH'::uuid,($sender_id_sql),'accepted',now()) ON CONFLICT (user_low_id,user_high_id) DO UPDATE SET status='accepted', responded_at=now()" >/dev/null
    RESULT=$(sql "INSERT INTO public.conversations (type,direct_user_low_id,direct_user_high_id) VALUES ('direct','$LOW'::uuid,'$HIGH'::uuid) ON CONFLICT (direct_user_low_id,direct_user_high_id) DO UPDATE SET direct_user_low_id=excluded.direct_user_low_id RETURNING id::text")
    CONVERSATION_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$RESULT")
    [[ "$CONVERSATION_ID" =~ ^[0-9a-f-]{36}$ ]]
    sql "INSERT INTO public.conversation_participants (conversation_id,profile_id) VALUES ('$CONVERSATION_ID'::uuid,($sender_id_sql)),('$CONVERSATION_ID'::uuid,($recipient_id_sql)) ON CONFLICT DO NOTHING" >/dev/null
    echo "REALTIME_E2E_CONVERSATION_ID=$CONVERSATION_ID"
    echo 'REALTIME_E2E_PREPARE_VERIFIED=true'
    ;;
  verify-durable)
    resolve_conversation
    [[ -n "$MESSAGE_BODY" && -n "$INJECTED_BODY" ]]
    ROW=$(sql "SELECT (SELECT count(*) FROM public.messages WHERE conversation_id='$CONVERSATION_ID'::uuid AND body='$MESSAGE_BODY')::text,(SELECT count(*) FROM public.messages WHERE conversation_id='$CONVERSATION_ID'::uuid AND body='$INJECTED_BODY')::text,(SELECT count(*) FROM public.event_outbox WHERE event_type='message.created' AND payload->>'conversationId'='$CONVERSATION_ID')::text,(SELECT count(*) FROM public.event_outbox WHERE event_type='conversation.read_cursor_advanced' AND payload->>'conversationId'='$CONVERSATION_ID')::text,(SELECT count(*) FROM public.event_outbox WHERE payload::text LIKE '%' || '$MESSAGE_BODY' || '%')::text" | jq -r '.records[0] | map(.stringValue // "") | @tsv')
    IFS=$'\t' read -r MSG_COUNT INJECTED_COUNT CREATED_COUNT READ_COUNT LEAK_COUNT <<<"$ROW"
    [[ "$MSG_COUNT" == 1 && "$INJECTED_COUNT" == 0 ]]
    [[ "$CREATED_COUNT" -ge 1 && "$READ_COUNT" -ge 1 ]]
    [[ "$LEAK_COUNT" == 0 ]]
    echo 'REALTIME_E2E_DURABLE_MESSAGE_VERIFIED=true'
    ;;
  verify-infra)
    resolve_conversation
    TABLE='sea-n-shore-staging-realtime-connections'
    MAIN_QUEUE=$(aws sqs get-queue-url --region "$AWS_REGION" --queue-name sea-n-shore-staging-realtime-events --query QueueUrl --output text)
    DLQ=$(aws sqs get-queue-url --region "$AWS_REGION" --queue-name sea-n-shore-staging-realtime-events-dlq --query QueueUrl --output text)
    for attempt in $(seq 1 20); do
      LIVE=0
      for EMAIL in "$SENDER" "$RECIPIENT"; do
        PID=$(sql "SELECT profile_id::text FROM public.identity_accounts WHERE provider='cognito' AND email='$EMAIL'" | jq -r '.records[0][0].stringValue // empty')
        COUNT=$(aws dynamodb query --region "$AWS_REGION" --table-name "$TABLE" --index-name profile_id-index --key-condition-expression 'profile_id = :p' --expression-attribute-values "{\":p\":{\"S\":\"$PID\"}}" --select COUNT --query Count --output text)
        LIVE=$((LIVE + COUNT))
      done
      [[ "$LIVE" -eq 0 ]] && break
      sleep 3
    done
    [[ "$LIVE" -eq 0 ]] || { echo "Realtime DynamoDB connections remain: $LIVE" >&2; exit 1; }
    MAIN_ATTR=$(aws sqs get-queue-attributes --region "$AWS_REGION" --queue-url "$MAIN_QUEUE" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --output json)
    DLQ_VISIBLE=$(aws sqs get-queue-attributes --region "$AWS_REGION" --queue-url "$DLQ" --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
    [[ "$DLQ_VISIBLE" == 0 ]]
    START=${RUN_STARTED_AT:-$(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%SZ)}
    END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    for METRIC in Errors Throttles; do
      SUM=$(aws cloudwatch get-metric-statistics --region "$AWS_REGION" --namespace AWS/Lambda --metric-name "$METRIC" --dimensions Name=FunctionName,Value=sea-n-shore-staging-realtime-fanout --start-time "$START" --end-time "$END" --period 60 --statistics Sum --output json | jq '[.Datapoints[].Sum] | add // 0')
      [[ "$SUM" == 0 ]]
    done
    [[ -n "$MESSAGE_BODY" ]]
    LOG_HITS=$(aws logs filter-log-events --region "$AWS_REGION" --log-group-name /aws/lambda/sea-n-shore-staging-realtime-fanout --start-time "$(date -u -d "$START" +%s)000" --filter-pattern "\"$MESSAGE_BODY\"" --query 'events | length(@)' --output text || echo 0)
    [[ "$LOG_HITS" == 0 ]]
    jq -e '(.Attributes.ApproximateNumberOfMessages | tonumber) >= 0 and (.Attributes.ApproximateNumberOfMessagesNotVisible | tonumber) >= 0' <<<"$MAIN_ATTR" >/dev/null
    echo 'REALTIME_E2E_INFRA_HEALTH_VERIFIED=true'
    ;;
  cleanup)
    resolve_db
    resolve_pool
    TABLE_STATE=$(sql "SELECT (to_regclass('public.conversations') IS NOT NULL)::text,(to_regclass('public.conversation_participants') IS NOT NULL)::text,(to_regclass('public.messages') IS NOT NULL)::text,(to_regclass('public.event_outbox') IS NOT NULL)::text" | jq -r '.records[0] | map(.stringValue // "false") | @tsv')
    IFS=$'\t' read -r HAS_CONVERSATIONS HAS_PARTICIPANTS HAS_MESSAGES HAS_OUTBOX <<<"$TABLE_STATE"
    MESSAGING_TABLES_PRESENT=false
    if [[ "$HAS_CONVERSATIONS" == true && "$HAS_PARTICIPANTS" == true && "$HAS_MESSAGES" == true ]]; then
      MESSAGING_TABLES_PRESENT=true
    fi
    if [[ "$HAS_CONVERSATIONS" == true && -z "$CONVERSATION_ID" ]]; then
      RESULT=$(sql "SELECT c.id::text FROM public.conversations c WHERE c.direct_user_low_id IN ($profile_ids_sql) AND c.direct_user_high_id IN ($profile_ids_sql) ORDER BY c.created_at DESC LIMIT 1")
      CONVERSATION_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$RESULT")
    fi
    if [[ "$CONVERSATION_ID" =~ ^[0-9a-f-]{36}$ ]]; then
      if [[ "$HAS_OUTBOX" == true ]]; then
        if [[ "$HAS_MESSAGES" == true ]]; then
          sql "DELETE FROM public.event_outbox WHERE (aggregate_type='message' AND aggregate_id IN (SELECT id FROM public.messages WHERE conversation_id='$CONVERSATION_ID'::uuid)) OR (aggregate_type='conversation' AND aggregate_id='$CONVERSATION_ID'::uuid) OR payload->>'conversationId'='$CONVERSATION_ID'" >/dev/null
        else
          sql "DELETE FROM public.event_outbox WHERE (aggregate_type='conversation' AND aggregate_id='$CONVERSATION_ID'::uuid) OR payload->>'conversationId'='$CONVERSATION_ID'" >/dev/null
        fi
      fi
      if [[ "$HAS_MESSAGES" == true ]]; then
        sql "DELETE FROM public.messages WHERE conversation_id='$CONVERSATION_ID'::uuid" >/dev/null
      fi
      if [[ "$HAS_PARTICIPANTS" == true ]]; then
        sql "DELETE FROM public.conversation_participants WHERE conversation_id='$CONVERSATION_ID'::uuid" >/dev/null
      fi
      if [[ "$HAS_CONVERSATIONS" == true ]]; then
        sql "DELETE FROM public.conversations WHERE id='$CONVERSATION_ID'::uuid" >/dev/null
      fi
    fi
    echo "MESSAGING_TABLES_PRESENT=$MESSAGING_TABLES_PRESENT"
    sql "DELETE FROM public.notifications WHERE recipient_id IN ($profile_ids_sql) OR actor_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.follows WHERE follower_id IN ($profile_ids_sql) OR following_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.connections WHERE user_low_id IN ($profile_ids_sql) OR user_high_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.user_roles WHERE user_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.profiles WHERE id IN ($profile_ids_sql)" >/dev/null
    for EMAIL in "$SENDER" "$RECIPIENT"; do
      set +e
      GET=$(aws cognito-idp admin-get-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" 2>&1); STATUS=$?
      set -e
      if [[ $STATUS -eq 0 ]]; then
        aws cognito-idp admin-delete-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL"
      elif ! grep -q UserNotFoundException <<<"$GET"; then
        printf '%s\n' "$GET" >&2; exit 1
      fi
    done
    echo 'REALTIME_E2E_CLEANUP_VERIFIED=true'
    ;;
  diagnose-connect)
    [[ "$DIAGNOSTIC_START_MS" =~ ^[0-9]{13}$ ]]
    [[ "$DIAGNOSTIC_END_MS" =~ ^[0-9]{13}$ ]]
    (( DIAGNOSTIC_END_MS >= DIAGNOSTIC_START_MS ))
    (( DIAGNOSTIC_END_MS - DIAGNOSTIC_START_MS <= 3600000 ))
    for GROUP in \
      /aws/apigateway/sea-n-shore-staging/realtime \
      /aws/lambda/sea-n-shore-staging-realtime-authorizer \
      /aws/lambda/sea-n-shore-staging-realtime-connection
    do
      echo "REALTIME_CONNECT_DIAGNOSTIC_LOG_GROUP=$GROUP"
      aws logs filter-log-events \
        --region "$AWS_REGION" \
        --log-group-name "$GROUP" \
        --start-time "$DIAGNOSTIC_START_MS" \
        --end-time "$DIAGNOSTIC_END_MS" \
        --limit 200 \
        --query 'events[].{timestamp:timestamp,message:message}' \
        --output json
    done
    echo 'REALTIME_E2E_CONNECT_DIAGNOSTIC_VERIFIED=true'
    ;;
  *) echo "Unsupported Realtime E2E phase: $PHASE" >&2; exit 1 ;;
esac
