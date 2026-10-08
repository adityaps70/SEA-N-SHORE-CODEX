#!/usr/bin/env bash
# Worker drift plan: read-only. Plans the two Social Events worker services and task definitions and prints what
# Terraform would change on each (actions, changed attributes, running revision, image tag and platform version).
# There is no apply path: the only accepted action is plan.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/worker-drift-plan-action.txt"
IMAGE_TAG_FILE="scripts/aws/social-events-image-tag.txt"
TARGETS=(
  aws_ecs_service.outbox_worker
  aws_ecs_service.notification_worker
  aws_ecs_task_definition.outbox_worker
  aws_ecs_task_definition.notification_worker
)

[[ "${WORKER_DRIFT_PLAN_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "WORKER_DRIFT_PLAN_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$WORKER_DRIFT_PLAN_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app scripts/aws/worker-drift-plan.sh "$ACTION_FILE" "$IMAGE_TAG_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
[[ "$ACTION" == "plan" ]] || { echo "The worker drift plan only plans." >&2; exit 1; }

IMAGE_TAG="$(tr -d '[:space:]' < "$IMAGE_TAG_FILE")"
[[ "$IMAGE_TAG" =~ ^social-[0-9a-f]{40}$ ]] || { echo "Pinned social worker image tag must be social-<40 hex SHA>." >&2; exit 1; }

WORK_DIR="$(mktemp -d "$PWD/.worker-drift-plan.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

# Same variables as the Social Events notification rule runner.
python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" "$IMAGE_TAG" <<'PY'
import json, sys
state_path, output_path, image_tag = sys.argv[1:]
with open(state_path) as f:
    resources=json.load(f)['resources']
def attrs(kind, name):
    matches=[r for r in resources if r['type']==kind and r['mode']=='managed' and r['name']==name]
    assert len(matches)==1, f'Expected exactly one {kind}.{name}'
    return matches[0]['instances'][0]['attributes']
web=next(c for c in json.loads(attrs('aws_ecs_task_definition','web')['container_definitions']) if c['name']=='web')
values={
  'image_tag': image_tag,
  'site_url': next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL'),
  'aurora_engine_version': attrs('aws_rds_cluster','aurora')['engine_version'],
  'social_worker_desired_count': 1,
}
with open(output_path,'w') as f:
    json.dump(values,f)
PY
rm -f -- "$WORK_DIR/state.json"

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGET_ARGS=()
for target in "${TARGETS[@]}"; do TARGET_ARGS+=("-target=$target"); done
terraform_plan_bounded "$WORK_DIR/plan.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${TARGET_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/plan.tfplan"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/plan.tfplan" > "$WORK_DIR/plan.json"
rm -f -- "$WORK_DIR/plan.tfplan"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
plan = json.load(open(sys.argv[1]))
def image_tag(defs):
    try:
        return [c['image'].rsplit(':', 1)[-1] for c in json.loads(defs or '[]')]
    except ValueError:
        return ['unknown']
changes = [r for r in plan.get('resource_changes', []) if r['change']['actions'] != ['no-op']]
for r in plan.get('resource_changes', []):
    change = r['change']; before = change.get('before') or {}; after = change.get('after') or {}
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('revision', 'arn', 'arn_without_revision', 'id'))
    row = {'address': r['address'], 'actions': change['actions'], 'changed': changed}
    if r['type'] == 'aws_ecs_service':
        # before = the refreshed live service: its running revision and platform version.
        row['running_revision'] = (before.get('task_definition') or '').rsplit('/', 1)[-1]
        row['platform_version'] = [before.get('platform_version'), after.get('platform_version')]
    if r['type'] == 'aws_ecs_task_definition' and 'container_definitions' in changed:
        row['image_tag'] = [image_tag(before.get('container_definitions')), image_tag(after.get('container_definitions'))]
    print('WORKER_DRIFT_PLAN=' + json.dumps(row, sort_keys=True))
print(f'WORKER_DRIFT_PLAN_CHANGES={len(changes)}')
print('WORKER_DRIFT_PLAN_ONLY_NO_APPLY')
PY
