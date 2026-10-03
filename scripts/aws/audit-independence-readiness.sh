#!/usr/bin/env bash
set -euo pipefail
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
ECS_CLUSTER="${ECS_CLUSTER:-sea-n-shore-staging}"
ECS_SERVICE="${ECS_SERVICE:-sea-n-shore-staging-web}"
CLUSTER_ID="${AURORA_CLUSTER_ID:-sea-n-shore-staging-aurora}"
ORIGIN_HOSTNAME="origin-staging.seaandshore.in"
SES_DOMAIN="seaandshore.in"
COGNITO_POOL_ID="ap-south-1_FKyi5lJsY"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT_ID" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account: $ACCOUNT_ID" >&2; exit 1; }

echo "=== AURORA READINESS ==="
aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --query 'DBClusters[0].{Identifier:DBClusterIdentifier,Status:Status,BackupRetentionPeriod:BackupRetentionPeriod,StorageEncrypted:StorageEncrypted,DeletionProtection:DeletionProtection,LatestRestorableTime:LatestRestorableTime}' --output json | tee /tmp/aurora-readiness.json
jq -e '.Status == "available" and .StorageEncrypted == true and .DeletionProtection == true' /tmp/aurora-readiness.json >/dev/null
LIVE_RETENTION="$(jq -r '.BackupRetentionPeriod' /tmp/aurora-readiness.json)"
test "$LIVE_RETENTION" -eq 7
echo "LIVE_AURORA_BACKUP_RETENTION_DAYS=$LIVE_RETENTION"

echo "=== S3 READINESS ==="
for PURPOSE in media private migration; do
  case "$PURPOSE" in
    media) BUCKET="sea-n-shore-staging-${ACCOUNT_ID}-media" ;;
    private) BUCKET="sea-n-shore-staging-${ACCOUNT_ID}-private" ;;
    migration) BUCKET="sea-n-shore-staging-${ACCOUNT_ID}-migration" ;;
  esac
  STATUS="$(aws s3api get-bucket-versioning --bucket "$BUCKET" --query Status --output text)"
  [[ "$STATUS" == "Enabled" ]] || { echo "Versioning is not enabled on $BUCKET" >&2; exit 1; }
  aws s3api get-public-access-block --bucket "$BUCKET" --query PublicAccessBlockConfiguration --output json > "/tmp/${PURPOSE}-pab.json"
  jq -e '.BlockPublicAcls and .IgnorePublicAcls and .BlockPublicPolicy and .RestrictPublicBuckets' "/tmp/${PURPOSE}-pab.json" >/dev/null
  ENC="$(aws s3api get-bucket-encryption --bucket "$BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text)"
  grep -Eq 'AES256|aws:kms' <<<"$ENC"
  OBJECT_COUNT="$(aws s3api list-objects-v2 --bucket "$BUCKET" --query 'KeyCount' --output text)"
  echo "${PURPOSE^^}_BUCKET_RECOVERY=versioning+encryption+public-block"
  echo "${PURPOSE^^}_BUCKET_OBJECT_COUNT=$OBJECT_COUNT"
done

echo "=== ECS ROLLBACK READINESS ==="
aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --output json > /tmp/service.json
CURRENT_TD="$(jq -r '.services[0].taskDefinition' /tmp/service.json)"
DESIRED="$(jq -r '.services[0].desiredCount' /tmp/service.json)"
RUNNING="$(jq -r '.services[0].runningCount' /tmp/service.json)"
PENDING="$(jq -r '.services[0].pendingCount' /tmp/service.json)"
FAILED="$(jq -r '.services[0].deployments[0].failedTasks // 0' /tmp/service.json)"
FAMILY="$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$CURRENT_TD" --query 'taskDefinition.family' --output text)"
aws ecs list-task-definitions --region "$AWS_REGION" --family-prefix "$FAMILY" --sort DESC --max-items 5 --output json > /tmp/task-definitions.json
REVISION_COUNT="$(jq '.taskDefinitionArns | length' /tmp/task-definitions.json)"
test "$REVISION_COUNT" -ge 2
echo "CURRENT_TASK_DEFINITION=$CURRENT_TD"
echo "ECS_COUNTS=$DESIRED/$RUNNING/$PENDING"
echo "ECS_FAILED_TASKS=$FAILED"
echo "ROLLBACK_REVISIONS_VISIBLE=$REVISION_COUNT"

echo "=== ORIGIN TLS / DNS BOUNDARY ==="
ALB_ARN="$(aws elbv2 describe-load-balancers --region "$AWS_REGION" --names sea-n-shore-staging-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
HTTPS_LISTENER_COUNT="$(aws elbv2 describe-listeners --region "$AWS_REGION" --load-balancer-arn "$ALB_ARN" --query 'length(Listeners[?Protocol==`HTTPS`])' --output text)"
echo "ALB_HTTPS_LISTENER_COUNT=$HTTPS_LISTENER_COUNT"
echo "ORIGIN_TLS_HOSTNAME=$ORIGIN_HOSTNAME"
CERT_ARNS="$(aws acm list-certificates --region "$AWS_REGION" --certificate-statuses PENDING_VALIDATION ISSUED INACTIVE EXPIRED VALIDATION_TIMED_OUT REVOKED FAILED --query "CertificateSummaryList[?DomainName=='${ORIGIN_HOSTNAME}'].CertificateArn" --output json)"
ORIGIN_CERT_COUNT="$(jq 'length' <<<"$CERT_ARNS")"
echo "ORIGIN_ACM_CERTIFICATE_COUNT=$ORIGIN_CERT_COUNT"
if [[ "$ORIGIN_CERT_COUNT" -gt 0 ]]; then
  CERT_ARN="$(jq -r '.[0]' <<<"$CERT_ARNS")"
  aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$CERT_ARN" --output json > /tmp/origin-cert.json
  CERT_STATUS="$(jq -r '.Certificate.Status' /tmp/origin-cert.json)"
  echo "ORIGIN_ACM_CERTIFICATE_ARN=$CERT_ARN"
  echo "ORIGIN_ACM_CERTIFICATE_STATUS=$CERT_STATUS"
  jq -r '.Certificate.DomainValidationOptions[] | select(.ResourceRecord != null) | "ORIGIN_ACM_DNS_RECORD=" + .ResourceRecord.Type + "|" + .ResourceRecord.Name + "|" + .ResourceRecord.Value' /tmp/origin-cert.json
else
  echo "ORIGIN_ACM_CERTIFICATE_STATUS=ABSENT"
fi

echo "=== SES / COGNITO BOUNDARY ==="
if aws sesv2 get-email-identity --region "$AWS_REGION" --email-identity "$SES_DOMAIN" --output json > /tmp/ses-identity.json 2>/tmp/ses-identity.err; then
  SES_VERIFY="$(jq -r '.VerificationStatus // "UNKNOWN"' /tmp/ses-identity.json)"
  DKIM_STATUS="$(jq -r '.DkimAttributes.Status // "UNKNOWN"' /tmp/ses-identity.json)"
  echo "SES_IDENTITY_STATUS=$SES_VERIFY"
  echo "SES_DKIM_STATUS=$DKIM_STATUS"
  jq -r --arg domain "$SES_DOMAIN" '.DkimAttributes.Tokens[]? | "SES_DKIM_DNS_RECORD=CNAME|" + . + "._domainkey." + $domain + "|" + . + ".dkim.amazonses.com"' /tmp/ses-identity.json
else
  echo "SES_IDENTITY_STATUS=NOT_FOUND_OR_NOT_READABLE"
  cat /tmp/ses-identity.err >&2
fi
if aws sesv2 get-account --region "$AWS_REGION" --output json > /tmp/ses-account.json 2>/tmp/ses-account.err; then
  echo "SES_PRODUCTION_ACCESS_ENABLED=$(jq -r '.ProductionAccessEnabled // false' /tmp/ses-account.json)"
  echo "SES_SENDING_ENABLED=$(jq -r '.SendingEnabled // false' /tmp/ses-account.json)"
else
  echo "SES_ACCOUNT_STATUS=NOT_READABLE"
  cat /tmp/ses-account.err >&2
fi
aws cognito-idp describe-user-pool --region "$AWS_REGION" --user-pool-id "$COGNITO_POOL_ID" --output json > /tmp/cognito-pool.json
COGNITO_EMAIL_SOURCE="$(jq -r '.UserPool.EmailConfiguration.EmailSendingAccount // "COGNITO_DEFAULT"' /tmp/cognito-pool.json)"
echo "COGNITO_EMAIL_SENDING_ACCOUNT=$COGNITO_EMAIL_SOURCE"
[[ "$COGNITO_EMAIL_SOURCE" == "COGNITO_DEFAULT" ]] || { echo "Cognito SES cutover occurred unexpectedly." >&2; exit 1; }

echo "READ_ONLY_AUDIT=true"
