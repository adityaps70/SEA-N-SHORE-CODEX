#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
EVENT_BUS_NAME="sea-n-shore-staging-social-events"
QUEUE_NAME="sea-n-shore-staging-notification-events"
DLQ_NAME="sea-n-shore-staging-notification-events-dlq"
ECS_CLUSTER="sea-n-shore-staging"
OUTBOX_SERVICE="sea-n-shore-staging-outbox-worker"
NOTIFICATION_SERVICE="sea-n-shore-staging-notification-worker"
IMAGE_TAG_FILE="scripts/aws/social-events-image-tag.txt"

[[ "${SOCIAL_EVENT_PARITY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SOCIAL_EVENT_PARITY_EXPECTED_SHA must be an exact 40-character commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SOCIAL_EVENT_PARITY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws infra/aws src/features/events src/features/notifications src/features/network
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

EXPECTED_IMAGE_TAG="$(tr -d '[:space:]' < "$IMAGE_TAG_FILE")"
[[ "$EXPECTED_IMAGE_TAG" =~ ^social-[0-9a-f]{40}$ ]]

echo "READ_ONLY_AUDIT=true"

if ! aws events describe-event-bus --region "$AWS_REGION" --name "$EVENT_BUS_NAME" >/dev/null 2>&1; then
  echo "SOCIAL_EVENT_INFRA_PRESENT=false"
  exit 0
fi
echo "SOCIAL_EVENT_INFRA_PRESENT=true"

QUEUE_URL="$(aws sqs get-queue-url --region "$AWS_REGION" --queue-name "$QUEUE_NAME" --query QueueUrl --output text)"
DLQ_URL="$(aws sqs get-queue-url --region "$AWS_REGION" --queue-name "$DLQ_NAME" --query QueueUrl --output text)"

queue_attr() {
  local url="$1" attr="$2"
  aws sqs get-queue-attributes --region "$AWS_REGION" --queue-url "$url" --attribute-names "$attr" --query "Attributes.${attr}" --output text
}

echo "SOCIAL_QUEUE_VISIBLE=$(queue_attr "$QUEUE_URL" ApproximateNumberOfMessages)"
echo "SOCIAL_QUEUE_IN_FLIGHT=$(queue_attr "$QUEUE_URL" ApproximateNumberOfMessagesNotVisible)"
echo "SOCIAL_DLQ_VISIBLE=$(queue_attr "$DLQ_URL" ApproximateNumberOfMessages)"

SERVICES_JSON="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$OUTBOX_SERVICE" "$NOTIFICATION_SERVICE" --output json)"
for service in "$OUTBOX_SERVICE" "$NOTIFICATION_SERVICE"; do
  normalized="$(tr '[:lower:]-' '[:upper:]_' <<<"$service")"
  desired="$(jq -r --arg name "$service" '.services[] | select(.serviceName==$name) | .desiredCount // 0' <<<"$SERVICES_JSON")"
  running="$(jq -r --arg name "$service" '.services[] | select(.serviceName==$name) | .runningCount // 0' <<<"$SERVICES_JSON")"
  pending="$(jq -r --arg name "$service" '.services[] | select(.serviceName==$name) | .pendingCount // 0' <<<"$SERVICES_JSON")"
  echo "${normalized}_DESIRED=$desired"
  echo "${normalized}_RUNNING=$running"
  echo "${normalized}_PENDING=$pending"
  [[ "$desired" == "1" && "$running" == "1" && "$pending" == "0" ]] || {
    echo "Worker service is not stable: $service desired=$desired running=$running pending=$pending" >&2
    exit 1
  }
done

strong_error_count() {
  local log_group="$1"
  local output_file="$2"
  local start_ms
  start_ms=$(( ( $(date +%s) - 7200 ) * 1000 ))

  aws logs filter-log-events \
    --region "$AWS_REGION" \
    --log-group-name "$log_group" \
    --start-time "$start_ms" \
    --output json > "$output_file"

  jq -r '.events[].message' "$output_file" \
    | grep -Eai '(^|[^[:alpha:]])(error|exception|unhandled|fatal|ECONNREFUSED|ETIMEDOUT|AccessDenied|password authentication failed|database[^[:cntrl:]]*(failed|error)|HTTP[[:space:]]+5[0-9][0-9])([^[:alpha:]]|$)' \
    | wc -l \
    | tr -d ' ' \
    || true
}

audit_worker_runtime() {
  local service="$1"
  local kind="$2"
  local task_arn task_json image log_group match_count mode

  task_arn="$(jq -r --arg name "$service" '.services[] | select(.serviceName==$name) | .taskDefinition // empty' <<<"$SERVICES_JSON")"
  [[ -n "$task_arn" ]]

  task_json="$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$task_arn" --query taskDefinition --output json)"
  image="$(jq -r '.containerDefinitions[0].image // empty' <<<"$task_json")"
  [[ -n "$image" ]]
  [[ "$image" == *":$EXPECTED_IMAGE_TAG" ]] || {
    echo "Unexpected live worker image for $service: $image" >&2
    exit 1
  }

  log_group="$(jq -r '.containerDefinitions[0].logConfiguration.options["awslogs-group"] // empty' <<<"$task_json")"
  [[ -n "$log_group" ]] || {
    echo "Missing CloudWatch log group for $service" >&2
    exit 1
  }

  if [[ "$kind" == "OUTBOX" ]]; then
    echo "SOCIAL_OUTBOX_WORKER_IMAGE=$image"
  else
    echo "SOCIAL_NOTIFICATION_WORKER_IMAGE=$image"
    mode="$(jq -r '[.containerDefinitions[0].environment[]? | select(.name=="SOCIAL_NOTIFICATION_MODE") | .value][0] // empty' <<<"$task_json")"
    echo "SOCIAL_NOTIFICATION_MODE=$mode"
    [[ "$mode" == "shadow" ]] || {
      echo "Notification worker must remain in shadow mode; found '$mode'." >&2
      exit 1
    }
  fi

  match_count="$(strong_error_count "$log_group" "/tmp/social-${kind,,}-worker-logs.json")"
  if [[ "$kind" == "OUTBOX" ]]; then
    echo "SOCIAL_OUTBOX_STRONG_RUNTIME_ERROR_MATCHES=$match_count"
  else
    echo "SOCIAL_NOTIFICATION_STRONG_RUNTIME_ERROR_MATCHES=$match_count"
  fi

  if (( match_count > 1 )); then
    echo "Repeating strong runtime error signatures detected for $service in the last two hours." >&2
    jq -r '.events[].message' "/tmp/social-${kind,,}-worker-logs.json" \
      | grep -Eai '(^|[^[:alpha:]])(error|exception|unhandled|fatal|ECONNREFUSED|ETIMEDOUT|AccessDenied|password authentication failed|database[^[:cntrl:]]*(failed|error)|HTTP[[:space:]]+5[0-9][0-9])([^[:alpha:]]|$)' \
      | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[redacted-email]/g' \
      | head -n 10 >&2
    exit 1
  fi
}

audit_worker_runtime "$OUTBOX_SERVICE" OUTBOX
audit_worker_runtime "$NOTIFICATION_SERVICE" NOTIFICATION

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ -n "$CLUSTER_ARN" && -n "$SECRET_ARN" ]]

sql_scalar() {
  local sql="$1"
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --sql "$sql" \
    --output json | jq -r '.records[0][0].longValue // .records[0][0].stringValue // 0'
}

SCHEMA_TABLE_COUNT="$(sql_scalar "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('event_outbox','notification_event_receipts')")"
if [[ "$SCHEMA_TABLE_COUNT" != "2" ]]; then
  echo "SOCIAL_EVENT_SCHEMA_PRESENT=false"
  exit 0
fi
echo "SOCIAL_EVENT_SCHEMA_PRESENT=true"

OUTBOX_TOTAL="$(sql_scalar "SELECT count(*)::bigint FROM public.event_outbox")"
OUTBOX_PUBLISHED="$(sql_scalar "SELECT count(*)::bigint FROM public.event_outbox WHERE published_at IS NOT NULL")"
OUTBOX_UNPUBLISHED="$(sql_scalar "SELECT count(*)::bigint FROM public.event_outbox WHERE published_at IS NULL")"
OUTBOX_FAILED="$(sql_scalar "SELECT count(*)::bigint FROM public.event_outbox WHERE published_at IS NULL AND attempts > 0")"
RECEIPTS_TOTAL="$(sql_scalar "SELECT count(*)::bigint FROM public.notification_event_receipts")"
RECEIPTS_SHADOW="$(sql_scalar "SELECT count(*)::bigint FROM public.notification_event_receipts WHERE processing_mode='shadow'")"
RECEIPTS_ACTIVE="$(sql_scalar "SELECT count(*)::bigint FROM public.notification_event_receipts WHERE processing_mode='active'")"
MISSING_RECEIPTS="$(sql_scalar "SELECT count(*)::bigint FROM public.event_outbox e LEFT JOIN public.notification_event_receipts r ON r.event_id=e.id WHERE e.published_at IS NOT NULL AND r.event_id IS NULL")"

# Only compare synchronous notifications that should still exist. A connection-request
# notification is intentionally deleted after that connection is accepted/declined.
SEMANTIC_MISSING="$(sql_scalar "
SELECT count(*)::bigint
FROM public.event_outbox e
JOIN public.notification_event_receipts r ON r.event_id=e.id AND r.processing_mode='shadow'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.notifications n
  WHERE n.recipient_id=(e.payload->>'targetId')::uuid
    AND n.actor_id=(e.payload->>'actorId')::uuid
    AND n.notification_type::text = CASE e.event_type
      WHEN 'user.followed' THEN 'new_follower'
      WHEN 'connection.requested' THEN 'connection_request'
      WHEN 'connection.accepted' THEN 'connection_accepted'
    END
    AND (e.event_type='user.followed' OR n.connection_id=(e.payload->>'connectionId')::uuid)
    AND n.created_at >= e.occurred_at - interval '5 seconds'
)
AND NOT (
  e.event_type='connection.requested'
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.id=(e.payload->>'connectionId')::uuid AND c.status <> 'pending'
  )
)")"

echo "SOCIAL_OUTBOX_TOTAL=$OUTBOX_TOTAL"
echo "SOCIAL_OUTBOX_PUBLISHED=$OUTBOX_PUBLISHED"
echo "SOCIAL_OUTBOX_UNPUBLISHED=$OUTBOX_UNPUBLISHED"
echo "SOCIAL_OUTBOX_FAILED=$OUTBOX_FAILED"
echo "SOCIAL_RECEIPTS_TOTAL=$RECEIPTS_TOTAL"
echo "SOCIAL_RECEIPTS_SHADOW=$RECEIPTS_SHADOW"
echo "SOCIAL_RECEIPTS_ACTIVE=$RECEIPTS_ACTIVE"
echo "SOCIAL_PUBLISHED_MISSING_RECEIPTS=$MISSING_RECEIPTS"
echo "SOCIAL_SHADOW_SEMANTIC_MISSING=$SEMANTIC_MISSING"
echo "SOCIAL_EVENT_PARITY_AUDIT_COMPLETE=true"
