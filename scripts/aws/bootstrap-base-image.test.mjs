// Round I: guarded bootstrap-stack release that creates only the private ECR repository for our own copy of the
// node base image, its lifecycle rule, and a deploy-role policy that can pull from and push to that repository only.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./bootstrap-base-image.sh')
const action = guardAction(await read('./bootstrap-base-image-action.txt'))
const workflow = await read('../../.github/workflows/aws-bootstrap-base-image.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const bootstrap = await read('../../infra/aws/bootstrap/main.tf')
const deployIam = await read('./github-deploy-iam.sh')
const budgetRunner = await read('./bootstrap-budget-retirement.sh')

const ARN = 'arn:aws:ecr:ap-south-1:310356785722:repository/sea-n-shore-base/node'
const ACTIONS = [
  'ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:CompleteLayerUpload', 'ecr:GetDownloadUrlForLayer',
  'ecr:InitiateLayerUpload', 'ecr:PutImage', 'ecr:UploadLayerPart',
]

test('the base image runner is guarded like the other bootstrap runners and finds its state the same way', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /BOOTSTRAP_BASE_IMAGE_EXPECTED_SHA/)
  const account = script.search(/get-caller-identity/)
  const lock = script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh')
  assert.ok(account > 0 && lock > account, 'host lock right after the account check')
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  // The state discovery and backend override are the budget retirement runner's, verbatim.
  for (const [marker, end] of [['# Find the bootstrap state:', 'echo "BOOTSTRAP_STATE_KEY='], ['# The stack was applied with tfvars', 'echo "== Before =="'], ['# Work on a copy of the stack with an S3 backend override', '\n\n']]) {
    const at = budgetRunner.indexOf(marker)
    const block = budgetRunner.slice(at, budgetRunner.indexOf(end, at))
    assert.ok(block.length > 200 && script.includes(block), marker)
  }
  assert.match(script, /"aws_s3_bucket\.terraform_state", "aws_ecr_repository\.app", "aws_iam_role\.github_deploy"/)
  assert.match(script, /Expected exactly one bootstrap Terraform state in \$STATE_BUCKET; refusing/)
  assert.doesNotMatch(script, /terraform[^\n]* (destroy|import|state (rm|mv|push))|-auto-approve/)
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/plan\.log" -chdir="\$BOOTSTRAP_DIR" plan /)
  assert.doesNotMatch(script, /^terraform -chdir="\$BOOTSTRAP_DIR" plan /m)
  for (const target of ['aws_ecr_repository.base_image', 'aws_ecr_lifecycle_policy.base_image', 'aws_iam_role_policy.github_deploy_base_image']) {
    assert.match(script, new RegExp(`^  ${target.replaceAll('.', '\\.')}$`, 'm'), target)
  }
  const applyAt = script.indexOf('apply -input=false -no-color "$WORK_DIR/bootstrap.tfplan"')
  assert.ok(applyAt > 0)
  assert.ok(script.indexOf('BOOTSTRAP_BASE_IMAGE_PLAN_ONLY_NO_APPLY') < applyAt)
  assert.ok(script.indexOf('bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1') < applyAt)
  assert.ok(script.indexOf('STATE_BACKUP_VERSION=') < applyAt)
  // Creates only: no image is copied, deleted or retagged here, and no repository is deleted.
  assert.doesNotMatch(script, /aws ecr (delete|batch-delete|put-image|create-repository|set-repository-policy)|skopeo|docker /)
  for (const marker of ['BOOTSTRAP_BASE_IMAGE_DRIFT_FREE', 'BOOTSTRAP_BASE_IMAGE_REPOSITORY_VERIFIED', 'BOOTSTRAP_BASE_IMAGE_LIFECYCLE_VERIFIED', 'APP_REPOSITORY_KEPT_VERIFIED', 'GITHUB_DEPLOY_BASE_IMAGE_POLICY_VERIFIED', 'GITHUB_DEPLOY_MAIN_POLICY_UNCHANGED', 'BOOTSTRAP_BASE_IMAGE_APPLY_VERIFIED']) {
    assert.match(script, new RegExp(`${marker}=true`), marker)
  }
  assert.ok(script.indexOf('GITHUB_DEPLOY_MAIN_POLICY_SHA256_BEFORE=') < applyAt)

  assert.match(workflow, /name: AWS Bootstrap Base Image/)
  assert.match(workflow, /group: sea-n-shore-bootstrap-base-image\n  cancel-in-progress: false/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/bootstrap-base-image-action\.txt\n\s+shell: bash\n\s+run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /apply-once is allowed only from an exact branch push/)
  assert.match(workflow, /export BOOTSTRAP_BASE_IMAGE_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /- infra\/aws\/bootstrap\/main\.tf\n/)
  assert.match(workflow, /grep -q 'BOOTSTRAP_BASE_IMAGE_APPLY_VERIFIED=true'/)
  assert.doesNotMatch(workflow, /udget/)
  assert.match(ci, /node --test scripts\/aws\/bootstrap-base-image\.test\.mjs/)
})

test('Terraform: an immutable, scanned base image repository and a separate least-privilege deploy-role policy', () => {
  const repoStart = bootstrap.indexOf('resource "aws_ecr_repository" "base_image" {')
  assert.ok(repoStart > 0)
  const repo = bootstrap.slice(repoStart, bootstrap.indexOf('\n}\n', repoStart))
  assert.match(repo, /name\s+= "\$\{var\.project_name\}-base\/node"/)
  assert.match(repo, /image_tag_mutability = "IMMUTABLE"/)
  assert.match(repo, /force_delete\s+= false/)
  assert.match(repo, /scan_on_push = true/)

  const lifecycleStart = bootstrap.indexOf('resource "aws_ecr_lifecycle_policy" "base_image" {')
  const lifecycle = bootstrap.slice(lifecycleStart, bootstrap.indexOf('\n}\n', lifecycleStart))
  assert.match(lifecycle, /repository = aws_ecr_repository\.base_image\.name/)
  assert.match(lifecycle, /countNumber = 5/)

  const start = bootstrap.indexOf('resource "aws_iam_role_policy" "github_deploy_base_image" {')
  assert.ok(start > 0)
  const policy = bootstrap.slice(start, bootstrap.indexOf('\n}\n', start))
  assert.match(policy, /name = "\$\{local\.name_prefix\}-github-deploy-base-image"/)
  assert.match(policy, /role = aws_iam_role\.github_deploy\.id/)
  assert.match(policy, new RegExp(`Action = \\[\\n${ACTIONS.map((a) => `\\s+"${a}"`).join(',\\n')}\\n\\s+\\]`))
  // The ARN is known at plan time, so the plan classifier sees the exact resource.
  assert.match(policy, /Resource = "arn:aws:ecr:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:repository\/\$\{aws_ecr_repository\.base_image\.name\}"/)
  assert.doesNotMatch(policy, /ecr:\*|DeleteRepository|BatchDeleteImage|SetRepositoryPolicy|Resource\s*=\s*"\*"/)
  // The main deploy policy (reconciled by github-deploy-iam.sh) gains nothing.
  const main = bootstrap.slice(bootstrap.indexOf('resource "aws_iam_role_policy" "github_deploy" {'), bootstrap.indexOf('\n}\n', bootstrap.indexOf('resource "aws_iam_role_policy" "github_deploy" {')))
  assert.doesNotMatch(main, /aws_ecr_repository\.base_image|-base\/node|sea-n-shore-base/)
  assert.doesNotMatch(deployIam, /base_image|-base\/node|sea-n-shore-base/)
})

const classifierStart = script.indexOf(`cat > "$WORK_DIR/classify-plan.py" <<'PY'\n`)
const classifier = script.slice(script.indexOf('\n', classifierStart) + 1, script.indexOf('\nPY\n', classifierStart))
const goodStatement = { Sid: 'CopyAndPullNodeBaseImage', Effect: 'Allow', Action: ACTIONS, Resource: ARN }
const repositoryChange = (after = {}, actions = ['create']) => ({
  address: 'aws_ecr_repository.base_image', mode: 'managed',
  change: { actions, before: null, after: { name: 'sea-n-shore-base/node', image_tag_mutability: 'IMMUTABLE', force_delete: false, image_scanning_configuration: [{ scan_on_push: true }], ...after } },
})
const lifecycleRules = (count = 5) => JSON.stringify({ rules: [{ rulePriority: 1, selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: count }, action: { type: 'expire' } }] })
const lifecycleChange = (after = {}) => ({
  address: 'aws_ecr_lifecycle_policy.base_image', mode: 'managed',
  change: { actions: ['create'], before: null, after: { repository: 'sea-n-shore-base/node', policy: lifecycleRules(), ...after } },
})
const policyChange = (statement = goodStatement, overrides = {}) => ({
  address: 'aws_iam_role_policy.github_deploy_base_image', mode: 'managed',
  change: { actions: ['create'], before: null, after: { role: 'sea-n-shore-staging-github-deploy', name: 'sea-n-shore-staging-github-deploy-base-image', policy: JSON.stringify({ Version: '2012-10-17', Statement: [statement] }), ...overrides } },
})

async function classify(resourceChanges) {
  const dir = await mkdtemp(join(tmpdir(), 'bootstrap-base-image-plan-'))
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

test('the classifier accepts only the three creates, exactly as configured', async () => {
  const accepted = await classify([repositoryChange(), lifecycleChange(), policyChange()])
  assert.equal(accepted.ok, true, accepted.output)
  assert.match(accepted.output, /BOOTSTRAP_BASE_IMAGE_PLANNED_REPOSITORY=sea-n-shore-base\/node/)
  assert.match(accepted.output, /BOOTSTRAP_BASE_IMAGE_PLANNED_KEEP=5/)
  assert.match(accepted.output, /GITHUB_DEPLOY_BASE_IMAGE_PLANNED_RESOURCE=arn:aws:ecr:ap-south-1:310356785722:repository\/sea-n-shore-base\/node/)
  assert.match(accepted.output, /BOOTSTRAP_BASE_IMAGE_PLAN_CHANGES=3/)

  const all = (overrides) => [repositoryChange(), lifecycleChange(), policyChange(), ...overrides]
  const cases = [
    ['another repository name', [repositoryChange({ name: 'sea-n-shore' }), lifecycleChange(), policyChange()], /only the sea-n-shore-base\/node repository/],
    ['mutable tags', [repositoryChange({ image_tag_mutability: 'MUTABLE' }), lifecycleChange(), policyChange()], /immutable tags and no force delete/],
    ['force delete', [repositoryChange({ force_delete: true }), lifecycleChange(), policyChange()], /immutable tags and no force delete/],
    ['no scan on push', [repositoryChange({ image_scanning_configuration: [{ scan_on_push: false }] }), lifecycleChange(), policyChange()], /scan on push/],
    ['replacing the repository', [repositoryChange({}, ['delete', 'create']), lifecycleChange(), policyChange()], /may only be created/],
    ['a lifecycle rule on another repository', [repositoryChange(), lifecycleChange({ repository: 'sea-n-shore' }), policyChange()], /must belong to the base image repository/],
    ['a lifecycle rule that keeps one image', [repositoryChange(), lifecycleChange({ policy: lifecycleRules(1) }), policyChange()], /beyond a count of at least 2/],
    ['the application repository', all([{ address: 'aws_ecr_repository.app', mode: 'managed', change: { actions: ['update'], before: {}, after: {} } }]), /unexpected change aws_ecr_repository\.app/],
    ['the main deploy policy', all([{ address: 'aws_iam_role_policy.github_deploy', mode: 'managed', change: { actions: ['update'], before: {}, after: {} } }]), /unexpected change aws_iam_role_policy\.github_deploy /],
    ['a deploy role change', all([{ address: 'aws_iam_role.github_deploy', mode: 'managed', change: { actions: ['update'], before: {}, after: {} } }]), /unexpected change aws_iam_role\.github_deploy/],
    ['a wildcard repository', [repositoryChange(), lifecycleChange(), policyChange({ ...goodStatement, Resource: 'arn:aws:ecr:ap-south-1:310356785722:repository/*' })], /only pull from and push to the base image repository/],
    ['an extra action', [repositoryChange(), lifecycleChange(), policyChange({ ...goodStatement, Action: [...ACTIONS, 'ecr:BatchDeleteImage'] })], /only pull from and push to/],
    ['a policy on another role', [repositoryChange(), lifecycleChange(), policyChange(goodStatement, { role: 'sea-n-shore-staging-ecs-task' })], /its own inline policy on the GitHub deploy role/],
    ['an unknown policy document', [repositoryChange(), lifecycleChange(), policyChange(goodStatement, { policy: null })], /known at plan time/],
    ['the policy left out', [repositoryChange(), lifecycleChange()], /expected changes are missing from the plan: aws_iam_role_policy\.github_deploy_base_image/],
  ]
  for (const [label, plan, pattern] of cases) {
    const result = await classify(plan)
    assert.equal(result.ok, false, `${label} must be refused`)
    assert.match(result.output, pattern, label)
  }
})

test('after the apply an empty plan reads as already applied, and apply-once refuses it', async () => {
  const result = await classify([])
  assert.equal(result.ok, true, result.output)
  assert.match(result.output, /BOOTSTRAP_BASE_IMAGE_ALREADY_APPLIED=true/)
  assert.match(script, /The base image repository and policy are already applied; nothing to apply\./)
})
