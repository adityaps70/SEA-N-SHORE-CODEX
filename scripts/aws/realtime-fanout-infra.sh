#!/usr/bin/env bash
# Realtime Lambdas (Round ARCH broadcast fix, Phase 5): the ONLY changes this runner may make are
#   - aws_lambda_function.realtime_fanout and aws_lambda_function.realtime_connection (Phase 5: heartbeat ping and the
#     5-connection cap) updated in place with new code only (source_code_hash and what AWS derives from it), and
#   - aws_iam_role_policy.realtime_fanout updated in place, its only difference the removal of the
#     "BroadcastFeedInvalidations" statement (dynamodb:Scan): no statement added, no other statement changed.
# The archives of the two Lambda files are read to compute the code hashes. Anything else refuses.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""
EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/realtime-fanout-infra-action.txt"
IMAGE_TAG_FILE="scripts/aws/social-events-image-tag.txt"
LAMBDA_ADDRESS="aws_lambda_function.realtime_fanout"
CONNECTION_LAMBDA_ADDRESS="aws_lambda_function.realtime_connection"
POLICY_ADDRESS="aws_iam_role_policy.realtime_fanout"
ARCHIVE_ADDRESSES="data.archive_file.realtime_fanout,data.archive_file.realtime_connection"
FUNCTION_NAME="sea-n-shore-staging-realtime-fanout"
CONNECTION_FUNCTION_NAME="sea-n-shore-staging-realtime-connection"
ROLE_NAME="sea-n-shore-staging-realtime-fanout"
POLICY_NAME="sea-n-shore-staging-realtime-fanout"
REMOVED_SID="BroadcastFeedInvalidations"
[[ "${REALTIME_FANOUT_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "REALTIME_FANOUT_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$REALTIME_FANOUT_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app scripts/aws/realtime-fanout-infra.sh scripts/aws/check-realtime-fanout-plan.py "$ACTION_FILE" "$IMAGE_TAG_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh
ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported realtime fan-out action." >&2; exit 1 ;; esac
IMAGE_TAG="$(tr -d '[:space:]' < "$IMAGE_TAG_FILE")"
[[ "$IMAGE_TAG" =~ ^social-[0-9a-f]{40}$ ]] || { echo "Pinned social worker image tag must be social-<40 hex SHA>." >&2; exit 1; }
WORK_DIR="$(mktemp -d "$PWD/.realtime-fanout-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null
# The configuration needs its variables even for these targets; same values as the Social Events rule runner.
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
  terraform_plan_bounded "$WORK_DIR/$1.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
    -target="$LAMBDA_ADDRESS" -target="$CONNECTION_LAMBDA_ADDRESS" -target="$POLICY_ADDRESS" \
    -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/$1.tfplan"
  terraform -chdir="$APP_DIR" show -json "$WORK_DIR/$1.tfplan" > "$WORK_DIR/$1.json"
}
# Prints the classification; exits non-zero for anything but "no change" or the exact allowed update.
classify() {
  python3 scripts/aws/check-realtime-fanout-plan.py "$1" "$LAMBDA_ADDRESS,$CONNECTION_LAMBDA_ADDRESS" "$POLICY_ADDRESS" "$ARCHIVE_ADDRESSES" "$REMOVED_SID"
}

live_state() {
  local code connection_code scan
  code="$(aws lambda get-function-configuration --region "$AWS_REGION" --function-name "$FUNCTION_NAME" --query CodeSha256 --output text)"
  connection_code="$(aws lambda get-function-configuration --region "$AWS_REGION" --function-name "$CONNECTION_FUNCTION_NAME" --query CodeSha256 --output text)"
  scan="$(aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --query PolicyDocument --output json \
    | jq '[.Statement[] | .Action | if type == "array" then .[] else . end | select(. == "dynamodb:Scan")] | length')"
  echo "code_sha256=$code connection_code_sha256=$connection_code scan_statements=$scan"
}

echo "REALTIME_FANOUT_LIVE_BEFORE $(live_state)"
plan before
CLASSIFICATION="$(classify "$WORK_DIR/before.json")"
echo "$CLASSIFICATION"

if grep -qx 'REALTIME_FANOUT_PLAN=NO_CHANGES' <<<"$CLASSIFICATION"; then
  echo "REALTIME_FANOUT_ALREADY_APPLIED=true"
  exit 0
fi
if [[ "$ACTION" == "plan" ]]; then
  echo "REALTIME_FANOUT_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$REALTIME_FANOUT_INFRA_EXPECTED_SHA" ]] || {
  echo "Branch moved after the realtime fan-out run started; refusing stale execution." >&2
  exit 1
}
# Apply exactly the plan that was classified.
terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"

plan after
classify "$WORK_DIR/after.json" | grep -qx 'REALTIME_FANOUT_PLAN=NO_CHANGES' || { echo "The fan-out still differs after the apply." >&2; exit 1; }
LIVE_AFTER="$(live_state)"
grep -q ' scan_statements=0$' <<<"$LIVE_AFTER" || { echo "The live fan-out policy still allows dynamodb:Scan." >&2; exit 1; }
echo "REALTIME_FANOUT_LIVE_AFTER $LIVE_AFTER"
echo "REALTIME_FANOUT_APPLY_COMPLETE"
