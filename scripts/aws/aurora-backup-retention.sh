#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

[[ "${AURORA_RETENTION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git rev-parse HEAD)" == "$AURORA_RETENTION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws infra/aws/app
[[ "$(aws sts get-caller-identity --query Account --output text)" == "310356785722" ]]

ACTION="$(tr -d '[:space:]' < scripts/aws/aurora-backup-retention-action.txt)"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported Aurora retention action." >&2; exit 1 ;; esac

APP_DIR="$PWD/infra/aws/app"
WORK_DIR="$(mktemp -d "$PWD/.aurora-retention.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT
STATE_BUCKET=sea-n-shore-310356785722-ap-south-1-tfstate
STATE_KEY=sea-n-shore/staging/terraform.tfstate

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region ap-south-1 "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: state=json.load(f)
resources=state['resources']
def attrs(kind):
    matches=[r for r in resources if r['type']==kind and r['mode']=='managed']
    assert len(matches)==1, 'Expected exactly one '+kind
    return matches[0]['instances'][0]['attributes']
task=attrs('aws_ecs_task_definition')
containers=json.loads(task['container_definitions'])
web=next(c for c in containers if c['name']=='web')
site=next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL')
values={
  'image_tag':web['image'].rsplit(':',1)[-1],
  'site_url':site,
  'aurora_engine_version':attrs('aws_rds_cluster')['engine_version']
}
with open(sys.argv[2],'w') as f: json.dump(values,f)
PY

PLUGIN_DIR="$HOME/SEA-N-SHORE-CODEX/infra/aws/app/.terraform/providers"
[[ -x "$PLUGIN_DIR/registry.terraform.io/hashicorp/aws/6.62.0/linux_amd64/terraform-provider-aws_v6.62.0_x5" ]]
terraform -chdir="$APP_DIR" init -input=false -no-color -lockfile=readonly -plugin-dir="$PLUGIN_DIR" \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config=region=ap-south-1 -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target=aws_rds_cluster.aurora \
  -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/aurora.tfplan" \
  > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/aurora.tfplan" > "$WORK_DIR/plan.json"

# Fail closed unless this is exactly one in-place Aurora cluster update and the
# only known before/after value difference is backup_retention_period 1 -> 7.
jq -e '
  (.resource_changes | length) == 1 and
  .resource_changes[0].address == "aws_rds_cluster.aurora" and
  .resource_changes[0].change.actions == ["update"] and
  .resource_changes[0].change.before.backup_retention_period == 1 and
  .resource_changes[0].change.after.backup_retention_period == 7 and
  ((.resource_changes[0].change.before | del(.backup_retention_period)) ==
   (.resource_changes[0].change.after | del(.backup_retention_period)))
' "$WORK_DIR/plan.json" >/dev/null || {
  echo "Aurora retention plan contains unexpected changes; refusing." >&2
  jq '[.resource_changes[] | {address, actions: .change.actions, before_retention: .change.before.backup_retention_period, after_retention: .change.after.backup_retention_period}]' "$WORK_DIR/plan.json" >&2
  exit 1
}

jq '[.resource_changes[] | {address, actions: .change.actions, before_retention: .change.before.backup_retention_period, after_retention: .change.after.backup_retention_period}]' "$WORK_DIR/plan.json"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/aurora.tfplan" | cut -d' ' -f1)"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "AURORA_BACKUP_RETENTION_PLAN_VERIFIED=1_TO_7_ONLY"

if [[ "$ACTION" == plan ]]; then
  echo "AURORA_BACKUP_RETENTION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$AURORA_RETENTION_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
echo "STATE_BACKUP_VERSION=$(jq -r '.VersionId' "$WORK_DIR/object.json")"
jq -e '.VersionId != null' "$WORK_DIR/object.json" >/dev/null

echo "APPLYING_SAVED_AURORA_RETENTION_ONLY_PLAN"
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/aurora.tfplan" > "$WORK_DIR/apply.log"

LIVE_RETENTION="$(aws rds describe-db-clusters --region ap-south-1 --db-cluster-identifier sea-n-shore-staging-aurora --query 'DBClusters[0].BackupRetentionPeriod' --output text)"
[[ "$LIVE_RETENTION" == "7" ]] || { echo "Live Aurora retention is $LIVE_RETENTION, expected 7." >&2; exit 1; }
terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$WORK_DIR/state-after.json")"
echo "LIVE_AURORA_BACKUP_RETENTION_DAYS=$LIVE_RETENTION"
echo "AURORA_BACKUP_RETENTION_APPLY_VERIFIED"
