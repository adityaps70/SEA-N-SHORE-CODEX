#!/usr/bin/env bash
# Guarded runner: creates the Resend delivery-event webhook for https://seanshore.in/api/email/resend/webhook and
# stores its signing secret in Secrets Manager as sea-n-shore/resend-webhook-signing (read at runtime under the
# existing sea-n-shore/resend* grant). Runs on the bootstrap host through SSM; the logic is in
# resend-delivery-webhook.py. It uses only the full-access admin key (sea-n-shore/resend-admin) and first confirms
# it can read it. Neither the key nor the signing secret is ever printed.
#
#   plan              read-only report        -> RESEND_DELIVERY_WEBHOOK_PLAN_ONLY_NO_APPLY
#   apply-once <sha>  create, store, verify   -> RESEND_DELIVERY_WEBHOOK_APPLY_VERIFIED=true
#
# Run it only after the deploy that serves the endpoint: an apply refuses while the endpoint is not live.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
ACTION_FILE="scripts/aws/resend-delivery-webhook-action.txt"

[[ "${RESEND_DELIVERY_WEBHOOK_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "RESEND_DELIVERY_WEBHOOK_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$RESEND_DELIVERY_WEBHOOK_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/resend-delivery-webhook.sh \
  scripts/aws/resend-delivery-webhook.py \
  scripts/aws/resend-delivery-webhook-action.txt \
  .github/workflows/aws-resend-delivery-webhook.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

# The workflow's arm-commit guard already proved that an armed value names the commit it arms and that this run is
# exactly that commit plus the guard file, merged by the owner.
ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in
  plan) ;;
  apply-once)
    # The branch must not have moved since the arm was merged.
    [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$RESEND_DELIVERY_WEBHOOK_EXPECTED_SHA" ]] || {
      echo "feat/aws-native-phase-0-1 moved after the arm; refusing." >&2
      exit 1
    }
    ;;
  *) echo "Unsupported Resend delivery webhook action." >&2; exit 1 ;;
esac

python3 -I scripts/aws/resend-delivery-webhook.py "$ACTION"
