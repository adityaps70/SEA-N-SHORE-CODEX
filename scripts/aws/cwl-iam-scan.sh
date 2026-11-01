#!/usr/bin/env bash
# CloudWatch Logs IAM change (26 April 2027): runs scripts/aws/cwl-iam-scan.py on the bootstrap host, as the host
# role, from the exact commit the workflow checked out there.
#   plan      read-only scan of the host role's policies with AWS's validator, plus the account-wide old-ARN list.
#   fix-once  adds the standard log group ARN next to each old ':*' ARN in the host role's breaking policies.
# Evidence: plan -> CWL_IAM_SCAN_VERIFIED=true then CWL_IAM_PLAN_ONLY_NO_CHANGE; fix-once -> CWL_IAM_FIX_VERIFIED=true.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
ACTION_FILE="scripts/aws/cwl-iam-scan-action.txt"
FILES=(scripts/aws/cwl-iam-scan.py scripts/aws/cwl-iam/simulate_cloudwatch_logs_policy.py "$ACTION_FILE" "$0")

[[ "${CWL_IAM_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "CWL_IAM_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$CWL_IAM_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing." >&2; exit 1; }
git diff --quiet HEAD -- "${FILES[@]}" || { echo "Runner files differ from the commit; refusing." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing." >&2; exit 1; }
[[ "$(sha256sum scripts/aws/cwl-iam/simulate_cloudwatch_logs_policy.py | cut -d' ' -f1)" == 63f689699109efd0e3a5f0ec21f06d5700669a9d67051b4b3556721bef9084aa ]] || { echo "The vendored validator changed; refusing." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|fix-once) ;; *) echo "Unsupported CloudWatch Logs IAM action: $ACTION" >&2; exit 1 ;; esac
if [[ "$ACTION" == "fix-once" ]]; then
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$CWL_IAM_EXPECTED_SHA" ]] || { echo "The feature branch moved past the approved commit; refusing." >&2; exit 1; }
fi

python3 -I scripts/aws/cwl-iam-scan.py --self-test
CWL_IAM_ACTION="$ACTION" python3 -I scripts/aws/cwl-iam-scan.py
if [[ "$ACTION" == "plan" ]]; then
  echo "CWL_IAM_PLAN_ONLY_NO_CHANGE"
fi
