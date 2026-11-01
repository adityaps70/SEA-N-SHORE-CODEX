#!/usr/bin/env bash
# Round ARCH (Phase 1): runs the load-test accounts worker (dist/workers/load-test-accounts.mjs, built into the deployed
# web image) as a single ECS task on the staging cluster, with the web task definition and only its command and one
# environment variable overridden. See src/features/load-test/accounts.ts.
#
# plan (read only): how many of the 50 test accounts, their follows, the hidden community and its post exist.
# create-once: creates whatever is missing (Cognito users on reserved .invalid addresses, never emailed; onboarded
#   profiles flagged is_load_test; follows among them only; the hidden private community and its one post).
# delete-once: deletes every flagged account, the community and their Cognito users; refuses anything unflagged.
# Prints counts and statuses only: no email, name, password or token.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="sea-n-shore-staging"
SERVICE="sea-n-shore-staging-web"
LOG_GROUP="/ecs/sea-n-shore-staging/web"
ACTION_FILE="scripts/aws/load-test-accounts-action.txt"
WORKER="dist/workers/load-test-accounts.mjs"

[[ "${LOAD_TEST_ACCOUNTS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LOAD_TEST_ACCOUNTS_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LOAD_TEST_ACCOUNTS_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing." >&2; exit 1; }
git diff --quiet HEAD -- "$0" "$ACTION_FILE" || { echo "Runner files differ from the commit; refusing." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
if [[ -n "${LOAD_TEST_ACCOUNTS_ACTION:-}" ]]; then ACTION="$(tr -d '[:space:]' <<<"$LOAD_TEST_ACCOUNTS_ACTION")"; fi
case "$ACTION" in plan|create-once|delete-once) ;; *) echo "Unsupported load-test accounts action: $ACTION" >&2; exit 1 ;; esac
if [[ "$ACTION" != "plan" ]]; then
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LOAD_TEST_ACCOUNTS_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing." >&2; exit 1; }
fi

SERVICE_JSON="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json)"
TASKDEF="$(jq -r '.services[0].taskDefinition // empty' <<<"$SERVICE_JSON")"
[[ "$TASKDEF" == arn:aws:ecs:ap-south-1:310356785722:task-definition/* ]] || { echo "Unexpected web task definition; refusing." >&2; exit 1; }
[[ "$(jq -r '.services[0].runningCount // 0' <<<"$SERVICE_JSON")" -ge 1 ]] || { echo "Staging web service has no running task; refusing." >&2; exit 1; }
IMAGE="$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$TASKDEF" --query "taskDefinition.containerDefinitions[?name=='web'].image | [0]" --output text)"
echo "LOAD_TEST_ACCOUNTS_TASK_DEFINITION=${TASKDEF##*/}"
echo "LOAD_TEST_ACCOUNTS_IMAGE_TAG=${IMAGE##*:}"

ENVIRONMENT="$(jq -nc --arg mode "$ACTION" '[{name:"LOAD_TEST_ACCOUNTS_MODE",value:$mode}]')"
OVERRIDES="$(jq -nc --arg worker "$WORKER" --argjson environment "$ENVIRONMENT" '{containerOverrides:[{name:"web",command:["node",$worker],environment:$environment}]}')"
NETWORK="$(jq -c '.services[0].networkConfiguration' <<<"$SERVICE_JSON")"

TASK_ARN="$(aws ecs run-task --region "$AWS_REGION" --cluster "$CLUSTER" --task-definition "$TASKDEF" --launch-type FARGATE \
  --network-configuration "$NETWORK" --overrides "$OVERRIDES" --started-by "load-test-accounts-${ACTION}" --count 1 \
  --query 'tasks[0].taskArn' --output text)"
[[ "$TASK_ARN" == arn:aws:ecs:* ]] || { echo "The load-test accounts task did not start." >&2; exit 1; }
TASK_ID="${TASK_ARN##*/}"
echo "LOAD_TEST_ACCOUNTS_TASK_ID=$TASK_ID"

# The apply can take longer than the ECS waiter's ten minutes: poll for up to 18.
LAST_STATUS=""
for attempt in $(seq 1 216); do
  LAST_STATUS="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].lastStatus' --output text)"
  [[ "$LAST_STATUS" == STOPPED ]] && break
  sleep 5
done
[[ "$LAST_STATUS" == STOPPED ]] || { echo "The load-test accounts task is still running after 18 minutes; check it before running again." >&2; exit 1; }
TASK_JSON="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json)"
EXIT_CODE="$(jq -r '.tasks[0].containers[] | select(.name=="web") | .exitCode // -1' <<<"$TASK_JSON")"
echo "LOAD_TEST_ACCOUNTS_EXIT_CODE=$EXIT_CODE"

LOG_STREAM="web/web/$TASK_ID"
LOGS=""
for attempt in $(seq 1 30); do
  LOGS="$(aws logs get-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --start-from-head --query 'events[].message' --output text 2>/dev/null || true)"
  [[ -n "$LOGS" ]] && break
  sleep 2
done
# Only the task's own count lines (the task never prints a key, name or file content).
tr '\t' '\n' <<<"$LOGS" | grep -oE 'LOAD_TEST_ACCOUNTS_[A-Z_]+([= ].*)?' || true

[[ "$EXIT_CODE" == "0" ]] || { echo "The load-test accounts task failed: $(jq -r '.tasks[0].stoppedReason // empty' <<<"$TASK_JSON")" >&2; exit 1; }
if [[ "$ACTION" == "plan" ]]; then
  grep -q 'LOAD_TEST_ACCOUNTS_PLAN_VERIFIED=true' <<<"$LOGS" || { echo "The plan report is incomplete." >&2; exit 1; }
  echo "LOAD_TEST_ACCOUNTS_PLAN_ONLY_NO_CHANGE"
elif [[ "$ACTION" == "create-once" ]]; then
  grep -q 'LOAD_TEST_ACCOUNTS_CREATE_VERIFIED=true' <<<"$LOGS" || { echo "The accounts were not all created." >&2; exit 1; }
  echo "LOAD_TEST_ACCOUNTS_CREATE_ONCE_VERIFIED=true"
else
  grep -q 'LOAD_TEST_ACCOUNTS_DELETE_VERIFIED=true' <<<"$LOGS" || { echo "The accounts were not all deleted." >&2; exit 1; }
  echo "LOAD_TEST_ACCOUNTS_DELETE_ONCE_VERIFIED=true"
fi
