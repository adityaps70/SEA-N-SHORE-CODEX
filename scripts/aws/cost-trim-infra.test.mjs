// Round DB (cost, owner-approved 11 Nov): the cost trim runner changes exactly the approved things and nothing else.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const script = read('./cost-trim-infra.sh')
const workflow = read('../../.github/workflows/aws-cost-trim-infra.yml')
const checker = new URL('./check-cost-trim-plan.py', import.meta.url).pathname
const main = read('../../infra/aws/app/main.tf')
const bootstrap = read('../../infra/aws/bootstrap/main.tf')

test('the guard reads plan or apply-once and the runner is pinned to its commit', () => {
  assert.ok(['plan', 'apply-once'].includes(guardAction(read('./cost-trim-infra-action.txt'))))
  assert.match(script, /\[\[ "\$\{COST_TRIM_INFRA_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$ \]\]/)
  assert.match(script, /\[\[ "\$\(git rev-parse HEAD\)" == "\$COST_TRIM_INFRA_EXPECTED_SHA" \]\]/)
  assert.match(script, /case "\$ACTION" in plan\|apply-once\) ;;/)
  assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
  for (const file of ['infra/aws/app/main.tf', 'infra/aws/app/web-resilience.tf', 'infra/aws/bootstrap/main.tf', 'scripts/aws/check-cost-trim-plan.py']) {
    assert.ok(script.includes(`  ${file} \\\n`), `the runner refuses a changed ${file}`)
    assert.ok(workflow.includes(`      - ${file}\n`), `the workflow watches ${file}`)
  }
  assert.doesNotMatch(script, /-auto-approve|terraform[^\n]* destroy/)
  assert.match(workflow, /name: AWS Cost Trim Infrastructure/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /export COST_TRIM_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment: staging-apply/)
})

test('Terraform: Container Insights off, the running-tasks alarm on HealthyHostCount, the ephemeral alarm gone, ECR keeps 10 + 10', () => {
  assert.match(main, /setting \{\n\s+name\s+= "containerInsights"\n\s+value = "disabled"\n\s+\}/)
  assert.deepEqual([...script.matchAll(/^  (aws_[a-z_]+\.[a-z_]+)$/gm)].map((m) => m[1]), [
    'aws_ecs_cluster.app', 'aws_cloudwatch_metric_alarm.web_running_tasks_low', 'aws_cloudwatch_metric_alarm.web_ephemeral_storage_high',
  ])
  const lifecycle = bootstrap.slice(bootstrap.indexOf('resource "aws_ecr_lifecycle_policy" "app"'), bootstrap.indexOf('resource "aws_ecr_repository" "base_image"'))
  const policy = JSON.parse(/LIFECYCLE_POLICY='([^']+)'/.exec(script)[1])
  assert.deepEqual(policy.rules.map((r) => [r.rulePriority, r.selection.tagStatus, r.selection.tagPrefixList ?? null, r.selection.countNumber]), [
    [1, 'tagged', ['social-'], 10], [2, 'any', null, 10],
  ])
  // The runner's policy is the one in the bootstrap stack, rule for rule.
  for (const rule of policy.rules) {
    assert.ok(lifecycle.includes(`rulePriority = ${rule.rulePriority}`) && lifecycle.includes(`description  = "${rule.description}"`), rule.description)
  }
  assert.match(lifecycle, /tagPrefixList = \["social-"\]/)
  assert.equal((lifecycle.match(/countNumber\s+= 10/g) ?? []).length, 2)
})

function plan(changes) {
  return { resource_changes: changes.map(([address, actions, before, after]) => ({ address, mode: 'managed', change: { actions, before, after } })) }
}
const ALARM_BEFORE = {
  alarm_name: 'sea-n-shore-staging-web-running-tasks-low', namespace: 'ECS/ContainerInsights', metric_name: 'RunningTaskCount',
  dimensions: { ClusterName: 'sea-n-shore-staging', ServiceName: 'sea-n-shore-staging-web' }, statistic: 'Minimum', period: 60,
  evaluation_periods: 5, threshold: 2, comparison_operator: 'LessThanThreshold', treat_missing_data: 'breaching',
  alarm_actions: ['arn:aws:sns:ap-south-1:310356785722:sea-n-shore-staging-alerts'], alarm_description: 'Fewer than 2 web tasks running for 5 minutes.',
}
const ALARM_AFTER = {
  ...ALARM_BEFORE, namespace: 'AWS/ApplicationELB', metric_name: 'HealthyHostCount', alarm_description: 'Fewer than 2 healthy web targets behind the ALB for 5 minutes.',
  dimensions: { TargetGroup: 'targetgroup/sea-n-shore-staging-web/0123456789abcdef', LoadBalancer: 'app/sea-n-shore-staging-alb/0123456789abcdef' },
}
const CLUSTER_BEFORE = { name: 'sea-n-shore-staging', setting: [{ name: 'containerInsights', value: 'enabled' }] }
const CLUSTER_AFTER = { name: 'sea-n-shore-staging', setting: [{ name: 'containerInsights', value: 'disabled' }] }
const GOOD = [
  ['aws_ecs_cluster.app', ['update'], CLUSTER_BEFORE, CLUSTER_AFTER],
  ['aws_cloudwatch_metric_alarm.web_running_tasks_low', ['update'], ALARM_BEFORE, ALARM_AFTER],
  ['aws_cloudwatch_metric_alarm.web_ephemeral_storage_high', ['delete'], { alarm_name: 'x' }, null],
]

function runChecker(changes) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cost-trim-plan-'))
  try {
    const file = path.join(dir, 'plan.json')
    writeFileSync(file, JSON.stringify(plan(changes)))
    return spawnSync('python3', ['-I', checker, file], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the plan check accepts exactly the approved changes, or none', () => {
  const ok = runChecker(GOOD)
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /^COST_TRIM_PLAN_CHANGES=3$/m)
  assert.equal(runChecker([]).status, 0)
  assert.match(runChecker([]).stdout, /^COST_TRIM_PLAN_CHANGES=0$/m)
})

test('the plan check refuses anything else', () => {
  const refused = (changes, why) => assert.notEqual(runChecker(changes).status, 0, why)
  refused([['aws_ecs_cluster.app', ['delete', 'create'], CLUSTER_BEFORE, CLUSTER_AFTER]], 'replacing the cluster')
  refused([['aws_ecs_cluster.app', ['update'], CLUSTER_BEFORE, { ...CLUSTER_AFTER, name: 'other' }]], 'renaming the cluster')
  refused([['aws_ecs_cluster.app', ['update'], CLUSTER_BEFORE, { ...CLUSTER_AFTER, setting: [{ name: 'containerInsights', value: 'enhanced' }] }]], 'enhanced insights')
  refused([['aws_cloudwatch_metric_alarm.web_running_tasks_low', ['update'], ALARM_BEFORE, { ...ALARM_AFTER, threshold: 1 }]], 'a lower threshold')
  refused([['aws_cloudwatch_metric_alarm.web_running_tasks_low', ['update'], ALARM_BEFORE, { ...ALARM_AFTER, alarm_actions: [] }]], 'dropping the email')
  refused([['aws_cloudwatch_metric_alarm.web_running_tasks_low', ['update'], ALARM_BEFORE, { ...ALARM_AFTER, dimensions: { LoadBalancer: ALARM_AFTER.dimensions.LoadBalancer } }]], 'no target group')
  refused([['aws_cloudwatch_metric_alarm.web_running_tasks_low', ['delete'], ALARM_BEFORE, null]], 'deleting the running alarm')
  refused([['aws_cloudwatch_metric_alarm.web_ephemeral_storage_high', ['update'], {}, {}]], 'keeping the ephemeral alarm')
  refused([...GOOD, ['aws_ecs_service.web', ['update'], {}, {}]], 'touching the web service')
})

// The ECR check, as the runner runs it: an image a service uses must be among the newest 10 of its own count.
function runEcrCheck(images, inUse) {
  const block = script.slice(script.indexOf("<<'PY'\n", script.indexOf('ecr_check() {')) + 7, script.indexOf('\nPY\n', script.indexOf('ecr_check() {')))
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cost-trim-ecr-'))
  try {
    writeFileSync(path.join(dir, 'check.py'), block)
    writeFileSync(path.join(dir, 'images.json'), JSON.stringify({ imageDetails: images }))
    writeFileSync(path.join(dir, 'in-use.txt'), inUse.join('\n') + '\n')
    return spawnSync('python3', ['-I', path.join(dir, 'check.py'), path.join(dir, 'images.json'), path.join(dir, 'in-use.txt'), 'sea-n-shore', '10'], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const REGISTRY = '310356785722.dkr.ecr.ap-south-1.amazonaws.com'
const image = (tag, day) => ({ imageDigest: `sha256:${tag}`, imageTags: [tag], imagePushedAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00+00:00` })

test('the ECR check keeps every image a service runs, counting worker and web images apart', () => {
  // 25 web images and one old worker image: with one shared count of 10 the worker image would be expired.
  const images = [...Array.from({ length: 25 }, (_, i) => image(`web${i}`, i + 2)), image('social-old', 1)]
  const ok = runEcrCheck(images, [`${REGISTRY}/sea-n-shore:web24`, `${REGISTRY}/sea-n-shore:social-old`, `${REGISTRY}/sea-n-shore-base/node:x`])
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /^COST_TRIM_ECR_IMAGES group=application count=25 kept=10 expired_by_policy=15$/m)
  assert.match(ok.stdout, /^COST_TRIM_ECR_IMAGES group=social count=1 kept=1 expired_by_policy=0$/m)
  assert.match(ok.stdout, /^COST_TRIM_ECR_IN_USE group=social rank=1$/m)
  assert.match(ok.stdout, /^COST_TRIM_ECR_IN_USE_KEPT=true$/m)
  assert.doesNotMatch(ok.stdout, /web24|social-old|dkr\.ecr/, 'counts and ranks only, never tags or URIs')
  // A service still on the 11th newest web image: refused.
  const old = runEcrCheck(images, [`${REGISTRY}/sea-n-shore:web14`])
  assert.notEqual(old.status, 0)
  assert.match(old.stdout, /group=application rank=11/)
  // An in-use image that is not in the repository at all: refused.
  assert.notEqual(runEcrCheck(images, [`${REGISTRY}/sea-n-shore:gone`]).status, 0)
})

test('the API Gateway welcome log group gets 14 days, and only that group', () => {
  assert.match(script, /WELCOME_LOG_GROUP="\/aws\/apigateway\/welcome"/)
  assert.equal((script.match(/put-retention-policy/g) ?? []).length, 1)
  assert.match(script, /aws logs put-retention-policy --region "\$AWS_REGION" --log-group-name "\$WELCOME_LOG_GROUP" --retention-in-days 14/)
  assert.match(script, /select\(\.logGroupName == \$name\)\] \| length' "\$WORK_DIR\/log-groups\.json"\)" == "1" \]\]/)
  // The CLI changes come before Terraform, so a refused call leaves everything else as it was.
  assert.ok(script.indexOf('aws ecr put-lifecycle-policy') < script.indexOf('terraform -chdir="$APP_DIR" apply'))
  assert.ok(script.indexOf('put-retention-policy') < script.indexOf('terraform -chdir="$APP_DIR" apply'))
  assert.ok(script.indexOf('if [[ "$ACTION" == "plan" ]]') < script.indexOf('aws ecr put-lifecycle-policy'), 'a plan changes nothing')
  assert.match(script, /echo "COST_TRIM_APPLY_VERIFIED=true"\n$/)
})
