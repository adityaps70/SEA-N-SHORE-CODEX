// Round 15: guarded bootstrap-stack release that destroys only the USD 50 Terraform budget and adds
// a deploy-role policy that can read only the health check token secret.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./bootstrap-budget-retirement.sh')
const action = (await read('./bootstrap-budget-retirement-action.txt')).trim()
const workflow = await read('../../.github/workflows/aws-bootstrap-budget-retirement.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const bootstrap = await read('../../infra/aws/bootstrap/main.tf')
const tfvarsExample = await read('../../infra/aws/bootstrap/terraform.tfvars.example')
const deployIam = await read('./github-deploy-iam.sh')

test('the bootstrap runner is guarded like the app-stack runners and finds its state without guessing', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /BOOTSTRAP_BUDGET_RETIREMENT_EXPECTED_SHA/)
  const account = script.search(/get-caller-identity/)
  const lock = script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh')
  assert.ok(account > 0 && lock > account, 'host lock right after the account check')
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  // Exactly one state object holding the bootstrap resources, never the app stack's.
  assert.match(script, /APP_STATE_LINEAGE="197a6fae-9997-636e-e52b-c3ac6da85d90"/)
  assert.match(script, /"aws_s3_bucket\.terraform_state", "aws_ecr_repository\.app", "aws_iam_role\.github_deploy"/)
  assert.match(script, /Expected exactly one bootstrap Terraform state in \$STATE_BUCKET; refusing/)
  assert.match(script, /backend "s3" \{\}/)
  assert.match(script, /-backend-config="key=\$STATE_KEY"/)
  assert.doesNotMatch(script, /terraform[^\n]* (destroy|import|state (rm|mv|push))|-auto-approve/)
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/plan\.log" -chdir="\$BOOTSTRAP_DIR" plan /)
  assert.doesNotMatch(script, /^terraform -chdir="\$BOOTSTRAP_DIR" plan /m)
  const applyAt = script.indexOf('apply -input=false -no-color "$WORK_DIR/bootstrap.tfplan"')
  assert.ok(applyAt > 0)
  assert.ok(script.indexOf('BOOTSTRAP_BUDGET_RETIREMENT_PLAN_ONLY_NO_APPLY') < applyAt)
  assert.ok(script.indexOf('git ls-remote origin refs/heads/feat/aws-native-phase-0-1') < applyAt)
  assert.ok(script.indexOf('STATE_BACKUP_VERSION=') < applyAt)
  // Never touches the console budget or the anomaly subscription.
  assert.doesNotMatch(script, /aws budgets (create|update|delete)-|aws ce |anomaly-(monitor|subscription)/i)
  for (const marker of ['BOOTSTRAP_BUDGET_RETIREMENT_DRIFT_FREE', 'BOOTSTRAP_BUDGET_RETIRED_VERIFIED', 'CONSOLE_BUDGET_KEPT_VERIFIED', 'GITHUB_DEPLOY_HEALTH_TOKEN_POLICY_VERIFIED', 'GITHUB_DEPLOY_MAIN_POLICY_UNCHANGED', 'BOOTSTRAP_BUDGET_RETIREMENT_APPLY_VERIFIED']) {
    assert.match(script, new RegExp(`${marker}=true`), marker)
  }
  assert.match(script, /CONSOLE_BUDGET="sea-n-shore-monthly-200"/)
  assert.match(script, /RETIRED_BUDGET="sea-n-shore-staging-monthly-budget"/)
  assert.match(script, /--query 'Budgets\[\]\.BudgetName'/)

  assert.match(workflow, /name: AWS Bootstrap Budget Retirement/)
  assert.match(workflow, /group: sea-n-shore-bootstrap-budget-retirement\n  cancel-in-progress: false/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /apply-once is allowed only from an exact branch push/)
  assert.match(workflow, /export BOOTSTRAP_BUDGET_RETIREMENT_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /- infra\/aws\/bootstrap\/main\.tf\n/)
  assert.match(workflow, /grep -q 'BOOTSTRAP_BUDGET_RETIREMENT_APPLY_VERIFIED=true'/)
  assert.match(ci, /node --test scripts\/aws\/bootstrap-budget-retirement\.test\.mjs/)
})

test('Terraform: no budget or billing email; a separate least-privilege health token policy on the deploy role', () => {
  assert.doesNotMatch(bootstrap, /aws_budgets_budget|variable "billing_email"|variable "monthly_budget_usd"|var\.billing_email/)
  assert.doesNotMatch(tfvarsExample, /billing_email|monthly_budget_usd/)
  const start = bootstrap.indexOf('resource "aws_iam_role_policy" "github_deploy_health_check_token"')
  assert.ok(start > 0)
  const policy = bootstrap.slice(start, bootstrap.indexOf('\n}\n', start))
  assert.match(policy, /name = "\$\{local\.name_prefix\}-github-deploy-health-check-token"/)
  assert.match(policy, /role = aws_iam_role\.github_deploy\.id/)
  assert.match(policy, /Action = \[\n\s+"secretsmanager:DescribeSecret",\n\s+"secretsmanager:GetSecretValue"\n\s+\]/)
  assert.match(policy, /Resource = "arn:aws:secretsmanager:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:secret:\$\{local\.name_prefix\}\/health-check-token-\?\?\?\?\?\?"/)
  assert.doesNotMatch(policy, /secretsmanager:\*|PutSecretValue|ListSecrets|Resource\s*=\s*"\*"/)
  // The main deploy policy (reconciled by github-deploy-iam.sh) gains nothing.
  const main = bootstrap.slice(bootstrap.indexOf('resource "aws_iam_role_policy" "github_deploy" {'), start)
  assert.doesNotMatch(main, /secretsmanager/)
  assert.doesNotMatch(deployIam, /health-check-token|secretsmanager/)
})

const classifierStart = script.indexOf(`cat > "$WORK_DIR/classify-plan.py" <<'PY'\n`)
const classifier = script.slice(script.indexOf('\n', classifierStart) + 1, script.indexOf('\nPY\n', classifierStart))
const secret = 'arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/health-check-token-??????'
const policyDoc = (statement) => JSON.stringify({ Version: '2012-10-17', Statement: [statement] })
const goodStatement = { Sid: 'ReadHealthCheckTokenSecret', Effect: 'Allow', Action: ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'], Resource: secret }
const budgetChange = (actions = ['delete'], name = 'sea-n-shore-staging-monthly-budget') => ({ address: 'aws_budgets_budget.monthly[0]', mode: 'managed', change: { actions, before: { name, limit_amount: '50.0', limit_unit: 'USD' }, after: null } })
const policyChange = (statement = goodStatement, overrides = {}) => ({
  address: 'aws_iam_role_policy.github_deploy_health_check_token',
  mode: 'managed',
  change: { actions: ['create'], before: null, after: { role: 'sea-n-shore-staging-github-deploy', name: 'sea-n-shore-staging-github-deploy-health-check-token', policy: policyDoc(statement), ...overrides } },
})

async function classify(resourceChanges) {
  const dir = await mkdtemp(join(tmpdir(), 'bootstrap-budget-plan-'))
  try {
    const planPath = join(dir, 'plan.json')
    const classifierPath = join(dir, 'classify.py')
    await writeFile(planPath, JSON.stringify({ resource_changes: resourceChanges }))
    await writeFile(classifierPath, classifier)
    const run = spawnSync('python3', [classifierPath, planPath], { encoding: 'utf8' })
    return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the classifier accepts only the budget destroy and the health token policy create', async () => {
  const accepted = await classify([budgetChange(), policyChange()])
  assert.equal(accepted.ok, true, accepted.output)
  assert.match(accepted.output, /BOOTSTRAP_BUDGET_PLANNED_DESTROY=sea-n-shore-staging-monthly-budget\|50\.0 USD/)
  assert.match(accepted.output, /BOOTSTRAP_BUDGET_RETIREMENT_PLAN_CHANGES=2/)

  const cases = [
    ['the console budget', [budgetChange(['delete'], 'sea-n-shore-monthly-200'), policyChange()], /only the sea-n-shore-staging-monthly-budget budget/],
    ['replacing the budget', [budgetChange(['delete', 'create']), policyChange()], /may only be destroyed/],
    ['a deploy role change', [budgetChange(), policyChange(), { address: 'aws_iam_role.github_deploy', mode: 'managed', change: { actions: ['update'], before: {}, after: {} } }], /unexpected change aws_iam_role\.github_deploy/],
    ['the main deploy policy', [budgetChange(), policyChange(), { address: 'aws_iam_role_policy.github_deploy', mode: 'managed', change: { actions: ['update'], before: {}, after: {} } }], /unexpected change aws_iam_role_policy\.github_deploy /],
    ['a new OIDC provider', [budgetChange(), policyChange(), { address: 'aws_iam_openid_connect_provider.github[0]', mode: 'managed', change: { actions: ['create'], before: null, after: {} } }], /unexpected change/],
    ['a wildcard secret', [budgetChange(), policyChange({ ...goodStatement, Resource: 'arn:aws:secretsmanager:ap-south-1:310356785722:secret:*' })], /only describe and read the health check token secret/],
    ['an extra action', [budgetChange(), policyChange({ ...goodStatement, Action: [...goodStatement.Action, 'secretsmanager:PutSecretValue'] })], /only describe and read/],
    ['a policy on another role', [budgetChange(), policyChange(goodStatement, { role: 'sea-n-shore-staging-ecs-task' })], /its own inline policy on the GitHub deploy role/],
    ['the budget left in place', [policyChange()], /expected changes are missing from the plan: aws_budgets_budget\.monthly\[0\]/],
  ]
  for (const [label, plan, pattern] of cases) {
    const result = await classify(plan)
    assert.equal(result.ok, false, `${label} must be refused`)
    assert.match(result.output, pattern, label)
  }
})
