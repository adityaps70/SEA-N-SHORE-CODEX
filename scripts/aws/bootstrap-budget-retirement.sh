#!/usr/bin/env bash
# Round 15 guarded infrastructure for the BOOTSTRAP stack (infra/aws/bootstrap), in one apply:
# - destroy the USD 50 Terraform budget sea-n-shore-staging-monthly-budget (its billing_email
#   variable is gone with it). The owner's console budget sea-n-shore-monthly-200 and the cost
#   anomaly subscription are not managed by Terraform and are never touched or imported here;
# - create a separate inline policy on the GitHub deploy role that can describe and read only the
#   health check token secret (the verify workflows send it to /api/health/home; the staging
#   deploy wires its ARN into the web task). The role's main policy, which
#   scripts/aws/github-deploy-iam.sh reconciles, must stay byte-for-byte the same.
# The bootstrap stack has no backend block in the repository: this runner finds its state in the
# Terraform state bucket (the one object whose state holds the bootstrap resources), works on a
# copy of the stack with an S3 backend override, and refuses if that state cannot be found.
# Targeted plan; anything else is refused. The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
APP_STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_STATE_LINEAGE="197a6fae-9997-636e-e52b-c3ac6da85d90"
BOOTSTRAP_SOURCE="$PWD/infra/aws/bootstrap"
ACTION_FILE="scripts/aws/bootstrap-budget-retirement-action.txt"
RETIRED_BUDGET="sea-n-shore-staging-monthly-budget"
CONSOLE_BUDGET="sea-n-shore-monthly-200"
DEPLOY_ROLE="sea-n-shore-staging-github-deploy"
DEPLOY_MAIN_POLICY="sea-n-shore-staging-github-deploy"
HEALTH_POLICY_NAME="sea-n-shore-staging-github-deploy-health-check-token"
HEALTH_SECRET_RESOURCE="arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/health-check-token-??????"

[[ "${BOOTSTRAP_BUDGET_RETIREMENT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "BOOTSTRAP_BUDGET_RETIREMENT_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$BOOTSTRAP_BUDGET_RETIREMENT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/bootstrap/main.tf \
  infra/aws/bootstrap/.terraform.lock.hcl \
  scripts/aws/bootstrap-budget-retirement.sh \
  scripts/aws/bootstrap-budget-retirement-action.txt \
  scripts/aws/bootstrap-budget-retirement.test.mjs \
  .github/workflows/aws-bootstrap-budget-retirement.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported bootstrap budget retirement action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.bootstrap-budget-retirement.XXXXXXXX")"
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
export TMPDIR="$TF_TMPDIR"
trap 'rm -rf -- "$WORK_DIR" "$TF_TMPDIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

# Find the bootstrap state: exactly one *.tfstate object (not the app stack's) holding the state
# bucket, the ECR repository and the GitHub deploy role.
aws s3api list-objects-v2 --bucket "$STATE_BUCKET" --region "$AWS_REGION" --query 'Contents[].Key' --output json > "$WORK_DIR/keys.json"
mapfile -t CANDIDATES < <(jq -r --arg app "$APP_STATE_KEY" '(. // [])[] | select(endswith(".tfstate") and . != $app)' "$WORK_DIR/keys.json")
MATCHES=()
for index in "${!CANDIDATES[@]}"; do
  key="${CANDIDATES[$index]}"
  aws s3api get-object --bucket "$STATE_BUCKET" --key "$key" --region "$AWS_REGION" "$WORK_DIR/candidate-$index.json" > "$WORK_DIR/candidate-$index-object.json"
  if jq -e --arg app "$APP_STATE_LINEAGE" '
    .lineage != $app
    and ([.resources[]? | select(.mode == "managed") | "\(.type).\(.name)"] as $have
      | ["aws_s3_bucket.terraform_state", "aws_ecr_repository.app", "aws_iam_role.github_deploy"] | all(. as $want | $have | index($want) != null))
  ' "$WORK_DIR/candidate-$index.json" >/dev/null 2>&1; then
    MATCHES+=("$index")
  fi
done
echo "BOOTSTRAP_STATE_CANDIDATES=${#CANDIDATES[@]}"
if [[ "${#MATCHES[@]}" -ne 1 ]]; then
  echo "BOOTSTRAP_STATE_MATCHES=${#MATCHES[@]}"
  for index in "${MATCHES[@]}"; do echo "BOOTSTRAP_STATE_MATCH_KEY=${CANDIDATES[$index]}"; done
  # Paths only (never contents): where an operator-run bootstrap may have left local state.
  for dir in "$HOME/SEA-N-SHORE-CODEX/infra/aws/bootstrap" /home/*/SEA-N-SHORE-CODEX/infra/aws/bootstrap; do
    if [[ -r "$dir/terraform.tfstate" ]]; then echo "BOOTSTRAP_LOCAL_STATE_CANDIDATE=$dir/terraform.tfstate"; fi
    if [[ -r "$dir/backend.tf" ]]; then echo "BOOTSTRAP_BACKEND_FILE_CANDIDATE=$dir/backend.tf"; fi
  done
  echo "Expected exactly one bootstrap Terraform state in $STATE_BUCKET; refusing (this runner never migrates or guesses state)." >&2
  exit 1
fi
STATE_INDEX="${MATCHES[0]}"
STATE_KEY="${CANDIDATES[$STATE_INDEX]}"
STATE_FILE="$WORK_DIR/candidate-$STATE_INDEX.json"
STATE_OBJECT="$WORK_DIR/candidate-$STATE_INDEX-object.json"
echo "BOOTSTRAP_STATE_KEY=$STATE_KEY"
echo "BOOTSTRAP_STATE_LINEAGE=$(jq -r '.lineage' "$STATE_FILE")"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$STATE_FILE")"
echo "BOOTSTRAP_BUDGET_IN_STATE=$(jq -r '[.resources[]? | select(.mode == "managed" and .type == "aws_budgets_budget" and .name == "monthly") | .instances[]?] | length' "$STATE_FILE")"

# The stack was applied with tfvars that are not in the repository. Every input that can reach the
# targeted resources comes from the state itself; a GitHub OIDC provider that the stack did not
# create is passed back in as existing_github_oidc_provider_arn so nothing would be created.
python3 - "$STATE_FILE" "$WORK_DIR/variables.json" <<'PY'
import json, sys
state_path, output_path = sys.argv[1:]
resources = json.load(open(state_path))['resources']
def instances(kind, name):
    return [i for r in resources if r.get('mode') == 'managed' and r.get('type') == kind and r.get('name') == name for i in (r.get('instances') or [])]
roles = instances('aws_iam_role', 'github_deploy')
assert len(roles) == 1 and roles[0]['attributes']['name'] == 'sea-n-shore-staging-github-deploy', 'unexpected GitHub deploy role in state'
values = {}
if not instances('aws_iam_openid_connect_provider', 'github'):
    policy = json.loads(roles[0]['attributes']['assume_role_policy'])
    federated = {s['Principal']['Federated'] for s in policy['Statement'] if 'Federated' in (s.get('Principal') or {})}
    assert len(federated) == 1, 'expected one federated principal on the deploy role'
    arn = federated.pop()
    assert arn == 'arn:aws:iam::310356785722:oidc-provider/token.actions.githubusercontent.com', 'unexpected OIDC provider'
    values['existing_github_oidc_provider_arn'] = arn
json.dump(values, open(output_path, 'w'))
print('BOOTSTRAP_OIDC_PROVIDER_MANAGED_BY_STACK=' + str('existing_github_oidc_provider_arn' not in values).lower())
PY

echo "== Before =="
aws budgets describe-budgets --account-id "$EXPECTED_ACCOUNT" --region us-east-1 --query 'Budgets[].BudgetName' --output json > "$WORK_DIR/budgets-before.json"
jq -r 'sort[] | "BUDGET_NAME_BEFORE=" + .' "$WORK_DIR/budgets-before.json"
aws iam get-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$DEPLOY_MAIN_POLICY" --query PolicyDocument --output json \
  | jq -S . | sha256sum | cut -d' ' -f1 > "$WORK_DIR/main-policy-before.sha256"
echo "GITHUB_DEPLOY_MAIN_POLICY_SHA256_BEFORE=$(cat "$WORK_DIR/main-policy-before.sha256")"

# Work on a copy of the stack with an S3 backend override pointing at the state found above.
BOOTSTRAP_DIR="$WORK_DIR/bootstrap"
mkdir -p "$BOOTSTRAP_DIR"
cp "$BOOTSTRAP_SOURCE"/*.tf "$BOOTSTRAP_SOURCE/.terraform.lock.hcl" "$BOOTSTRAP_DIR/"
cat > "$BOOTSTRAP_DIR/backend_override.tf" <<'TF'
terraform {
  backend "s3" {}
}
TF
terraform -chdir="$BOOTSTRAP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

# The budget is removed from the configuration, so targeting its old address plans its destroy.
TARGETS=(
  aws_budgets_budget.monthly
  aws_iam_role_policy.github_deploy_health_check_token
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform_plan_bounded "$WORK_DIR/plan.log" -chdir="$BOOTSTRAP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/bootstrap.tfplan"
terraform -chdir="$BOOTSTRAP_DIR" show -json "$WORK_DIR/bootstrap.tfplan" > "$WORK_DIR/plan.json"

cat > "$WORK_DIR/classify-plan.py" <<'PY'
import json, sys
BUDGET = 'aws_budgets_budget.monthly[0]'
POLICY = 'aws_iam_role_policy.github_deploy_health_check_token'
SECRET = 'arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/health-check-token-??????'

def refuse(message):
    raise SystemExit('Bootstrap budget retirement plan refused: ' + message)

plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
seen = set()
for r in changes:
    address, actions = r['address'], r['change']['actions']
    before, after = r['change']['before'] or {}, r['change']['after'] or {}
    seen.add(address)
    print(f"BOOTSTRAP_BUDGET_RETIREMENT_CHANGE={address}|{','.join(actions)}")
    if address == BUDGET:
        if actions != ['delete']:
            refuse(f'the budget may only be destroyed, not {actions}')
        if before.get('name') != 'sea-n-shore-staging-monthly-budget':
            refuse('only the sea-n-shore-staging-monthly-budget budget may be destroyed')
        print(f"BOOTSTRAP_BUDGET_PLANNED_DESTROY={before.get('name')}|{before.get('limit_amount')} {before.get('limit_unit')}")
    elif address == POLICY:
        if actions != ['create']:
            refuse(f'the health check token policy may only be created, not {actions}')
        if after.get('role') != 'sea-n-shore-staging-github-deploy' or after.get('name') != 'sea-n-shore-staging-github-deploy-health-check-token':
            refuse('the health check token policy must be its own inline policy on the GitHub deploy role')
        if not isinstance(after.get('policy'), str):
            refuse('the health check token policy document must be known at plan time')
        statements = json.loads(after['policy']).get('Statement') or []
        if len(statements) != 1:
            refuse('the health check token policy must hold exactly one statement')
        st = statements[0]
        actions_allowed = sorted(st.get('Action') if isinstance(st.get('Action'), list) else [st.get('Action')])
        resources = st.get('Resource') if isinstance(st.get('Resource'), list) else [st.get('Resource')]
        if st.get('Effect') != 'Allow' or actions_allowed != ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'] or resources != [SECRET] or 'Condition' in st or 'NotResource' in st or 'NotAction' in st:
            refuse('the health check token policy may only describe and read the health check token secret')
        print('GITHUB_DEPLOY_HEALTH_TOKEN_PLANNED_RESOURCE=' + resources[0])
    else:
        refuse(f'unexpected change {address} {actions}')
missing = sorted({BUDGET, POLICY} - seen)
if missing:
    refuse('expected changes are missing from the plan: ' + ','.join(missing))
print('BOOTSTRAP_BUDGET_RETIREMENT_PLAN_CHANGES=' + str(len(changes)))
PY
python3 "$WORK_DIR/classify-plan.py" "$WORK_DIR/plan.json"

echo "BOOTSTRAP_BUDGET_RETIREMENT_ACTION=$ACTION"
echo "BOOTSTRAP_BUDGET_RETIREMENT_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/bootstrap.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "BOOTSTRAP_BUDGET_RETIREMENT_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$BOOTSTRAP_BUDGET_RETIREMENT_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$STATE_OBJECT")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

# Apply exactly the saved plan that was just checked.
terraform -chdir="$BOOTSTRAP_DIR" apply -input=false -no-color "$WORK_DIR/bootstrap.tfplan" > "$WORK_DIR/apply.log"

terraform_plan_bounded "$WORK_DIR/plan-after.log" -chdir="$BOOTSTRAP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan"
terraform -chdir="$BOOTSTRAP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Bootstrap budget retirement resources still drift after apply." >&2
  exit 1
}
echo "BOOTSTRAP_BUDGET_RETIREMENT_DRIFT_FREE=true"

# Budgets by name only: the USD 50 Terraform budget is gone, the owner's console budget remains.
aws budgets describe-budgets --account-id "$EXPECTED_ACCOUNT" --region us-east-1 --query 'Budgets[].BudgetName' --output json > "$WORK_DIR/budgets-after.json"
jq -r 'sort[] | "BUDGET_NAME=" + .' "$WORK_DIR/budgets-after.json"
jq -e --arg retired "$RETIRED_BUDGET" 'index($retired) == null' "$WORK_DIR/budgets-after.json" >/dev/null || {
  echo "The retired budget $RETIRED_BUDGET still exists." >&2
  exit 1
}
echo "BOOTSTRAP_BUDGET_RETIRED_VERIFIED=true"
jq -e --arg keep "$CONSOLE_BUDGET" 'index($keep) != null' "$WORK_DIR/budgets-after.json" >/dev/null || {
  echo "The console budget $CONSOLE_BUDGET is missing." >&2
  exit 1
}
echo "CONSOLE_BUDGET_KEPT_VERIFIED=true"

aws iam get-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$HEALTH_POLICY_NAME" --output json > "$WORK_DIR/health-policy.json"
jq -e --arg secret "$HEALTH_SECRET_RESOURCE" '
  def as_array: if type == "array" then . else [.] end;
  (.PolicyDocument.Statement | length) == 1
  and .PolicyDocument.Statement[0].Effect == "Allow"
  and ((.PolicyDocument.Statement[0].Action | as_array | sort) == ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"])
  and ((.PolicyDocument.Statement[0].Resource | as_array) == [$secret])
' "$WORK_DIR/health-policy.json" >/dev/null
echo "GITHUB_DEPLOY_HEALTH_TOKEN_POLICY_VERIFIED=true"
MAIN_POLICY_AFTER="$(aws iam get-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$DEPLOY_MAIN_POLICY" --query PolicyDocument --output json | jq -S . | sha256sum | cut -d' ' -f1)"
echo "GITHUB_DEPLOY_MAIN_POLICY_SHA256_AFTER=$MAIN_POLICY_AFTER"
[[ "$MAIN_POLICY_AFTER" == "$(cat "$WORK_DIR/main-policy-before.sha256")" ]] || {
  echo "The GitHub deploy role's main policy changed; refusing to report success." >&2
  exit 1
}
echo "GITHUB_DEPLOY_MAIN_POLICY_UNCHANGED=true"
echo "STATE_SERIAL_AFTER=$(terraform -chdir="$BOOTSTRAP_DIR" state pull | jq -r '.serial')"
echo "BOOTSTRAP_BUDGET_RETIREMENT_APPLY_VERIFIED=true"
