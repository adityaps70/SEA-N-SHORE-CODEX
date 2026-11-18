#!/usr/bin/env bash
# Domain move (seanshore.net), Phase 0: the read-only AWS and Resend inventory, written once to the private report
# bucket. Runs on the bootstrap host through SSM; the logic is in domain-move-report-remote.py.
#
#   plan              checks only (exact commit, account); reads nothing   -> DOMAIN_MOVE_REPORT_PLAN_ONLY_NO_REPORT
#   report-once <sha> describe/get/list only, counts-only SQL, Resend GETs; one PutObject to
#                     private-reports/domain-move/phase0-<sha>.json           -> DOMAIN_MOVE_REPORT=PASS + SHA-256
#
# The repository and its Actions logs are public: stdout is PASS/FAIL, the failing stage and the checksum only.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
ACTION_FILE="scripts/aws/domain-move-report-action.txt"

[[ "${DOMAIN_MOVE_REPORT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "DOMAIN_MOVE_REPORT_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$DOMAIN_MOVE_REPORT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/domain-move-report.sh \
  scripts/aws/domain-move-report-remote.py \
  scripts/aws/domain-move-report-action.txt \
  .github/workflows/aws-domain-move-report.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

# The workflow's arm-commit guard already proved that an armed value names the commit it arms and that this run is
# exactly that commit plus the guard file, merged by the owner.
ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in
  plan)
    echo "DOMAIN_MOVE_REPORT_PLAN_ONLY_NO_REPORT"
    exit 0
    ;;
  report-once)
    # The branch must not have moved since the arm was merged.
    [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$DOMAIN_MOVE_REPORT_EXPECTED_SHA" ]] || {
      echo "feat/aws-native-phase-0-1 moved after the arm; refusing." >&2
      exit 1
    }
    ;;
  *) echo "Unsupported domain move report action." >&2; exit 1 ;;
esac

# Anything the script writes to stderr could reach the public log; it reports through stdout lines only.
python3 -I scripts/aws/domain-move-report-remote.py 2>/dev/null
