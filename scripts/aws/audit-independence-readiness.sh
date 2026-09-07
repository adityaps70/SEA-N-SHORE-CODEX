#!/usr/bin/env bash
set -euo pipefail

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
ECS_CLUSTER="${ECS_CLUSTER:-sea-n-shore-staging}"
ECS_SERVICE="${ECS_SERVICE:-sea-n-shore-staging-web}"
CLUSTER_ID="${AURORA_CLUSTER_ID:-sea-n-shore-staging-aurora}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT_ID" == "$EXPECTED_ACCOUNT" ]] || {
  echo "Unexpected AWS account: $ACCOUNT_ID" >&2
  exit 1
}

echo "=== AURORA READINESS ==="
aws rds describe-db-clusters \
  --region "$AWS_REGION" \
  --db-cluster-identifier "$CLUSTER_ID" \
  --query 'DBClusters[0].{Identifier:DBClusterIdentifier,Status:Status,BackupRetentionPeriod:BackupRetentionPeriod,StorageEncrypted:StorageEncrypted,DeletionProtection:DeletionProtection,LatestRestorableTime:LatestRestorableTime}' \
  --output json | tee /tmp/aurora-readiness.json
jq -e '.Status == "available"' /tmp/aurora-readiness.json >/dev/null
jq -e '.StorageEncrypted == true' /tmp/aurora-readiness.json >/dev/null
jq -e '.DeletionProtection == true' /tmp/aurora-readiness.json >/dev/null
LIVE_RETENTION="$(jq -r '.BackupRetentionPeriod' /tmp/aurora-readiness.json)"
test "$LIVE_RETENTION" -ge 1
echo "LIVE_AURORA_BACKUP_RETENTION_DAYS=$LIVE_RETENTION"
echo "TARGET_AURORA_BACKUP_RETENTION_DAYS=7"

echo "=== S3 READINESS ==="
for PURPOSE in media private migration; do
  case "$PURPOSE" in
    media) BUCKET="sea-n-shore-staging-${ACCOUNT_ID}-media" ;;
    private) BUCKET="sea-n-shore-staging-${ACCOUNT_ID}-private" ;;
    migration) BUCKET="sea-n-shore-staging-${ACCOUNT_ID}-migration" ;;
  esac
  STATUS="$(aws s3api get-bucket-versioning --bucket "$BUCKET" --query Status --output text)"
  [[ "$STATUS" == "Enabled" ]] || { echo "Versioning is not enabled on $BUCKET" >&2; exit 1; }
  aws s3api get-public-access-block --bucket "$BUCKET" --query 'PublicAccessBlockConfiguration' --output json > "/tmp/${PURPOSE}-pab.json"
  jq -e '.BlockPublicAcls and .IgnorePublicAcls and .BlockPublicPolicy and .RestrictPublicBuckets' "/tmp/${PURPOSE}-pab.json" >/dev/null
  aws s3api get-bucket-encryption --bucket "$BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text | grep -Eq 'AES256|aws:kms'
  echo "${PURPOSE^^}_BUCKET_RECOVERY=versioning+encryption+public-block"
done

echo "=== ECS ROLLBACK READINESS ==="
aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --output json > /tmp/service.json
CURRENT_TD="$(jq -r '.services[0].taskDefinition' /tmp/service.json)"
DESIRED="$(jq -r '.services[0].desiredCount' /tmp/service.json)"
RUNNING="$(jq -r '.services[0].runningCount' /tmp/service.json)"
PENDING="$(jq -r '.services[0].pendingCount' /tmp/service.json)"
FAMILY="$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$CURRENT_TD" --query 'taskDefinition.family' --output text)"
aws ecs list-task-definitions --region "$AWS_REGION" --family-prefix "$FAMILY" --sort DESC --max-items 5 --output json > /tmp/task-definitions.json
REVISION_COUNT="$(jq '.taskDefinitionArns | length' /tmp/task-definitions.json)"
test "$REVISION_COUNT" -ge 2 || { echo "Fewer than two ECS task revisions are available for rollback." >&2; exit 1; }
echo "CURRENT_TASK_DEFINITION=$CURRENT_TD"
echo "ECS_COUNTS=$DESIRED/$RUNNING/$PENDING"
echo "ROLLBACK_REVISIONS_VISIBLE=$REVISION_COUNT"

echo "=== ORIGIN TLS / DNS BOUNDARY ==="
CERT_COUNT="$(aws acm list-certificates --region "$AWS_REGION" --query 'length(CertificateSummaryList)' --output text)"
HTTPS_LISTENER_COUNT="$(aws elbv2 describe-load-balancers --region "$AWS_REGION" --names sea-n-shore-staging-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text | xargs -I{} aws elbv2 describe-listeners --region "$AWS_REGION" --load-balancer-arn '{}' --query 'length(Listeners[?Protocol==`HTTPS`])' --output text)"
echo "MUMBAI_ACM_CERTIFICATE_COUNT=$CERT_COUNT"
echo "ALB_HTTPS_LISTENER_COUNT=$HTTPS_LISTENER_COUNT"
echo "ORIGIN_TLS_HOSTNAME=origin-staging.seaandshore.in"
echo "READ_ONLY_AUDIT=true"
