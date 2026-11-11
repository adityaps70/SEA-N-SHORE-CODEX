#!/usr/bin/env bash
# Round DB: prints the ALB's CloudWatch dimension value (app/sea-n-shore-staging-alb/<id>) for the load test monitor.
# The GitHub role may only read metrics (cloudwatch:GetMetricStatistics), not describe load balancers, so the one
# read-only lookup runs on the bootstrap host through SSM. Prints the dimension value only.
set -euo pipefail
AWS_REGION="${AWS_REGION:-ap-south-1}"
IDS=$(aws ec2 describe-instances --region "$AWS_REGION" --filters "Name=tag:Name,Values=sea-n-shore-bootstrap" "Name=instance-state-name,Values=running" --query 'Reservations[].Instances[].InstanceId' --output json)
[[ "$(jq 'length' <<<"$IDS")" -eq 1 ]] || { echo "Expected exactly one running bootstrap." >&2; exit 1; }
INSTANCE_ID="$(jq -r '.[0]' <<<"$IDS")"
LOOKUP="aws elbv2 describe-load-balancers --region $AWS_REGION --names sea-n-shore-staging-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text"
PARAMETERS="$(jq -nc --arg c "runuser -u ssm-user -- bash -lc $(printf '%q' "$LOOKUP")" '{executionTimeout: ["120"], commands: [$c]}')"
COMMAND_ID=$(aws ssm send-command --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --comment "Sea N Shore load test ALB metric dimension (read-only)" --timeout-seconds 120 --parameters "$PARAMETERS" --query 'Command.CommandId' --output text)
for attempt in $(seq 1 40); do
  STATUS=$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Pending|InProgress|Delayed) sleep 3 ;; *) break ;; esac
done
ARN="$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query StandardOutputContent --output text | tr -d '[:space:]')"
DIMENSION="${ARN#*:loadbalancer/}"
[[ "$DIMENSION" =~ ^app/sea-n-shore-staging-alb/[0-9a-f]{16}$ ]] || { echo "Could not read the ALB's metric dimension." >&2; exit 1; }
printf '%s\n' "$DIMENSION"
