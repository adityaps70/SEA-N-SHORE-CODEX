#!/usr/bin/env bash
# Domain move (seanshore.net), Phase 1: asks Resend to verify the mail.seanshore.net sending domain, whose DKIM,
# return-path and DMARC records the domain move create step put in Route 53 (infra/aws/app/domain-move.tf). Runs on
# the bootstrap host through SSM; the logic is in resend-domain-verify.py. It uses only the full-access admin key
# (sea-n-shore/resend-admin) and never prints it. Nothing sends from mail.seanshore.net until the owner moves the From
# addresses (about two weeks after the switch); mail.seanshore.in is never touched.
#
#   plan               read only: the domain's state at Resend          -> RESEND_DOMAIN_VERIFY_PLAN_ONLY_NO_APPLY
#   verify-once <sha>  POST /domains/{id}/verify, then wait for verified -> RESEND_DOMAIN_VERIFY_APPLY_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
ACTION_FILE="scripts/aws/resend-domain-verify-action.txt"

[[ "${RESEND_DOMAIN_VERIFY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "RESEND_DOMAIN_VERIFY_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$RESEND_DOMAIN_VERIFY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/resend-domain-verify.sh \
  scripts/aws/resend-domain-verify.py \
  scripts/aws/resend-domain-verify-action.txt \
  .github/workflows/aws-resend-domain-verify.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

# The workflow's arm-commit guard already proved that an armed value names the commit it arms and that this run is
# exactly that commit plus the guard file, merged by the owner.
ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in
  plan) ;;
  verify-once)
    [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$RESEND_DOMAIN_VERIFY_EXPECTED_SHA" ]] || {
      echo "feat/aws-native-phase-0-1 moved after the arm; refusing." >&2
      exit 1
    }
    ;;
  *) echo "Unsupported Resend domain verify action." >&2; exit 1 ;;
esac

python3 -I scripts/aws/resend-domain-verify.py "$ACTION"
