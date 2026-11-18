#!/usr/bin/env bash
# Round ARCH (Phase 1): from the load test workflow (GitHub runner, OIDC role), asks the bootstrap host to run the
# load-test accounts worker for this run: create-once, sessions (with the run's public key), sign-out or delete-once. The host runs
# scripts/aws/load-test-accounts.sh from the exact commit (CI checkout bundle). Prints the host's output lines, which
# carry counts and the build's action ids, never a token. For sessions, the task stores the sealed sessions as the run's
# one hand-off object (infra/aws/app/load-test-handoff.tf), which the runner reads and deletes itself.
#   bash scripts/aws/load-test-host-command.sh <create-once|sessions|sign-out|delete-once> <sha> <run-id> [public-key-base64 object-key]
set -euo pipefail
MODE="$1" SHA="$2" RUN_ID="$3" PUBLIC_KEY="${4:-}" OBJECT_KEY="${5:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
case "$MODE" in create-once|sessions|sign-out|delete-once) ;; *) echo "Unsupported mode." >&2; exit 1 ;; esac
[[ "$SHA" =~ ^[0-9a-f]{40}$ && "$RUN_ID" =~ ^[0-9]{6,20}$ ]] || { echo "SHA and run id are required." >&2; exit 1; }
if [[ "$MODE" == sessions ]]; then
  [[ "$PUBLIC_KEY" =~ ^[A-Za-z0-9+/=]{300,2000}$ ]] || { echo "The public key is required." >&2; exit 1; }
  [[ "$OBJECT_KEY" =~ ^sessions/[0-9]{6,20}-[0-9]{1,3}\.sealed$ ]] || { echo "The hand-off object key is required." >&2; exit 1; }
fi

IDS=$(aws ec2 describe-instances --region "$AWS_REGION" --filters "Name=tag:Name,Values=sea-n-shore-bootstrap" "Name=instance-state-name,Values=running" --query 'Reservations[].Instances[].InstanceId' --output json)
[[ "$(jq 'length' <<<"$IDS")" -eq 1 ]] || { echo "Expected exactly one running bootstrap." >&2; exit 1; }
INSTANCE_ID="$(jq -r '.[0]' <<<"$IDS")"

bash "$GITHUB_WORKSPACE/scripts/aws/ci-checkout.sh" publish "$SHA"
python3 - "$SHA" "$MODE" "$RUN_ID" "$PUBLIC_KEY" "$OBJECT_KEY" > /tmp/load-test-ssm.json <<'PYTHON'
import json, os, shlex, sys
sys.path.insert(0, os.path.join(os.environ["GITHUB_WORKSPACE"], "scripts", "aws"))
from ci_checkout import host_checkout
sha, mode, run_id, public_key, object_key = sys.argv[1:6]
script = f"""set -euo pipefail
umask 077
WORK_DIR=$(mktemp -d /var/tmp/sea-n-shore-load-test.XXXXXXXX)
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
{host_checkout('$WORK_DIR', sha)}
export LOAD_TEST_ACCOUNTS_EXPECTED_SHA={sha}
export LOAD_TEST_SESSIONS_MODE={mode}
export LOAD_TEST_RUN_ID={run_id}
export LOAD_TEST_SESSIONS_PUBLIC_KEY={shlex.quote(public_key)}
export LOAD_TEST_SESSIONS_OBJECT_KEY={shlex.quote(object_key)}
bash scripts/aws/load-test-accounts.sh
"""
print(json.dumps({"executionTimeout": ["1800"], "commands": ["runuser -u ssm-user -- bash -lc " + shlex.quote(script)]}))
PYTHON
COMMAND_ID=$(aws ssm send-command --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --comment "Sea N Shore load test $MODE $RUN_ID" --timeout-seconds 1800 --parameters file:///tmp/load-test-ssm.json --query 'Command.CommandId' --output text)
rm -f /tmp/load-test-ssm.json
# 1,000 accounts take a few minutes per step: wait up to 30.
for attempt in $(seq 1 360); do
  STATUS=$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Pending|InProgress|Delayed) sleep 5 ;; *) break ;; esac
done
aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --output json > /tmp/load-test-ssm-result.json
jq -r '.StandardOutputContent // empty' /tmp/load-test-ssm-result.json
STDERR_CONTENT=$(jq -r '.StandardErrorContent // empty' /tmp/load-test-ssm-result.json)
[[ -z "$STDERR_CONTENT" ]] || printf '%s\n' "$STDERR_CONTENT" >&2
[[ "$(jq -r '.Status' /tmp/load-test-ssm-result.json)" == Success ]]
