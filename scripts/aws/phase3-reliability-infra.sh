#!/usr/bin/env bash
# Round 14 Phase 3 guarded infrastructure (3.5, 3.11): Aurora Serverless v2 keeps a 0.5 ACU floor
# with no auto-pause (owner-approved), 14-day backups and a final snapshot on delete, Performance
# Insights on the free 7-day tier, and 90-day web log retention. In-place updates only; the
# cluster and its writer are never replaced. The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/phase3-reliability-infra-action.txt"
CLUSTER_ID="sea-n-shore-staging-aurora"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${PHASE3_RELIABILITY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PHASE3_RELIABILITY_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PHASE3_RELIABILITY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/database.tf \
  infra/aws/app/aws-native-variables.tf \
  infra/aws/app/main.tf \
  scripts/aws/phase3-reliability-infra.sh \
  scripts/aws/phase3-reliability-infra-action.txt \
  scripts/aws/phase3-reliability-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-phase3-reliability-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported phase 3 reliability action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.phase3-reliability.XXXXXXXX")"
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
  aws_rds_cluster.aurora
  aws_rds_cluster_instance.aurora_writer
  aws_cloudwatch_log_group.app
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/phase3.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/phase3.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_rds_cluster.aurora': {('update',)},
  'aws_rds_cluster_instance.aurora_writer': {('update',)},
  'aws_cloudwatch_log_group.app': {('update',)},
}
update_keys = {
  'aws_rds_cluster.aurora': {'serverlessv2_scaling_configuration', 'backup_retention_period', 'skip_final_snapshot', 'final_snapshot_identifier'},
  'aws_rds_cluster_instance.aurora_writer': {'performance_insights_enabled', 'performance_insights_retention_period', 'performance_insights_kms_key_id'},
  'aws_cloudwatch_log_group.app': {'retention_in_days'},
}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    actions = tuple(r['change']['actions'])
    if r['address'] not in allowed or actions not in allowed[r['address']]:
        raise SystemExit(f"unexpected phase 3 reliability change refused: {r['address']} {list(actions)}")
print('PHASE3_RELIABILITY_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"PHASE3_RELIABILITY_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    before, after = r['change']['before'] or {}, r['change']['after'] or {}
    keys = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('tags', 'tags_all'))
    unknown = r['change'].get('after_unknown') or {}
    keys = sorted(set(keys) | {k for k, v in unknown.items() if v is True and k in before})
    if set(keys) - update_keys[r['address']]:
        raise SystemExit(r['address'] + ' change outside its intended attributes refused: ' + ','.join(keys))
    print(f"PHASE3_RELIABILITY_KEYS={r['address']}|{','.join(keys)}")
    if r['address'] == 'aws_rds_cluster.aurora':
        scaling = (after.get('serverlessv2_scaling_configuration') or [{}])[0]
        # seconds_until_auto_pause is Optional+Computed: leaving it out of the config keeps the stored
        # timer, and the API rejects anything below 300. Aurora only auto-pauses at min_capacity 0, so
        # the timer is ignored once the floor is 0.5. The post-apply check still reads the live cluster.
        if scaling.get('min_capacity') != 0.5:
            raise SystemExit('Aurora must end at a 0.5 ACU floor without auto-pause')
        print(f"AURORA_PLANNED_MIN_ACU={scaling['min_capacity']} AURORA_PLANNED_PAUSE_TIMER_IGNORED={scaling.get('seconds_until_auto_pause')}")
        if after.get('deletion_protection') is not True:
            raise SystemExit('Aurora deletion protection must stay on')
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "PHASE3_RELIABILITY_ACTION=$ACTION"
echo "PHASE3_RELIABILITY_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/phase3.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "PHASE3_RELIABILITY_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PHASE3_RELIABILITY_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/phase3.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Phase 3 reliability resources still drift after apply." >&2
  exit 1
}

aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json \
  | jq -e '.DBClusters[0] | .ServerlessV2ScalingConfiguration.MinCapacity == 0.5 and ((.ServerlessV2ScalingConfiguration.SecondsUntilAutoPause // 0) == 0 or .ServerlessV2ScalingConfiguration.MinCapacity > 0) and .BackupRetentionPeriod == 14 and .DeletionProtection == true and .Status == "available"' >/dev/null
echo "AURORA_FLOOR_AND_BACKUPS_VERIFIED=true"
aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier sea-n-shore-staging-aurora-writer --output json \
  | jq -r '.DBInstances[0] | "AURORA_WRITER_PERFORMANCE_INSIGHTS=\(.PerformanceInsightsEnabled) PENDING=\(.PendingModifiedValues | keys | join(","))"'
aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix /ecs/sea-n-shore-staging/web --output json \
  | jq -e '[.logGroups[] | select(.logGroupName == "/ecs/sea-n-shore-staging/web")][0].retentionInDays == 90' >/dev/null
echo "WEB_LOG_RETENTION_VERIFIED=true"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "PHASE3_RELIABILITY_APPLY_VERIFIED=true"
