#!/usr/bin/env bash
# Round 14 (2.9) guarded infrastructure: the realtime connection Lambda verifies the app-signed
# typing token (membership) and relays at most one typing signal per connection per 2 s. Changes the
# Lambda's code and environment (REALTIME_TICKET_SECRET_ARN) and its IAM policy (UpdateItem on the
# connections table, GetSecretValue on the ticket secret), in place only. The action file holds
# "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/realtime-typing-infra-action.txt"
FUNCTION_NAME="sea-n-shore-staging-realtime-connection"
POLICY_ROLE="sea-n-shore-staging-realtime-connection"
POLICY_NAME="sea-n-shore-staging-realtime-connection"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${REALTIME_TYPING_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "REALTIME_TYPING_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$REALTIME_TYPING_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/realtime.tf \
  infra/aws/app/lambda/realtime-connection.mjs \
  scripts/aws/realtime-typing-infra.sh \
  scripts/aws/realtime-typing-infra-action.txt \
  scripts/aws/realtime-typing-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-realtime-typing-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported realtime typing infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.realtime-typing.XXXXXXXX")"
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
  aws_lambda_function.realtime_connection
  aws_iam_role_policy.realtime_connection
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/realtime-typing.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/realtime-typing.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_lambda_function.realtime_connection': {('update',)},
  'aws_iam_role_policy.realtime_connection': {('update',)},
}
# Code and environment change; the rest are values AWS computes for every new Lambda version.
update_keys = {
  'aws_lambda_function.realtime_connection': {'environment', 'source_code_hash', 'code_sha256', 'last_modified', 'qualified_arn', 'qualified_invoke_arn', 'version'},
  'aws_iam_role_policy.realtime_connection': {'policy'},
}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    actions = tuple(r['change']['actions'])
    if r['address'] not in allowed or actions not in allowed[r['address']]:
        raise SystemExit(f"unexpected realtime typing change refused: {r['address']} {list(actions)}")
print('REALTIME_TYPING_INFRA_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"REALTIME_TYPING_INFRA_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    before, after = r['change']['before'] or {}, r['change']['after'] or {}
    keys = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('tags', 'tags_all'))
    unknown = r['change'].get('after_unknown') or {}
    keys = sorted(set(keys) | {k for k, v in unknown.items() if v is True and k in before})
    if set(keys) - update_keys[r['address']]:
        raise SystemExit(r['address'] + ' change outside its intended attributes refused: ' + ','.join(keys))
    print(f"REALTIME_TYPING_INFRA_KEYS={r['address']}|{','.join(keys)}")
    if r['address'] == 'aws_lambda_function.realtime_connection':
        variables = ((after.get('environment') or [{}])[0] or {}).get('variables') or {}
        if not str(variables.get('REALTIME_TICKET_SECRET_ARN', '')).startswith('arn:aws:secretsmanager:ap-south-1:310356785722:secret:'):
            raise SystemExit('The connection Lambda must receive the realtime ticket secret ARN')
        if set(variables) != {'REALTIME_CONNECTIONS_TABLE', 'REALTIME_PROFILE_INDEX', 'REALTIME_TICKET_SECRET_ARN'}:
            raise SystemExit('Unexpected connection Lambda environment: ' + ','.join(sorted(variables)))
    if r['address'] == 'aws_iam_role_policy.realtime_connection':
        statements = json.loads(after.get('policy') or '{}').get('Statement', [])
        actions_allowed = sorted({a for st in statements for a in ([st['Action']] if isinstance(st['Action'], str) else st['Action'])})
        if actions_allowed != sorted(['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:DeleteItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'secretsmanager:GetSecretValue', 'execute-api:ManageConnections']):
            raise SystemExit('Unexpected connection Lambda permissions: ' + ','.join(actions_allowed))
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "REALTIME_TYPING_INFRA_ACTION=$ACTION"
echo "REALTIME_TYPING_INFRA_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/realtime-typing.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "REALTIME_TYPING_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$REALTIME_TYPING_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/realtime-typing.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Realtime typing resources still drift after apply." >&2
  exit 1
}

aws lambda wait function-updated-v2 --region "$AWS_REGION" --function-name "$FUNCTION_NAME"
aws lambda get-function-configuration --region "$AWS_REGION" --function-name "$FUNCTION_NAME" --output json \
  | jq -e '.Environment.Variables.REALTIME_TICKET_SECRET_ARN | startswith("arn:aws:secretsmanager:ap-south-1:310356785722:secret:")' >/dev/null
echo "REALTIME_TYPING_LAMBDA_VERIFIED=true"
aws iam get-role-policy --role-name "$POLICY_ROLE" --policy-name "$POLICY_NAME" --output json \
  | jq -e '[.PolicyDocument.Statement[] | .Action | if type == "string" then [.] else . end | .[]] | (index("dynamodb:UpdateItem") != null) and (index("secretsmanager:GetSecretValue") != null)' >/dev/null
echo "REALTIME_TYPING_POLICY_VERIFIED=true"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "REALTIME_TYPING_INFRA_APPLY_VERIFIED=true"
