#!/usr/bin/env bash
# Round 14 Batch B guarded infrastructure (creates only):
# - 2.6 DMARC for seanshore.in at p=quarantine (takes over the hand-made p=none record);
# - 2.7 the outbox worker may list the user pool and delete abandoned sign-ups;
# - 2.12 the least-privilege app role's own secret, its Data API rotation Lambda (30 days) and read
#   access for ECS (execution role, web and worker task roles).
# Needs migration 0066 (the sea_n_shore_app role) first: the first rotation sets its password.
# The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/account-security-infra-action.txt"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
APP_SECRET_NAME="sea-n-shore-staging/aurora-app"
ZONE_NAME="seanshore.in."
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${ACCOUNT_SECURITY_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ACCOUNT_SECURITY_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ACCOUNT_SECURITY_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/email-dns.tf \
  infra/aws/app/unconfirmed-user-cleanup.tf \
  infra/aws/app/aurora-app-role.tf \
  infra/aws/app/lambda/aurora-app-secret-rotation.mjs \
  scripts/aws/account-security-infra.sh \
  scripts/aws/account-security-infra-action.txt \
  scripts/aws/account-security-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-account-security-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported account security infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.account-security.XXXXXXXX")"
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
export TMPDIR="$TF_TMPDIR"
trap 'rm -rf -- "$WORK_DIR" "$TF_TMPDIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, os, sys
state_path, output_path = sys.argv[1:]
resources = json.load(open(state_path))['resources']
def attrs(kind, name):
    matches = [r for r in resources if r.get('mode') == 'managed' and r.get('type') == kind and r.get('name') == name]
    assert len(matches) == 1 and len(matches[0].get('instances') or []) == 1, f'{kind}.{name}'
    return matches[0]['instances'][0]['attributes']
web = attrs('aws_ecs_task_definition', 'web')
image = next(c for c in json.loads(web['container_definitions']) if c['name'] == 'web')['image']
json.dump({
    'image_tag': image.rsplit(':', 1)[1],
    'site_url': os.environ['PUBLIC_SITE_URL'],
    'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version'],
}, open(output_path, 'w'))
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_route53_record.seanshore_dmarc
  aws_iam_role_policy.outbox_worker_cognito_cleanup
  aws_secretsmanager_secret_rotation.aurora_app
  aws_iam_role_policy.aurora_app_secret_read
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/account-security.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/account-security.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_route53_record.seanshore_dmarc',
  'aws_iam_role_policy.outbox_worker_cognito_cleanup',
  'random_password.aurora_app_initial',
  'aws_secretsmanager_secret.aurora_app',
  'aws_secretsmanager_secret_version.aurora_app_initial',
  'aws_iam_role.aurora_app_secret_rotation',
  'aws_iam_role_policy_attachment.aurora_app_secret_rotation_logs',
  'aws_iam_role_policy.aurora_app_secret_rotation',
  'aws_cloudwatch_log_group.aurora_app_secret_rotation',
  'aws_lambda_function.aurora_app_secret_rotation',
  'aws_lambda_permission.aurora_app_secret_rotation',
  'aws_secretsmanager_secret_rotation.aurora_app',
  'aws_iam_role_policy.aurora_app_secret_read["execution"]',
  'aws_iam_role_policy.aurora_app_secret_read["web"]',
  'aws_iam_role_policy.aurora_app_secret_read["outbox_worker"]',
  'aws_iam_role_policy.aurora_app_secret_read["notification_worker"]',
}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    if r['address'] not in allowed or r['change']['actions'] != ['create']:
        raise SystemExit(f"unexpected account security change refused: {r['address']} {r['change']['actions']}")
    after = r['change']['after'] or {}
    if r['address'] == 'aws_route53_record.seanshore_dmarc':
        if after.get('name') != '_dmarc.seanshore.in' or after.get('type') != 'TXT' or not all(v.startswith('v=DMARC1; p=quarantine;') for v in after.get('records') or []):
            raise SystemExit('The DMARC record must be the seanshore.in p=quarantine TXT record')
    if r['address'] == 'aws_iam_role_policy.outbox_worker_cognito_cleanup':
        actions = sorted({a for st in json.loads(after.get('policy') or '{}').get('Statement', []) for a in st['Action']})
        if actions != ['cognito-idp:AdminDeleteUser', 'cognito-idp:ListUsers']:
            raise SystemExit('Unexpected cleanup permissions: ' + ','.join(actions))
print('ACCOUNT_SECURITY_INFRA_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"ACCOUNT_SECURITY_INFRA_CHANGE={r['address']}|create")
PY


CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
MASTER_SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" && -n "$MASTER_SECRET_ARN" ]]
APP_ROLE_PRESENT="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$MASTER_SECRET_ARN" --database "$DATABASE_NAME" --sql "SELECT count(*)::bigint FROM pg_roles WHERE rolname='sea_n_shore_app'" --output json | jq -r '.records[0][0].longValue')"
echo "APP_DATABASE_ROLE_PRESENT=$APP_ROLE_PRESENT"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "ACCOUNT_SECURITY_INFRA_ACTION=$ACTION"
echo "ACCOUNT_SECURITY_INFRA_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/account-security.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "ACCOUNT_SECURITY_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ACCOUNT_SECURITY_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

[[ "$APP_ROLE_PRESENT" == "1" ]] || { echo "Migration 0066 (sea_n_shore_app) has not run; the first rotation would fail. Refusing." >&2; exit 1; }

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/account-security.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Account security resources still drift after apply." >&2
  exit 1
}

ZONE_ID="$(aws route53 list-hosted-zones-by-name --dns-name "$ZONE_NAME" --max-items 1 --query 'HostedZones[0].Id' --output text)"
aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --query "ResourceRecordSets[?Name=='_dmarc.seanshore.in.' && Type=='TXT'].ResourceRecords[].Value" --output json \
  | jq -e 'length == 1 and (.[0] | startswith("\"v=DMARC1; p=quarantine;"))' >/dev/null
echo "DMARC_QUARANTINE_VERIFIED=true"
aws iam get-role-policy --role-name sea-n-shore-staging-outbox-worker --policy-name sea-n-shore-staging-outbox-worker-cognito-cleanup >/dev/null
echo "OUTBOX_WORKER_CLEANUP_POLICY_VERIFIED=true"
APP_SECRET_ARN="$(aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$APP_SECRET_NAME" --query ARN --output text)"
# Enabling rotation starts the first rotation, which sets the role's password and LOGIN.
for attempt in $(seq 1 36); do
  ROTATED="$(aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$APP_SECRET_ARN" --output json | jq -r '(.RotationEnabled == true) and (.LastRotatedDate != null)')"
  [[ "$ROTATED" == true ]] && break
  sleep 5
done
[[ "$ROTATED" == true ]] || { echo "The app secret's first rotation did not finish." >&2; exit 1; }
echo "APP_SECRET_ROTATION_VERIFIED=true"
CURRENT_USER="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$APP_SECRET_ARN" --database "$DATABASE_NAME" --sql "SELECT current_user" --output json | jq -r '.records[0][0].stringValue')"
[[ "$CURRENT_USER" == "sea_n_shore_app" ]] || { echo "The app secret does not log in as sea_n_shore_app." >&2; exit 1; }
echo "APP_ROLE_LOGIN_VERIFIED=true"
echo "AURORA_APP_SECRET_ARN=$APP_SECRET_ARN"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "ACCOUNT_SECURITY_INFRA_APPLY_VERIFIED=true"
