#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="sea-n-shore-staging"
SERVICE="sea-n-shore-staging-web"
BUCKET="sea-n-shore-staging-310356785722-media"
KEY="private-migrations/beaufortmarine.sql"
EXPECTED_BYTES="13693941"
EXPECTED_SHA256="f2a2b6b537b5ec1a373ec656409828d889a294aa3a0c7f5895165c1103430efd"
ACTION_FILE="scripts/aws/legacy-user-import-action.txt"

[[ "${LEGACY_USER_IMPORT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LEGACY_USER_IMPORT_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LEGACY_USER_IMPORT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$0" "$ACTION_FILE" scripts/migration/beaufortmarine-import.mjs infra/aws/database/migrations/0058_legacy_profile_claims.sql
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
if [[ -n "${LEGACY_USER_IMPORT_ACTION:-}" ]]; then ACTION="$(tr -d '[:space:]' <<<"$LEGACY_USER_IMPORT_ACTION")"; fi
case "$ACTION" in plan|import-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

SERVICE_JSON="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json)"
TASKDEF="$(jq -r '.services[0].taskDefinition // empty' <<<"$SERVICE_JSON")"
[[ -n "$TASKDEF" ]]
RUNNING="$(jq -r '.services[0].runningCount // 0' <<<"$SERVICE_JSON")"
[[ "$RUNNING" -ge 1 ]] || { echo "Staging web service has no running task." >&2; exit 1; }

OBJECT_PRESENT=false
if aws s3api head-object --region "$AWS_REGION" --bucket "$BUCKET" --key "$KEY" >/tmp/legacy-object.json 2>/dev/null; then
  OBJECT_PRESENT=true
  SIZE="$(jq -r '.ContentLength' /tmp/legacy-object.json)"
  [[ "$SIZE" == "$EXPECTED_BYTES" ]] || { echo "Legacy SQL object size mismatch: $SIZE" >&2; exit 1; }
fi

echo "LEGACY_USER_IMPORT_PLAN_VERIFIED=true"
echo "LEGACY_USER_IMPORT_OBJECT_PRESENT=$OBJECT_PRESENT"
echo "LEGACY_USER_IMPORT_EXPECTED_BYTES=$EXPECTED_BYTES"
echo "LEGACY_USER_IMPORT_EXPECTED_SHA256=$EXPECTED_SHA256"

if [[ "$ACTION" == "plan" ]]; then
  echo "LEGACY_USER_IMPORT_PLAN_ONLY_NO_APPLY=true"
  exit 0
fi

[[ "$OBJECT_PRESENT" == true ]] || { echo "Legacy SQL object has not been uploaded." >&2; exit 1; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEGACY_USER_IMPORT_EXPECTED_SHA" ]]

# Ensure the claim bridge exists before the data task runs.
export LEGACY_PROFILE_CLAIMS_EXPECTED_SHA="$LEGACY_USER_IMPORT_EXPECTED_SHA"
export LEGACY_PROFILE_CLAIMS_MIGRATION_ACTION="migrate-once"
# The claim table is already applied; the migration script is idempotent and verifies it before import.
bash scripts/aws/legacy-profile-claims-migration.sh

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$TASKDEF" --query taskDefinition --output json > "$WORK/current.json"
jq --arg BUCKET "$BUCKET" --arg KEY "$KEY" --arg HASH "$EXPECTED_SHA256" --arg BYTES "$EXPECTED_BYTES" '
  del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy)
  | .family = "sea-n-shore-staging-legacy-import"
  | .containerDefinitions |= map(
      if .name == "web" then
        .command = ["node","scripts/migration/beaufortmarine-import.mjs"]
        | del(.healthCheck)
        | .environment = (
            ((.environment // []) | map(select(
              .name != "LEGACY_S3_BUCKET" and .name != "LEGACY_S3_KEY"
              and .name != "LEGACY_EXPECTED_SHA256" and .name != "LEGACY_EXPECTED_BYTES"
              and .name != "LEGACY_IMPORT_MODE" and .name != "LEGACY_IMPORT_CONFIRM"
            )))
            + [
              {"name":"LEGACY_S3_BUCKET","value":$BUCKET},
              {"name":"LEGACY_S3_KEY","value":$KEY},
              {"name":"LEGACY_EXPECTED_SHA256","value":$HASH},
              {"name":"LEGACY_EXPECTED_BYTES","value":$BYTES},
              {"name":"LEGACY_IMPORT_MODE","value":"apply"},
              {"name":"LEGACY_IMPORT_CONFIRM","value":"I_APPROVE_LEGACY_PROFILE_IMPORT"}
            ]
          )
      else . end
    )
' "$WORK/current.json" > "$WORK/import-task.json"

IMPORT_TASKDEF="$(aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "file://$WORK/import-task.json" --query 'taskDefinition.taskDefinitionArn' --output text)"
[[ -n "$IMPORT_TASKDEF" ]]

NETWORK="$(jq -c '.services[0].networkConfiguration' <<<"$SERVICE_JSON")"
START_MS="$(( $(date +%s) * 1000 ))"
TASK_ARN="$(aws ecs run-task --region "$AWS_REGION" --cluster "$CLUSTER" --task-definition "$IMPORT_TASKDEF" --launch-type FARGATE --network-configuration "$NETWORK" --count 1 --query 'tasks[0].taskArn' --output text)"
[[ "$TASK_ARN" == arn:aws:ecs:* ]]
TASK_ID="${TASK_ARN##*/}"
echo "LEGACY_USER_IMPORT_TASK_ID=$TASK_ID"

aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
TASK_JSON="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json)"
EXIT_CODE="$(jq -r '.tasks[0].containers[] | select(.name=="web") | .exitCode // -1' <<<"$TASK_JSON")"
STOP_REASON="$(jq -r '.tasks[0].stoppedReason // empty' <<<"$TASK_JSON")"
echo "LEGACY_USER_IMPORT_EXIT_CODE=$EXIT_CODE"
[[ "$EXIT_CODE" == "0" ]] || { echo "Import task failed: $STOP_REASON" >&2; exit 1; }

LOG_GROUP="/ecs/sea-n-shore-staging/web"
LOG_STREAM="web/web/$TASK_ID"
for attempt in $(seq 1 30); do
  STREAM_COUNT="$(aws logs describe-log-streams --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --log-stream-name-prefix "$LOG_STREAM" --query 'length(logStreams)' --output text 2>/dev/null || echo 0)"
  [[ "$STREAM_COUNT" -ge 1 ]] && break
  sleep 2
done
LOGS="$(aws logs get-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --start-from-head --query 'events[].message' --output text 2>/dev/null || true)"
printf '%s\n' "$LOGS" | tail -n 120
grep -q '"peopleEligibleForAutomaticImport": 4557' <<<"$LOGS"
grep -q '"sourceSha256": "f2a2b6b537b5ec1a373ec656409828d889a294aa3a0c7f5895165c1103430efd"' <<<"$LOGS"
grep -q '"failed": 0' <<<"$LOGS"

# Verify the database contains the source claims before deleting the temporary source object.
CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier sea-n-shore-staging-aurora --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn' <<<"$CLUSTER_JSON")"
CLAIMS="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --sql "SELECT count(*)::bigint FROM public.legacy_profile_claims WHERE source_system='beaufortmarine'" --output json | jq -r '.records[0][0].longValue')"
[[ "$CLAIMS" -ge 4557 ]] || { echo "Claim row verification too low: $CLAIMS" >&2; exit 1; }

aws s3api delete-object --region "$AWS_REGION" --bucket "$BUCKET" --key "$KEY" >/dev/null
echo "LEGACY_USER_IMPORT_CLAIM_ROWS=$CLAIMS"
echo "LEGACY_USER_IMPORT_SOURCE_OBJECT_DELETED=true"
echo "LEGACY_USER_IMPORT_APPLY_VERIFIED=true"
