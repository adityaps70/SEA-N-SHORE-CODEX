#!/usr/bin/env bash
# Round GP: the read-only Members by country counts (counts only), written once to the private report
# bucket. Runs on the bootstrap host through SSM; the logic is in admin-filters-report-remote.py.
#
#   plan              checks only (exact commit, account); reads nothing   -> ADMIN_FILTERS_REPORT_PLAN_ONLY_NO_REPORT
#   report-once <sha> counts-only SQL (READ ONLY, rolled back); one new PutObject to
#                     private-reports/admin-filters/counts-<sha>.json         -> ADMIN_FILTERS_REPORT=PASS + SHA-256
#
# The repository and its Actions logs are public: stdout is PASS/FAIL, the failing stage and the checksum only.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
ACTION_FILE="scripts/aws/admin-filters-report-action.txt"

[[ "${ADMIN_FILTERS_REPORT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ADMIN_FILTERS_REPORT_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ADMIN_FILTERS_REPORT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/admin-filters-report.sh \
  scripts/aws/admin-filters-report-remote.py \
  scripts/aws/admin-filters-report.sql.json \
  scripts/aws/admin-filters-report-action.txt \
  .github/workflows/aws-admin-filters-report.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

# The workflow's arm-commit guard already proved that an armed value names the commit it arms and that this run is
# exactly that commit plus the guard file, merged by the owner.
ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in
  plan)
    echo "ADMIN_FILTERS_REPORT_PLAN_ONLY_NO_REPORT"
    exit 0
    ;;
  report-once)
    # The branch must not have moved since the arm was merged.
    [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ADMIN_FILTERS_REPORT_EXPECTED_SHA" ]] || {
      echo "feat/aws-native-phase-0-1 moved after the arm; refusing." >&2
      exit 1
    }
    ;;
  *) echo "Unsupported admin filters report action." >&2; exit 1 ;;
esac

# Anything the script writes to stderr could reach the public log; it reports through stdout lines only.
python3 -I scripts/aws/admin-filters-report-remote.py 2>/dev/null
