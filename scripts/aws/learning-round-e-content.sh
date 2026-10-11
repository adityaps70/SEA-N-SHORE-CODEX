#!/usr/bin/env bash
# Learning round E: runs the one-off content task (dist/workers/learning-round-e-content.mjs, built into the deployed
# web image) as a single ECS task on the staging cluster, with the web task definition and only its command and two
# environment variables overridden. The task reads Aurora with the web task's own database access.
#
# plan (read only): the SIRE quizzes with shuffling off, test-course candidates (titles and counts only), a dry run
# of the SIRE plain-text article conversion, and video minutes for the cost notes.
# apply-once: opens a draft revision of the SIRE course as its trainer and writes the converted articles into that
# draft only. It never submits, publishes or deletes anything, and leaves an already open draft alone.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="sea-n-shore-staging"
SERVICE="sea-n-shore-staging-web"
LOG_GROUP="/ecs/sea-n-shore-staging/web"
ACTION_FILE="scripts/aws/learning-round-e-content-action.txt"
WORKER="dist/workers/learning-round-e-content.mjs"
CONFIRMATION="I_APPROVE_ROUND_E_SIRE_DRAFT_REVISION"

[[ "${LEARNING_ROUND_E_CONTENT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LEARNING_ROUND_E_CONTENT_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LEARNING_ROUND_E_CONTENT_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing." >&2; exit 1; }
git diff --quiet HEAD -- "$0" "$ACTION_FILE" || { echo "Runner files differ from the commit; refusing." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
if [[ -n "${LEARNING_ROUND_E_CONTENT_ACTION:-}" ]]; then ACTION="$(tr -d '[:space:]' <<<"$LEARNING_ROUND_E_CONTENT_ACTION")"; fi
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported round E content action: $ACTION" >&2; exit 1 ;; esac
if [[ "$ACTION" == "apply-once" ]]; then
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_ROUND_E_CONTENT_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing." >&2; exit 1; }
fi

SERVICE_JSON="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json)"
TASKDEF="$(jq -r '.services[0].taskDefinition // empty' <<<"$SERVICE_JSON")"
[[ "$TASKDEF" == arn:aws:ecs:ap-south-1:310356785722:task-definition/* ]] || { echo "Unexpected web task definition; refusing." >&2; exit 1; }
[[ "$(jq -r '.services[0].runningCount // 0' <<<"$SERVICE_JSON")" -ge 1 ]] || { echo "Staging web service has no running task; refusing." >&2; exit 1; }
IMAGE="$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$TASKDEF" --query "taskDefinition.containerDefinitions[?name=='web'].image | [0]" --output text)"
echo "LEARNING_ROUND_E_CONTENT_TASK_DEFINITION=${TASKDEF##*/}"
echo "LEARNING_ROUND_E_CONTENT_IMAGE_TAG=${IMAGE##*:}"

ENVIRONMENT="$(jq -nc --arg mode "$ACTION" '[{name:"ROUND_E_CONTENT_MODE",value:$mode}]')"
if [[ "$ACTION" == "apply-once" ]]; then
  ENVIRONMENT="$(jq -c --arg confirm "$CONFIRMATION" '. + [{name:"ROUND_E_CONTENT_CONFIRM",value:$confirm}]' <<<"$ENVIRONMENT")"
fi
OVERRIDES="$(jq -nc --arg worker "$WORKER" --argjson environment "$ENVIRONMENT" '{containerOverrides:[{name:"web",command:["node",$worker],environment:$environment}]}')"
NETWORK="$(jq -c '.services[0].networkConfiguration' <<<"$SERVICE_JSON")"

TASK_ARN="$(aws ecs run-task --region "$AWS_REGION" --cluster "$CLUSTER" --task-definition "$TASKDEF" --launch-type FARGATE \
  --network-configuration "$NETWORK" --overrides "$OVERRIDES" --started-by "round-e-content-${ACTION}" --count 1 \
  --query 'tasks[0].taskArn' --output text)"
[[ "$TASK_ARN" == arn:aws:ecs:* ]] || { echo "The content task did not start." >&2; exit 1; }
TASK_ID="${TASK_ARN##*/}"
echo "LEARNING_ROUND_E_CONTENT_TASK_ID=$TASK_ID"

aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
TASK_JSON="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json)"
EXIT_CODE="$(jq -r '.tasks[0].containers[] | select(.name=="web") | .exitCode // -1' <<<"$TASK_JSON")"
echo "LEARNING_ROUND_E_CONTENT_EXIT_CODE=$EXIT_CODE"

LOG_STREAM="web/web/$TASK_ID"
LOGS=""
for attempt in $(seq 1 30); do
  LOGS="$(aws logs get-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --start-from-head --query 'events[].message' --output text 2>/dev/null || true)"
  [[ -n "$LOGS" ]] && break
  sleep 2
done
# Only the task's own report lines (course content and counts; no learner data is ever printed by the task).
tr '\t' '\n' <<<"$LOGS" | grep -oE 'ROUND_E_[A-Z_]+([= ].*)?' || true

[[ "$EXIT_CODE" == "0" ]] || { echo "The content task failed: $(jq -r '.tasks[0].stoppedReason // empty' <<<"$TASK_JSON")" >&2; exit 1; }
if [[ "$ACTION" == "plan" ]]; then
  grep -q 'ROUND_E_CONTENT_PLAN_VERIFIED=true' <<<"$LOGS" || { echo "The plan report is incomplete." >&2; exit 1; }
  echo "LEARNING_ROUND_E_CONTENT_PLAN_VERIFIED=true"
  echo "LEARNING_ROUND_E_CONTENT_PLAN_ONLY_NO_APPLY"
else
  grep -q 'ROUND_E_CONTENT_APPLY_VERIFIED=true\|ROUND_E_CONTENT_ALREADY_APPLIED=true' <<<"$LOGS" || { echo "The draft revision was not verified." >&2; exit 1; }
  echo "LEARNING_ROUND_E_CONTENT_APPLY_VERIFIED=true"
fi
