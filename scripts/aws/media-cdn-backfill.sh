#!/usr/bin/env bash
# Round P3 (B7, Part D): runs the one-off media backfill (dist/workers/media-cdn-backfill.mjs, built into the
# deployed web image) as a single ECS task on the staging cluster, with the web task definition and only its
# command and one environment variable overridden. The task uses the web task's own database and bucket access.
#
# plan (read only): per kind, how many stored photos, videos and GIFs lack their CDN copy, and how many JPEG/PNG
# originals (and how many MB) are not yet re-encoded. Counts only; no key, name or file content is printed.
# apply-once: re-encodes those originals in place (same key and format, at most 2048 px, no EXIF or GPS; S3
# versioning keeps the previous version until a separately approved clean-up), writes every missing CDN copy and
# the signed probe object, then checks nothing is missing. It never deletes anything.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="sea-n-shore-staging"
SERVICE="sea-n-shore-staging-web"
LOG_GROUP="/ecs/sea-n-shore-staging/web"
ACTION_FILE="scripts/aws/media-cdn-backfill-action.txt"
WORKER="dist/workers/media-cdn-backfill.mjs"

[[ "${MEDIA_CDN_BACKFILL_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "MEDIA_CDN_BACKFILL_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$MEDIA_CDN_BACKFILL_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing." >&2; exit 1; }
git diff --quiet HEAD -- "$0" "$ACTION_FILE" || { echo "Runner files differ from the commit; refusing." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
if [[ -n "${MEDIA_CDN_BACKFILL_ACTION:-}" ]]; then ACTION="$(tr -d '[:space:]' <<<"$MEDIA_CDN_BACKFILL_ACTION")"; fi
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported media CDN backfill action: $ACTION" >&2; exit 1 ;; esac
if [[ "$ACTION" == "apply-once" ]]; then
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$MEDIA_CDN_BACKFILL_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing." >&2; exit 1; }
fi

SERVICE_JSON="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json)"
TASKDEF="$(jq -r '.services[0].taskDefinition // empty' <<<"$SERVICE_JSON")"
[[ "$TASKDEF" == arn:aws:ecs:ap-south-1:310356785722:task-definition/* ]] || { echo "Unexpected web task definition; refusing." >&2; exit 1; }
[[ "$(jq -r '.services[0].runningCount // 0' <<<"$SERVICE_JSON")" -ge 1 ]] || { echo "Staging web service has no running task; refusing." >&2; exit 1; }
IMAGE="$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$TASKDEF" --query "taskDefinition.containerDefinitions[?name=='web'].image | [0]" --output text)"
echo "MEDIA_CDN_BACKFILL_TASK_DEFINITION=${TASKDEF##*/}"
echo "MEDIA_CDN_BACKFILL_IMAGE_TAG=${IMAGE##*:}"

ENVIRONMENT="$(jq -nc --arg mode "$ACTION" '[{name:"MEDIA_CDN_BACKFILL_MODE",value:$mode}]')"
OVERRIDES="$(jq -nc --arg worker "$WORKER" --argjson environment "$ENVIRONMENT" '{containerOverrides:[{name:"web",command:["node",$worker],environment:$environment}]}')"
NETWORK="$(jq -c '.services[0].networkConfiguration' <<<"$SERVICE_JSON")"

TASK_ARN="$(aws ecs run-task --region "$AWS_REGION" --cluster "$CLUSTER" --task-definition "$TASKDEF" --launch-type FARGATE \
  --network-configuration "$NETWORK" --overrides "$OVERRIDES" --started-by "media-cdn-backfill-${ACTION}" --count 1 \
  --query 'tasks[0].taskArn' --output text)"
[[ "$TASK_ARN" == arn:aws:ecs:* ]] || { echo "The backfill task did not start." >&2; exit 1; }
TASK_ID="${TASK_ARN##*/}"
echo "MEDIA_CDN_BACKFILL_TASK_ID=$TASK_ID"

# The apply can take longer than the ECS waiter's ten minutes: poll for up to 18.
LAST_STATUS=""
for attempt in $(seq 1 216); do
  LAST_STATUS="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].lastStatus' --output text)"
  [[ "$LAST_STATUS" == STOPPED ]] && break
  sleep 5
done
[[ "$LAST_STATUS" == STOPPED ]] || { echo "The backfill task is still running after 18 minutes; check it before running again." >&2; exit 1; }
TASK_JSON="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json)"
EXIT_CODE="$(jq -r '.tasks[0].containers[] | select(.name=="web") | .exitCode // -1' <<<"$TASK_JSON")"
echo "MEDIA_CDN_BACKFILL_EXIT_CODE=$EXIT_CODE"

LOG_STREAM="web/web/$TASK_ID"
LOGS=""
for attempt in $(seq 1 30); do
  LOGS="$(aws logs get-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --start-from-head --query 'events[].message' --output text 2>/dev/null || true)"
  [[ -n "$LOGS" ]] && break
  sleep 2
done
# Only the task's own count lines (the task never prints a key, name or file content).
tr '\t' '\n' <<<"$LOGS" | grep -oE 'MEDIA_CDN_BACKFILL_[A-Z_]+([= ].*)?' || true

[[ "$EXIT_CODE" == "0" ]] || { echo "The backfill task failed: $(jq -r '.tasks[0].stoppedReason // empty' <<<"$TASK_JSON")" >&2; exit 1; }
if [[ "$ACTION" == "plan" ]]; then
  grep -q 'MEDIA_CDN_BACKFILL_PLAN_VERIFIED=true' <<<"$LOGS" || { echo "The plan report is incomplete." >&2; exit 1; }
  echo "MEDIA_CDN_BACKFILL_PLAN_ONLY_NO_APPLY"
else
  grep -q 'MEDIA_CDN_BACKFILL_COMPLETE=true' <<<"$LOGS" || { echo "The backfill did not verify complete." >&2; exit 1; }
  echo "MEDIA_CDN_BACKFILL_APPLY_VERIFIED=true"
fi
