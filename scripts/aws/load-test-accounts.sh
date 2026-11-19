#!/usr/bin/env bash
# Round ARCH (Phase 1): runs the load-test accounts worker (dist/workers/load-test-accounts.mjs, built into the deployed
# web image) as a single ECS task on the staging cluster, with the web task definition and only its command and one
# environment variable overridden. See src/features/load-test/accounts.ts.
#
# plan (read only): how many of the 1,000 test accounts, their follows, the hidden community and its post exist, and
#   the Cognito user pool's tier (the owner checks the free monthly users before a run).
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
# The armed signed-in load test (aws-load-test.yml, guarded by its own owner-merged arm) creates the accounts and gets
# their sessions before the run, and signs them out and deletes them after it. Each needs the run id; sessions also
# need the run's public key and its hand-off object key (sessions/<run id>-<attempt>.sealed).
if [[ -n "${LOAD_TEST_SESSIONS_MODE:-}" ]]; then
  case "$LOAD_TEST_SESSIONS_MODE" in create-once|sessions|sign-out|delete-once) ACTION="$LOAD_TEST_SESSIONS_MODE" ;; *) echo "Unsupported sessions mode." >&2; exit 1 ;; esac
  [[ "${LOAD_TEST_RUN_ID:-}" =~ ^[0-9]{6,20}$ ]] || { echo "LOAD_TEST_RUN_ID is required." >&2; exit 1; }
  if [[ "$ACTION" == sessions ]]; then
    [[ "${LOAD_TEST_SESSIONS_PUBLIC_KEY:-}" =~ ^[A-Za-z0-9+/=]{300,2000}$ ]] || { echo "The run's public key is missing." >&2; exit 1; }
    # The run's one hand-off object (infra/aws/app/load-test-handoff.tf): the task writes it, the runner reads it.
    [[ "${LOAD_TEST_SESSIONS_OBJECT_KEY:-}" =~ ^sessions/[0-9]{6,20}-[0-9]{1,3}\.sealed$ ]] || { echo "The run's hand-off object key is missing." >&2; exit 1; }
  fi
fi
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
if [[ "$ACTION" == "plan" ]]; then
  # Read only: the user pool's tier (LITE, ESSENTIALS or PLUS), never its id. The pool is the web task's own.
  POOL_ID="$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$TASKDEF" --query "taskDefinition.containerDefinitions[?name=='web'].environment[] | [?name=='AWS_COGNITO_USER_POOL_ID'].value | [0]" --output text)"
  TIER="unavailable"
  if [[ "$POOL_ID" =~ ^ap-south-1_[A-Za-z0-9]+$ ]]; then
    TIER="$(aws cognito-idp describe-user-pool --region "$AWS_REGION" --user-pool-id "$POOL_ID" --query 'UserPool.UserPoolTier' --output text 2>/dev/null || echo unavailable)"
  fi
  [[ "$TIER" =~ ^(LITE|ESSENTIALS|PLUS|None|unavailable)$ ]] || TIER=unavailable
  echo "LOAD_TEST_ACCOUNTS_COGNITO_TIER=$TIER"
fi

ENVIRONMENT="$(jq -nc --arg mode "$ACTION" --arg key "${LOAD_TEST_SESSIONS_PUBLIC_KEY:-}" --arg object "${LOAD_TEST_SESSIONS_OBJECT_KEY:-}" '[{name:"LOAD_TEST_ACCOUNTS_MODE",value:$mode}] + (if $key == "" then [] else [{name:"LOAD_TEST_SESSIONS_PUBLIC_KEY",value:$key},{name:"LOAD_TEST_SESSIONS_OBJECT_KEY",value:$object}] end)')"
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
# Every page of the task's log, oldest first. One page can hold only part of the stream (or none of it) while more is
# available through its token, so follow nextForwardToken until it stops changing.
read_task_log() {
  local token="" page next
  page="$(aws logs get-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --start-from-head --output json)"
  while :; do
    jq -r '.events[].message' <<<"$page"
    next="$(jq -r '.nextForwardToken // empty' <<<"$page")"
    [[ -n "$next" && "$next" != "$token" ]] || break
    token="$next"
    page="$(aws logs get-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --start-from-head --next-token "$token" --output json)"
  done
}
# Run 42486602879: the first non-empty read was only the start of a long sessions log. Wait until the task's own last
# line (a _VERIFIED=true marker, or its failure line) has arrived, for up to three minutes.
LOGS=""
for attempt in $(seq 1 60); do
  LOGS="$(read_task_log 2>/dev/null || true)"
  grep -qE 'LOAD_TEST_[A-Z_]+_VERIFIED=true|LOAD_TEST_ACCOUNTS_FAILED' <<<"$LOGS" && break
  sleep 3
done
# Only the task's own count lines (the task never prints a key, name or file content).
tr '\t' '\n' <<<"$LOGS" | grep -oE 'LOAD_TEST_ACCOUNTS_[A-Z_]+([= ].*)?' || true

[[ "$EXIT_CODE" == "0" ]] || { echo "The load-test accounts task failed: $(jq -r '.tasks[0].stoppedReason // empty' <<<"$TASK_JSON")" >&2; exit 1; }
if [[ "$ACTION" == "sessions" ]]; then
  # The task stored the sealed bundle as the run's hand-off object (S3, SSE-KMS); it can only be opened with the run's
  # private key, which never leaves the runner. Nothing of it is in the log: the task prints counts only.
  grep -q 'LOAD_TEST_SESSIONS_VERIFIED=true' <<<"$LOGS" || { echo "The sessions were not all created." >&2; exit 1; }
  STORED="$(tr '\t' '\n' <<<"$LOGS" | grep -oE 'LOAD_TEST_SESSIONS_STORED count=[0-9]+ bytes=[0-9]+' | head -1)"
  [[ "$STORED" =~ ^LOAD_TEST_SESSIONS_STORED\ count=1000\ bytes=[0-9]+$ ]] || { echo "The sealed sessions were not stored for all 1,000 accounts." >&2; exit 1; }
  echo "$STORED"
  tr '\t' '\n' <<<"$LOGS" | grep -oE 'LOAD_TEST_ACTIONS \{[^}]*\}' | head -1
  echo "LOAD_TEST_SESSIONS_READY=true"
  exit 0
elif [[ "$ACTION" == "sign-out" ]]; then
  grep -q 'LOAD_TEST_SIGN_OUT_VERIFIED=true' <<<"$LOGS" || { echo "The test accounts were not signed out." >&2; exit 1; }
  echo "LOAD_TEST_SIGNED_OUT=true"
  exit 0
fi
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
