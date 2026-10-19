#!/usr/bin/env bash
# Round I guarded infrastructure for the BOOTSTRAP stack (infra/aws/bootstrap), in one apply:
# - create the private ECR repository sea-n-shore-base/node (immutable tags, scan on push, keep the latest 5) that
#   holds our own copy of the pinned node base image (scripts/aws/node-base-image.env). Deploy builds pulled it from
#   Amazon ECR Public and failed twice on 429 "Data limit exceeded";
# - create a separate inline policy on the GitHub deploy role that can pull from and push to that repository only
#   (the deploy copies the pinned digest there once, scripts/aws/node-base-image.sh). The role's main policy, which
#   scripts/aws/github-deploy-iam.sh reconciles, must stay byte-for-byte the same.
# Nothing is copied here: the next deploy copies the image. Like the budget retirement runner, this finds the
# bootstrap state in the Terraform state bucket, works on a copy of the stack with an S3 backend override, and
# refuses if that state cannot be found. Targeted plan; anything else is refused. The action file holds "plan" or
# "apply-once".
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
ACTION_FILE="scripts/aws/bootstrap-base-image-action.txt"
BASE_REPOSITORY="sea-n-shore-base/node"
BASE_REPOSITORY_ARN="arn:aws:ecr:ap-south-1:310356785722:repository/sea-n-shore-base/node"
APP_REPOSITORY="sea-n-shore"
DEPLOY_ROLE="sea-n-shore-staging-github-deploy"
DEPLOY_MAIN_POLICY="sea-n-shore-staging-github-deploy"
BASE_POLICY_NAME="sea-n-shore-staging-github-deploy-base-image"

[[ "${BOOTSTRAP_BASE_IMAGE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "BOOTSTRAP_BASE_IMAGE_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$BOOTSTRAP_BASE_IMAGE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/bootstrap/main.tf \
  infra/aws/bootstrap/.terraform.lock.hcl \
  scripts/aws/bootstrap-base-image.sh \
  scripts/aws/bootstrap-base-image-action.txt \
  scripts/aws/bootstrap-base-image.test.mjs \
  .github/workflows/aws-bootstrap-base-image.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported bootstrap base image action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.bootstrap-base-image.XXXXXXXX")"
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
echo "BOOTSTRAP_BASE_IMAGE_REPOSITORY_IN_STATE=$(jq -r '[.resources[]? | select(.mode == "managed" and .type == "aws_ecr_repository" and .name == "base_image") | .instances[]?] | length' "$STATE_FILE")"

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
aws ecr describe-repositories --region "$AWS_REGION" --query 'repositories[].repositoryName' --output json > "$WORK_DIR/repositories-before.json"
jq -r 'sort[] | "ECR_REPOSITORY_BEFORE=" + .' "$WORK_DIR/repositories-before.json"
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

TARGETS=(
  aws_ecr_repository.base_image
  aws_ecr_lifecycle_policy.base_image
  aws_iam_role_policy.github_deploy_base_image
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform_plan_bounded "$WORK_DIR/plan.log" -chdir="$BOOTSTRAP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/bootstrap.tfplan"
terraform -chdir="$BOOTSTRAP_DIR" show -json "$WORK_DIR/bootstrap.tfplan" > "$WORK_DIR/plan.json"

cat > "$WORK_DIR/classify-plan.py" <<'PY'
import json, sys
REPOSITORY = 'aws_ecr_repository.base_image'
LIFECYCLE = 'aws_ecr_lifecycle_policy.base_image'
POLICY = 'aws_iam_role_policy.github_deploy_base_image'
NAME = 'sea-n-shore-base/node'
ARN = 'arn:aws:ecr:ap-south-1:310356785722:repository/sea-n-shore-base/node'
ACTIONS = sorted([
    'ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:CompleteLayerUpload', 'ecr:GetDownloadUrlForLayer',
    'ecr:InitiateLayerUpload', 'ecr:PutImage', 'ecr:UploadLayerPart',
])

def refuse(message):
    raise SystemExit('Bootstrap base image plan refused: ' + message)

def as_list(value):
    return value if isinstance(value, list) else [value]

plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
seen = set()
for r in changes:
    address, actions = r['address'], r['change']['actions']
    after = r['change']['after'] or {}
    seen.add(address)
    print(f"BOOTSTRAP_BASE_IMAGE_CHANGE={address}|{','.join(actions)}")
    if address not in (REPOSITORY, LIFECYCLE, POLICY):
        refuse(f'unexpected change {address} {actions}')
    if actions != ['create']:
        refuse(f'{address} may only be created, not {actions}')
    if address == REPOSITORY:
        if after.get('name') != NAME:
            refuse('only the sea-n-shore-base/node repository may be created')
        if after.get('image_tag_mutability') != 'IMMUTABLE' or after.get('force_delete') is not False:
            refuse('the base image repository must have immutable tags and no force delete')
        scanning = after.get('image_scanning_configuration') or [{}]
        if scanning[0].get('scan_on_push') is not True:
            refuse('the base image repository must scan on push')
        print('BOOTSTRAP_BASE_IMAGE_PLANNED_REPOSITORY=' + NAME)
    elif address == LIFECYCLE:
        if after.get('repository') != NAME or not isinstance(after.get('policy'), str):
            refuse('the lifecycle policy must belong to the base image repository')
        rules = json.loads(after['policy']).get('rules') or []
        if len(rules) != 1:
            refuse('the lifecycle policy must hold exactly one rule')
        selection = rules[0].get('selection') or {}
        count = selection.get('countNumber')
        if (rules[0].get('action') or {}).get('type') != 'expire' or selection.get('countType') != 'imageCountMoreThan' or not isinstance(count, int) or count < 2:
            refuse('the lifecycle policy may only expire images beyond a count of at least 2')
        print(f'BOOTSTRAP_BASE_IMAGE_PLANNED_KEEP={count}')
    else:
        if after.get('role') != 'sea-n-shore-staging-github-deploy' or after.get('name') != 'sea-n-shore-staging-github-deploy-base-image':
            refuse('the base image policy must be its own inline policy on the GitHub deploy role')
        if not isinstance(after.get('policy'), str):
            refuse('the base image policy document must be known at plan time')
        statements = json.loads(after['policy']).get('Statement') or []
        if len(statements) != 1:
            refuse('the base image policy must hold exactly one statement')
        st = statements[0]
        if st.get('Effect') != 'Allow' or sorted(as_list(st.get('Action'))) != ACTIONS or as_list(st.get('Resource')) != [ARN] or 'Condition' in st or 'NotResource' in st or 'NotAction' in st:
            refuse('the base image policy may only pull from and push to the base image repository')
        print('GITHUB_DEPLOY_BASE_IMAGE_PLANNED_RESOURCE=' + ARN)
if not changes:
    # After the apply nothing is left to change; a partial plan is still refused below.
    print('BOOTSTRAP_BASE_IMAGE_ALREADY_APPLIED=true')
    print('BOOTSTRAP_BASE_IMAGE_PLAN_CHANGES=0')
    raise SystemExit(0)
missing = sorted({REPOSITORY, LIFECYCLE, POLICY} - seen)
if missing:
    refuse('expected changes are missing from the plan: ' + ','.join(missing))
print('BOOTSTRAP_BASE_IMAGE_PLAN_CHANGES=' + str(len(changes)))
PY
python3 "$WORK_DIR/classify-plan.py" "$WORK_DIR/plan.json" | tee "$WORK_DIR/classify.out"

echo "BOOTSTRAP_BASE_IMAGE_ACTION=$ACTION"
echo "BOOTSTRAP_BASE_IMAGE_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/bootstrap.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "BOOTSTRAP_BASE_IMAGE_PLAN_ONLY_NO_APPLY"
  exit 0
fi
if grep -qx 'BOOTSTRAP_BASE_IMAGE_ALREADY_APPLIED=true' "$WORK_DIR/classify.out"; then
  echo "The base image repository and policy are already applied; nothing to apply." >&2
  exit 1
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$BOOTSTRAP_BASE_IMAGE_EXPECTED_SHA" ]]
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
  echo "Bootstrap base image resources still drift after apply." >&2
  exit 1
}
echo "BOOTSTRAP_BASE_IMAGE_DRIFT_FREE=true"

# The repository exists as planned, with its lifecycle rule, and the application repository is still there.
aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$BASE_REPOSITORY" --output json > "$WORK_DIR/base-repository.json"
jq -e --arg arn "$BASE_REPOSITORY_ARN" '
  (.repositories | length) == 1
  and .repositories[0].repositoryArn == $arn
  and .repositories[0].imageTagMutability == "IMMUTABLE"
  and .repositories[0].imageScanningConfiguration.scanOnPush == true
' "$WORK_DIR/base-repository.json" >/dev/null
echo "BOOTSTRAP_BASE_IMAGE_REPOSITORY_VERIFIED=true"
aws ecr get-lifecycle-policy --region "$AWS_REGION" --repository-name "$BASE_REPOSITORY" --query lifecyclePolicyText --output text \
  | jq -e '(.rules | length) == 1 and .rules[0].action.type == "expire" and .rules[0].selection.countType == "imageCountMoreThan"' >/dev/null
echo "BOOTSTRAP_BASE_IMAGE_LIFECYCLE_VERIFIED=true"
[[ "$(aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$APP_REPOSITORY" --query 'repositories[0].repositoryName' --output text)" == "$APP_REPOSITORY" ]]
echo "APP_REPOSITORY_KEPT_VERIFIED=true"

aws iam get-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$BASE_POLICY_NAME" --output json > "$WORK_DIR/base-policy.json"
jq -e --arg arn "$BASE_REPOSITORY_ARN" '
  def as_array: if type == "array" then . else [.] end;
  (.PolicyDocument.Statement | length) == 1
  and .PolicyDocument.Statement[0].Effect == "Allow"
  and ((.PolicyDocument.Statement[0].Action | as_array | sort) == ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"])
  and ((.PolicyDocument.Statement[0].Resource | as_array) == [$arn])
' "$WORK_DIR/base-policy.json" >/dev/null
echo "GITHUB_DEPLOY_BASE_IMAGE_POLICY_VERIFIED=true"
MAIN_POLICY_AFTER="$(aws iam get-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$DEPLOY_MAIN_POLICY" --query PolicyDocument --output json | jq -S . | sha256sum | cut -d' ' -f1)"
echo "GITHUB_DEPLOY_MAIN_POLICY_SHA256_AFTER=$MAIN_POLICY_AFTER"
[[ "$MAIN_POLICY_AFTER" == "$(cat "$WORK_DIR/main-policy-before.sha256")" ]] || {
  echo "The GitHub deploy role's main policy changed; refusing to report success." >&2
  exit 1
}
echo "GITHUB_DEPLOY_MAIN_POLICY_UNCHANGED=true"
echo "STATE_SERIAL_AFTER=$(terraform -chdir="$BOOTSTRAP_DIR" state pull | jq -r '.serial')"
echo "BOOTSTRAP_BASE_IMAGE_APPLY_VERIFIED=true"
