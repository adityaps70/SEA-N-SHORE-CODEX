#!/usr/bin/env bash
# Private reports (owner-approved 17 Nov): one lifecycle rule on the private migration bucket. Every object under
# private-reports/ is deleted 14 days after it is written, and the older versions S3 keeps (the bucket is versioned)
# 1 day after that (infra/aws/app/storage.tf, aws_s3_bucket_lifecycle_configuration.migration_backup).
# The ONLY change this runner may make is adding that rule beside the existing abort-incomplete-multipart rule.
#
#   plan              read only: counts what is under private-reports/ today, plans and checks the change.
#   apply-once <sha>  the same checks, then applies exactly that plan and verifies the live rules.
#
# Anything already under private-reports/ stops the run (the new rule could delete it). Prints counts and
# true/false only: no object keys, no bucket contents.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""
EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/private-reports-lifecycle-action.txt"
BUCKET="sea-n-shore-staging-310356785722-migration"
REPORTS_PREFIX="private-reports/"
RESOURCE="aws_s3_bucket_lifecycle_configuration.migration_backup"

[[ "${PRIVATE_REPORTS_LIFECYCLE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PRIVATE_REPORTS_LIFECYCLE_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PRIVATE_REPORTS_LIFECYCLE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app scripts/aws/private-reports-lifecycle.sh scripts/aws/check-private-reports-lifecycle-plan.py "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported private reports lifecycle action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.private-reports-lifecycle.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

# What is under private-reports/ today: every version and delete marker, counted (never listed).
existing_objects() {
  aws s3api list-object-versions --region "$AWS_REGION" --bucket "$BUCKET" --prefix "$REPORTS_PREFIX" \
    --output json > "$WORK_DIR/versions.json" 2> "$WORK_DIR/versions.err" || {
    echo "PRIVATE_REPORTS_EXISTING_OBJECTS=unreadable"
    echo "Could not list private-reports/ in the migration bucket; refusing." >&2
    exit 1
  }
  jq -s '[.[] | ((.Versions // []) + (.DeleteMarkers // []))[]] | length' "$WORK_DIR/versions.json"
}

EXISTING="$(existing_objects)"
[[ "$EXISTING" =~ ^[0-9]+$ ]]
echo "PRIVATE_REPORTS_EXISTING_OBJECTS=$EXISTING"
[[ "$EXISTING" == 0 ]] || {
  echo "PRIVATE_REPORTS_LIFECYCLE=FAIL objects already under private-reports/; the new rule could delete them." >&2
  exit 1
}

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null
# The configuration needs its variables even for this target; the same values as the other targeted runners.
python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    resources = json.load(f)['resources']

def attrs(kind, name):
    matches = [r for r in resources if r['mode'] == 'managed' and r['type'] == kind and r['name'] == name]
    assert len(matches) == 1, f'Expected one {kind}.{name}'
    return matches[0]['instances'][0]['attributes']

web = next(c for c in json.loads(attrs('aws_ecs_task_definition', 'web')['container_definitions']) if c['name'] == 'web')
site_url = next(item['value'] for item in web['environment'] if item['name'] == 'NEXT_PUBLIC_SITE_URL')
image = web['image']
assert ':' in image.rsplit('/', 1)[-1], f'Expected tag-qualified web image, got {image}'
with open(sys.argv[2], 'w') as f:
    json.dump({'image_tag': image.rsplit(':', 1)[1], 'site_url': site_url, 'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version']}, f)
PY
rm -f -- "$WORK_DIR/state.json"

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

plan() {
  # Bounded like every host plan: interrupted and retried once if it hangs (scripts/aws/bootstrap-terraform-lock.sh).
  terraform_plan_bounded "$WORK_DIR/$1.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
    -target="$RESOURCE" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/$1.tfplan"
  terraform -chdir="$APP_DIR" show -json "$WORK_DIR/$1.tfplan" > "$WORK_DIR/$1.json"
}
classify() {
  python3 -I scripts/aws/check-private-reports-lifecycle-plan.py "$1"
}
live_rules() {
  aws s3api get-bucket-lifecycle-configuration --region "$AWS_REGION" --bucket "$BUCKET" --output json \
    | python3 -I scripts/aws/check-private-reports-lifecycle-plan.py --live
}

plan before
CLASSIFICATION="$(classify "$WORK_DIR/before.json")"
echo "$CLASSIFICATION"
echo "PRIVATE_REPORTS_LIFECYCLE_ACTION=$ACTION"

if grep -qx 'PRIVATE_REPORTS_LIFECYCLE_PLAN=NO_CHANGES' <<<"$CLASSIFICATION"; then
  echo "PRIVATE_REPORTS_LIFECYCLE_LIVE_RULES_MATCH=$(live_rules)"
  echo "PRIVATE_REPORTS_LIFECYCLE_ALREADY_APPLIED=true"
  exit 0
fi
if [[ "$ACTION" == "plan" ]]; then
  echo "PRIVATE_REPORTS_LIFECYCLE_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PRIVATE_REPORTS_LIFECYCLE_EXPECTED_SHA" ]] || {
  echo "Branch moved after the private reports lifecycle run started; refusing stale execution." >&2
  exit 1
}
# Re-count right before the apply; the plan step took a while.
[[ "$(existing_objects)" == 0 ]] || { echo "PRIVATE_REPORTS_LIFECYCLE=FAIL objects appeared under private-reports/." >&2; exit 1; }
STATE_SERIAL_BEFORE="$(terraform -chdir="$APP_DIR" state pull | jq -r '.serial')"
[[ "$STATE_SERIAL_BEFORE" =~ ^[0-9]+$ ]]
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
# Apply exactly the plan that was classified.
terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"

plan after
classify "$WORK_DIR/after.json" | grep -qx 'PRIVATE_REPORTS_LIFECYCLE_PLAN=NO_CHANGES' || {
  echo "The lifecycle rules still differ after the apply." >&2
  exit 1
}
LIVE="$(live_rules)"
echo "PRIVATE_REPORTS_LIFECYCLE_LIVE_RULES_MATCH=$LIVE"
[[ "$LIVE" == true ]] || { echo "The live lifecycle rules do not match the approved two." >&2; exit 1; }
STATE_SERIAL_AFTER="$(terraform -chdir="$APP_DIR" state pull | jq -r '.serial')"
[[ "$STATE_SERIAL_AFTER" -gt "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "PRIVATE_REPORTS_LIFECYCLE_VERIFIED=true"
echo "PRIVATE_REPORTS_LIFECYCLE_APPLY_COMPLETE"
