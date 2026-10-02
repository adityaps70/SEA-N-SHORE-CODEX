#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

ROLE_NAME="${GITHUB_DEPLOY_ROLE_NAME:-sea-n-shore-staging-github-deploy}"
POLICY_NAME="${GITHUB_DEPLOY_POLICY_NAME:-sea-n-shore-staging-github-deploy}"
OBJECT_ARN="arn:aws:s3:::sea-n-shore-staging-310356785722-media/private-migrations/beaufortmarine.sql"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

aws iam get-role-policy   --role-name "$ROLE_NAME"   --policy-name "$POLICY_NAME"   --query PolicyDocument   --output json > "$TMP_DIR/current.json"

jq --arg object "$OBJECT_ARN" '
  .Statement = (
    [.Statement[] | select(.Sid != "LegacyDumpUploadObject")]
    + [{
        Sid: "LegacyDumpUploadObject",
        Effect: "Allow",
        Action: ["s3:PutObject"],
        Resource: $object
      }]
  )
' "$TMP_DIR/current.json" > "$TMP_DIR/updated.json"

aws iam put-role-policy   --role-name "$ROLE_NAME"   --policy-name "$POLICY_NAME"   --policy-document "file://$TMP_DIR/updated.json"

VERIFY="$(aws iam get-role-policy   --role-name "$ROLE_NAME"   --policy-name "$POLICY_NAME"   --query 'PolicyDocument.Statement[?Sid==`LegacyDumpUploadObject`].Resource | [0]'   --output text)"

[[ "$VERIFY" == "$OBJECT_ARN" ]] || {
  echo "Scoped legacy upload permission verification failed." >&2
  exit 1
}

echo "LEGACY_DUMP_UPLOAD_PERMISSION_APPLIED=true"
