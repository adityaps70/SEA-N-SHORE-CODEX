#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
RESOURCE="aws_iam_role_policy.ecs_execution_aurora_secret"
ROLE_NAME="sea-n-shore-staging-ecs-execution"
POLICY_NAME="sea-n-shore-staging-aurora-secret"
IMPORT_ID="${ROLE_NAME}:${POLICY_NAME}"
CLUSTER_ID="sea-n-shore-staging-aurora"

[[ "${SOCIAL_IAM_STATE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SOCIAL_IAM_STATE_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SOCIAL_IAM_STATE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app/ecs-database-runtime.tf scripts/aws/social-shared-iam-state.sh scripts/aws/social-shared-iam-state-action.txt
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < scripts/aws/social-shared-iam-state-action.txt)"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported shared IAM state action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.social-shared-iam-state.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null
STATE_COUNT="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_iam_role_policy" and .name=="ecs_execution_aurora_secret")] | length' "$WORK_DIR/state.json")"
[[ "$STATE_COUNT" == "0" ]] || {
  echo "Shared IAM policy is already present in Terraform state; no import needed."
  echo "SOCIAL_SHARED_IAM_STATE_ALREADY_RECONCILED=true"
  exit 0
}

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]
aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --output json > "$WORK_DIR/live-policy.json"
jq -e --arg secret "$SECRET_ARN" '
  def as_array: if type == "array" then . else [.] end;
  .RoleName == "sea-n-shore-staging-ecs-execution" and
  .PolicyName == "sea-n-shore-staging-aurora-secret" and
  (.PolicyDocument.Statement | length) == 1 and
  .PolicyDocument.Statement[0].Effect == "Allow" and
  ((.PolicyDocument.Statement[0].Action | as_array) == ["secretsmanager:GetSecretValue"]) and
  ((.PolicyDocument.Statement[0].Resource | as_array) == [$secret])
' "$WORK_DIR/live-policy.json" >/dev/null

echo "SOCIAL_SHARED_IAM_LIVE_POLICY_MATCHES_DESIRED=true"
echo "SOCIAL_SHARED_IAM_STATE_COUNT_BEFORE=0"

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: state=json.load(f)
resources=state['resources']
def attrs(kind, name=None):
    matches=[r for r in resources if r['mode']=='managed' and r['type']==kind and (name is None or r['name']==name)]
    assert len(matches)==1, f'Expected one {kind} {name or ""}'.strip()
    return matches[0]['instances'][0]['attributes']
web_task=attrs('aws_ecs_task_definition','web')
containers=json.loads(web_task['container_definitions'])
web=next(c for c in containers if c['name']=='web')
site=next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL')
values={
  'image_tag':web['image'].rsplit(':',1)[-1],
  'site_url':site,
  'aurora_engine_version':attrs('aws_rds_cluster','aurora')['engine_version'],
}
with open(sys.argv[2],'w') as f: json.dump(values,f)
PY

PLUGIN_DIR="$HOME/SEA-N-SHORE-CODEX/infra/aws/app/.terraform/providers"
[[ -x "$PLUGIN_DIR/registry.terraform.io/hashicorp/aws/6.62.0/linux_amd64/terraform-provider-aws_v6.62.0_x5" ]]
terraform -chdir="$APP_DIR" init -input=false -no-color -lockfile=readonly -plugin-dir="$PLUGIN_DIR" \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target="$RESOURCE" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.json"
jq -e --arg resource "$RESOURCE" '
  ([.resource_changes[] | select(.change.actions != ["no-op"])]) as $changes |
  ($changes | length) == 1 and
  $changes[0].address == $resource and
  $changes[0].change.actions == ["create"]
' "$WORK_DIR/plan-before.json" >/dev/null || {
  echo "Shared IAM pre-import plan contains unexpected actual changes." >&2
  jq '[.resource_changes[] | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-before.json" >&2
  exit 1
}

echo "SOCIAL_SHARED_IAM_STATE_PLAN_VERIFIED=IMPORT_ONLY"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
if [[ "$ACTION" == "plan" ]]; then
  echo "SOCIAL_SHARED_IAM_STATE_PLAN_ONLY_NO_IMPORT"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SOCIAL_IAM_STATE_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

echo "IMPORTING_EXISTING_SHARED_IAM_POLICY_INTO_TERRAFORM_STATE"
terraform -chdir="$APP_DIR" import -input=false -no-color -var-file="$WORK_DIR/variables.json" "$RESOURCE" "$IMPORT_ID" > "$WORK_DIR/import.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target="$RESOURCE" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
ACTUAL_AFTER="$(jq '[.resource_changes[] | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")"
[[ "$ACTUAL_AFTER" == "0" ]] || {
  echo "Imported shared IAM policy still has Terraform drift; refusing success." >&2
  jq '[.resource_changes[] | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-after.json" >&2
  exit 1
}

terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
STATE_COUNT_AFTER="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_iam_role_policy" and .name=="ecs_execution_aurora_secret")] | length' "$WORK_DIR/state-after.json")"
[[ "$STATE_COUNT_AFTER" == "1" ]]
echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$WORK_DIR/state-after.json")"
echo "SOCIAL_SHARED_IAM_STATE_COUNT_AFTER=1"
echo "SOCIAL_SHARED_IAM_STATE_IMPORT_VERIFIED=true"
