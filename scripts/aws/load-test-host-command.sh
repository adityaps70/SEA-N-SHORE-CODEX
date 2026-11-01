#!/usr/bin/env bash
# Round ARCH (Phase 1): from the load test workflow (GitHub runner, OIDC role), asks the bootstrap host to run the
# load-test accounts worker for this run: "sessions" (with the run's public key) or "sign-out". The host runs
# scripts/aws/load-test-accounts.sh from the exact commit (CI checkout bundle). Prints the host's output lines, which
# carry counts, a short-lived link to the sealed sessions and the build's action ids, never a token.
#   bash scripts/aws/load-test-host-command.sh <sessions|sign-out> <sha> <run-id> [public-key-base64]
set -euo pipefail
MODE="$1" SHA="$2" RUN_ID="$3" PUBLIC_KEY="${4:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
case "$MODE" in sessions|sign-out) ;; *) echo "Unsupported mode." >&2; exit 1 ;; esac
[[ "$SHA" =~ ^[0-9a-f]{40}$ && "$RUN_ID" =~ ^[0-9]{6,20}$ ]] || { echo "SHA and run id are required." >&2; exit 1; }
if [[ "$MODE" == sessions ]]; then [[ "$PUBLIC_KEY" =~ ^[A-Za-z0-9+/=]{300,2000}$ ]] || { echo "The public key is required." >&2; exit 1; }; fi

IDS=$(aws ec2 describe-instances --region "$AWS_REGION" --filters "Name=tag:Name,Values=sea-n-shore-bootstrap" "Name=instance-state-name,Values=running" --query 'Reservations[].Instances[].InstanceId' --output json)
[[ "$(jq 'length' <<<"$IDS")" -eq 1 ]] || { echo "Expected exactly one running bootstrap." >&2; exit 1; }
INSTANCE_ID="$(jq -r '.[0]' <<<"$IDS")"

bash "$GITHUB_WORKSPACE/scripts/aws/ci-checkout.sh" publish "$SHA"
python3 - "$SHA" "$MODE" "$RUN_ID" "$PUBLIC_KEY" > /tmp/load-test-ssm.json <<'PYTHON'
import json, os, shlex, sys
sys.path.insert(0, os.path.join(os.environ["GITHUB_WORKSPACE"], "scripts", "aws"))
from ci_checkout import host_checkout
sha, mode, run_id, public_key = sys.argv[1:5]
script = f"""set -euo pipefail
umask 077
WORK_DIR=$(mktemp -d /var/tmp/sea-n-shore-load-test.XXXXXXXX)
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
{host_checkout('$WORK_DIR', sha)}
export LOAD_TEST_ACCOUNTS_EXPECTED_SHA={sha}
export LOAD_TEST_SESSIONS_MODE={mode}
export LOAD_TEST_RUN_ID={run_id}
export LOAD_TEST_SESSIONS_PUBLIC_KEY={shlex.quote(public_key)}
bash scripts/aws/load-test-accounts.sh
"""
print(json.dumps({"executionTimeout": ["900"], "commands": ["runuser -u ssm-user -- bash -lc " + shlex.quote(script)]}))
PYTHON
COMMAND_ID=$(aws ssm send-command --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --comment "Sea N Shore load test $MODE $RUN_ID" --timeout-seconds 900 --parameters file:///tmp/load-test-ssm.json --query 'Command.CommandId' --output text)
rm -f /tmp/load-test-ssm.json
for attempt in $(seq 1 180); do
  STATUS=$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Pending|InProgress|Delayed) sleep 5 ;; *) break ;; esac
done
aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --output json > /tmp/load-test-ssm-result.json
jq -r '.StandardOutputContent // empty' /tmp/load-test-ssm-result.json
STDERR_CONTENT=$(jq -r '.StandardErrorContent // empty' /tmp/load-test-ssm-result.json)
[[ -z "$STDERR_CONTENT" ]] || printf '%s\n' "$STDERR_CONTENT" >&2
[[ "$(jq -r '.Status' /tmp/load-test-ssm-result.json)" == Success ]]
