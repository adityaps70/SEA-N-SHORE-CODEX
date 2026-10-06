#!/usr/bin/env bash
# Runs scripts/aws/onboarding-e2e-sea-job.sh <create|cleanup> on the bootstrap instance through SSM,
# at the exact commit under test, and prints its output. Used by the onboarding E2E workflow.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in create|cleanup) ;; *) echo "Usage: onboarding-e2e-sea-job-ssm.sh create|cleanup" >&2; exit 1 ;; esac
[[ "${TRIGGER_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "${INSTANCE_ID:-}" =~ ^i-[0-9a-f]+$ ]]
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
[[ "${E2E_RECRUITER_EMAIL:-}" =~ ^sea-n-shore-e2e-${GITHUB_RUN_ID}-recruiter@example\.com$ ]]

PARAMS_FILE="$(mktemp)"
RESULT_FILE="$(mktemp)"
trap 'rm -f -- "$PARAMS_FILE" "$RESULT_FILE"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

bash "$GITHUB_WORKSPACE/scripts/aws/ci-checkout.sh" publish "$TRIGGER_SHA"
python3 - "$MODE" "$TRIGGER_SHA" "$GITHUB_RUN_ID" "$E2E_RECRUITER_EMAIL" > "$PARAMS_FILE" <<'PYTHON'
import json, shlex, sys
import os, sys; sys.path.insert(0, os.path.join(os.environ["GITHUB_WORKSPACE"], "scripts", "aws")); from ci_checkout import host_checkout
mode, sha, run_id, email = sys.argv[1:]
script = f"""set -euo pipefail
umask 077
WORK_DIR=$(mktemp -d /var/tmp/sea-n-shore-e2e-sea-job.XXXXXXXX)
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
{host_checkout('$WORK_DIR', sha)}
export ONBOARDING_E2E_EXPECTED_SHA={sha}
export E2E_RUN_ID={shlex.quote(run_id)}
export E2E_RECRUITER_EMAIL={shlex.quote(email)}
bash scripts/aws/onboarding-e2e-sea-job.sh {mode}
"""
print(json.dumps({"executionTimeout": ["300"], "commands": ["runuser -u ssm-user -- bash -lc " + shlex.quote(script)]}))
PYTHON

COMMAND_ID="$(aws ssm send-command --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --comment "Sea N Shore onboarding E2E temporary sea job $MODE $TRIGGER_SHA" --timeout-seconds 300 \
  --parameters "file://$PARAMS_FILE" --query 'Command.CommandId' --output text)"
[[ -n "$COMMAND_ID" ]]

for attempt in $(seq 1 60); do
  STATUS="$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in Pending|InProgress|Delayed) sleep 5 ;; *) break ;; esac
done
aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --output json > "$RESULT_FILE"
jq -r '.StandardOutputContent // empty' "$RESULT_FILE"
STDERR_CONTENT="$(jq -r '.StandardErrorContent // empty' "$RESULT_FILE")"
[[ -z "$STDERR_CONTENT" ]] || { echo "=== TEMPORARY SEA JOB ($MODE) STDERR ===" >&2; printf '%s\n' "$STDERR_CONTENT" >&2; }
[[ "$(jq -r '.Status' "$RESULT_FILE")" == Success ]]
