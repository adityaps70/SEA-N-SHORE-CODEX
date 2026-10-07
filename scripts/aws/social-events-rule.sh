#!/usr/bin/env bash
# Social Events notification rule: the ONLY change this runner may make is an in-place update of
# aws_cloudwatch_event_rule.notification_events whose sole difference is the event pattern gaining exactly the
# six feed event names below (nothing removed, source unchanged). Anything else in the plan refuses.
#
# The worker task definitions and services are deliberately not touched: every staging deploy registers new worker
# task definitions with the freshly built image (aws-staging-deploy.yml, promote_worker), while Terraform still pins
# the September social worker image, so applying them from Terraform would roll both workers back.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/social-events-rule-action.txt"
IMAGE_TAG_FILE="scripts/aws/social-events-image-tag.txt"
RULE_ADDRESS="aws_cloudwatch_event_rule.notification_events"
RULE_NAME="sea-n-shore-staging-notification-events"
EVENT_BUS="sea-n-shore-staging-social-events"
ADDED_TYPES='["comment.mentioned","comment.reacted","comment.replied","post.commented","post.mentioned","post.reacted"]'

[[ "${SOCIAL_EVENTS_RULE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SOCIAL_EVENTS_RULE_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SOCIAL_EVENTS_RULE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app scripts/aws/social-events-rule.sh "$ACTION_FILE" "$IMAGE_TAG_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported social events rule action." >&2; exit 1 ;; esac

IMAGE_TAG="$(tr -d '[:space:]' < "$IMAGE_TAG_FILE")"
[[ "$IMAGE_TAG" =~ ^social-[0-9a-f]{40}$ ]] || { echo "Pinned social worker image tag must be social-<40 hex SHA>." >&2; exit 1; }

WORK_DIR="$(mktemp -d "$PWD/.social-events-rule.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

# The configuration needs its variables even for one target; same values as the old Social Events runner.
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

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

plan() {
  # Bounded like every host plan: interrupted and retried once if it hangs (scripts/aws/bootstrap-terraform-lock.sh).
  terraform_plan_bounded "$WORK_DIR/$1.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s -target="$RULE_ADDRESS" \
    -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/$1.tfplan"
  terraform -chdir="$APP_DIR" show -json "$WORK_DIR/$1.tfplan" > "$WORK_DIR/$1.json"
}

# Prints the classification; exits non-zero for anything but "no change" or the exact allowed pattern update.
classify() {
  python3 - "$1" "$RULE_ADDRESS" "$ADDED_TYPES" <<'PY'
import json, sys
plan_path, rule_address, added_json = sys.argv[1:]
with open(plan_path) as f: plan=json.load(f)
expected_added=set(json.loads(added_json))
changes=[r for r in plan.get('resource_changes', []) if r.get('change', {}).get('actions') != ['no-op']]
if not changes:
    print('SOCIAL_EVENTS_RULE_PLAN=NO_CHANGES'); sys.exit(0)
if len(changes) != 1 or changes[0]['address'] != rule_address:
    raise SystemExit('Refusing: the plan changes ' + ', '.join(f"{c['address']} {c['change']['actions']}" for c in changes))
change=changes[0]['change']
if change['actions'] != ['update']:
    raise SystemExit(f"Refusing: {rule_address} {change['actions']} is not an in-place update")
before, after = change.get('before') or {}, change.get('after') or {}
if any(v for v in (change.get('after_unknown') or {}).values()):
    raise SystemExit('Refusing: the update has unknown values')
changed=sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
if changed != ['event_pattern']:
    raise SystemExit(f'Refusing: attributes other than event_pattern change: {changed}')
old, new = json.loads(before['event_pattern']), json.loads(after['event_pattern'])
if set(old) != set(new) or any(old[k] != new[k] for k in old if k != 'detail-type'):
    raise SystemExit('Refusing: the pattern changes more than its detail-type list')
old_types, new_types = set(old.get('detail-type', [])), set(new.get('detail-type', []))
if old_types - new_types:
    raise SystemExit(f'Refusing: the update would drop {sorted(old_types - new_types)}')
if new_types - old_types != expected_added:
    raise SystemExit(f'Refusing: the update adds {sorted(new_types - old_types)}, expected exactly {sorted(expected_added)}')
print('SOCIAL_EVENTS_RULE_PLAN=PATTERN_UPDATE_ONLY')
print('SOCIAL_EVENTS_RULE_DETAIL_TYPES_BEFORE=' + json.dumps(sorted(old_types)))
print('SOCIAL_EVENTS_RULE_DETAIL_TYPES_ADDED=' + json.dumps(sorted(new_types - old_types)))
PY
}

live_types() {
  aws events describe-rule --region "$AWS_REGION" --name "$RULE_NAME" --event-bus-name "$EVENT_BUS" --query EventPattern --output text \
    | jq -c '."detail-type" | sort'
}

echo "SOCIAL_EVENTS_RULE_LIVE_DETAIL_TYPES_BEFORE=$(live_types)"
plan before
CLASSIFICATION="$(classify "$WORK_DIR/before.json")"
echo "$CLASSIFICATION"

if grep -qx 'SOCIAL_EVENTS_RULE_PLAN=NO_CHANGES' <<<"$CLASSIFICATION"; then
  echo "SOCIAL_EVENTS_RULE_ALREADY_APPLIED=true"
  exit 0
fi
if [[ "$ACTION" == "plan" ]]; then
  echo "SOCIAL_EVENTS_RULE_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SOCIAL_EVENTS_RULE_EXPECTED_SHA" ]] || {
  echo "Branch moved after the social events rule run started; refusing stale execution." >&2
  exit 1
}
# Apply exactly the plan that was classified.
terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"

plan after
classify "$WORK_DIR/after.json" | grep -qx 'SOCIAL_EVENTS_RULE_PLAN=NO_CHANGES' || { echo "The rule still differs after the apply." >&2; exit 1; }
LIVE_AFTER="$(live_types)"
jq -e --argjson added "$ADDED_TYPES" '($added - .) == []' <<<"$LIVE_AFTER" >/dev/null || { echo "The live rule is missing an added event type." >&2; exit 1; }
echo "SOCIAL_EVENTS_RULE_LIVE_DETAIL_TYPES_AFTER=$LIVE_AFTER"
echo "SOCIAL_EVENTS_RULE_APPLY_COMPLETE"
