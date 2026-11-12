// Round DB (owner-approved 12 Nov): Aurora Serverless v2 maximum 2 -> 4 ACU, with an email once this month's capacity
// above 2 ACU passes about ₹700. The runner changes exactly that and nothing else; the check counts correctly.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const script = read('./aurora-capacity-infra.sh')
const workflow = read('../../.github/workflows/aws-aurora-capacity-infra.yml')
const checker = new URL('./check-aurora-capacity-plan.py', import.meta.url).pathname
const variables = read('../../infra/aws/app/aws-native-variables.tf')
const capacity = read('../../infra/aws/app/aurora-capacity.tf')
const database = read('../../infra/aws/app/database.tf')
const hardening = read('../../infra/aws/app/security-hardening.tf')

// The Lambda runtime provides the AWS SDK clients; they are not repository dependencies.
const sdk = 'data:text/javascript,' + encodeURIComponent(`
export class CloudWatchClient {} export class SNSClient {}
export class GetMetricDataCommand { constructor(input) { this.input = input } }
export class PublishCommand { constructor(input) { this.input = input } }`)
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === '@aws-sdk/client-cloudwatch' || specifier === '@aws-sdk/client-sns') return { url: ${JSON.stringify(sdk)}, shortCircuit: true }
  return next(specifier, context)
}`))
const check = await import('../../infra/aws/app/lambda/aurora-extra-acu-check.mjs')

test('the guard reads plan or apply-once and the runner is pinned to its commit', () => {
  assert.ok(['plan', 'apply-once'].includes(guardAction(read('./aurora-capacity-infra-action.txt'))))
  assert.match(script, /\[\[ "\$\{AURORA_CAPACITY_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$ \]\]/)
  assert.match(script, /\[\[ "\$\(git rev-parse HEAD\)" == "\$AURORA_CAPACITY_EXPECTED_SHA" \]\]/)
  assert.match(script, /case "\$ACTION" in plan\|apply-once\) ;;/)
  assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
  for (const file of ['infra/aws/app/aurora-capacity.tf', 'infra/aws/app/lambda/aurora-extra-acu-check.mjs', 'infra/aws/app/database.tf',
    'infra/aws/app/security-hardening.tf', 'infra/aws/app/aws-native-variables.tf', 'scripts/aws/check-aurora-capacity-plan.py']) {
    assert.ok(script.includes(`  ${file} \\\n`), `the runner refuses a changed ${file}`)
    assert.ok(workflow.includes(`      - ${file}\n`), `the workflow watches ${file}`)
  }
  assert.doesNotMatch(script, /-auto-approve|terraform[^\n]* destroy|reboot-db-instance|modify-db-cluster/)
  assert.match(workflow, /name: AWS Aurora Capacity Infrastructure/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /export AURORA_CAPACITY_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/aurora-capacity-infra\.sh/)
  assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /node --test scripts\/aws\/aurora-capacity-infra\.test\.mjs/)
  assert.match(workflow, /grep -q 'AURORA_CAPACITY_APPLY_VERIFIED=true'/)
})

test('Terraform: 0.5 to 4 ACU, the at-max alarm follows, the check emails the alerts topic at 39 ACU-hours', () => {
  assert.match(variables, /variable "aurora_max_acu" \{[\s\S]*?default\s+= 4\n/)
  assert.match(variables, /variable "aurora_min_acu" \{[\s\S]*?default\s+= 0\.5\n/)
  assert.match(variables, /variable "aurora_extra_acu_allowance_hours" \{[\s\S]*?default\s+= 39\n/)
  assert.match(database, /max_capacity\s+= var\.aurora_max_acu/)
  assert.match(hardening, /resource "aws_cloudwatch_metric_alarm" "aurora_capacity_at_max" \{[\s\S]*?threshold\s+= var\.aurora_max_acu/)
  // 39 ACU-hours at ₹17.8 is about ₹700 (our bill: $0.1715 an ACU-hour, ₹88 to the dollar, 18% GST).
  assert.ok(Math.abs(0.1715 * 88 * 1.18 - 17.8) < 0.05 && Math.abs(39 * 17.8 - 700) < 10)
  assert.match(capacity, /BASE_ACU\s+= "2"/)
  assert.match(capacity, /RUPEES_PER_ACU_HOUR = "17\.8"/)
  assert.match(capacity, /ALERT_TOPIC_ARN\s+= aws_sns_topic\.alerts\.arn/)
  assert.match(capacity, /schedule_expression = "cron\(15 \* \* \* \? \*\)"/)
  assert.match(capacity, /reserved_concurrent_executions = 1/)
  assert.deepEqual([...script.matchAll(/^  (aws_[a-z_]+\.[a-z_]+)$/gm)].map((m) => m[1]), [
    'aws_rds_cluster.aurora', 'aws_cloudwatch_metric_alarm.aurora_capacity_at_max',
    'aws_iam_role.aurora_extra_acu_check', 'aws_iam_role_policy.aurora_extra_acu_check', 'aws_cloudwatch_log_group.aurora_extra_acu_check',
    'aws_lambda_function.aurora_extra_acu_check', 'aws_cloudwatch_event_rule.aurora_extra_acu_check',
    'aws_cloudwatch_event_target.aurora_extra_acu_check', 'aws_lambda_permission.aurora_extra_acu_check',
    'aws_cloudwatch_metric_alarm.aurora_extra_acu_check_errors',
  ])
  // After apply the live cluster must read 0.5 to 4 with nothing pending, and the check must run once without error.
  assert.match(script, /MaxCapacity == 4 and \.DeletionProtection == true/)
  assert.match(script, /has\("ServerlessV2ScalingConfiguration"\) \| not/)
  assert.match(script, /aws lambda invoke [^\n]*--function-name "\$CHECK_FUNCTION"/)
})

// ---------------------------------------------------------------- the plan checker
const NAME = 'sea-n-shore-staging-aurora-extra-acu-check'
const TOPIC = 'arn:aws:sns:ap-south-1:310356785722:sea-n-shore-staging-alerts'
const scaling = (min, max) => [{ min_capacity: min, max_capacity: max, seconds_until_auto_pause: 900 }]
const CLUSTER_BEFORE = { cluster_identifier: 'sea-n-shore-staging-aurora', deletion_protection: true, backup_retention_period: 14, serverlessv2_scaling_configuration: scaling(0.5, 2) }
const ALARM_BEFORE = { alarm_name: 'sea-n-shore-staging-aurora-capacity-at-max', threshold: 2, period: 300, evaluation_periods: 3, alarm_actions: [TOPIC] }
const POLICY = JSON.stringify({ Version: '2012-10-17', Statement: [
  { Sid: 'ReadCapacityMetric', Effect: 'Allow', Action: ['cloudwatch:GetMetricData'], Resource: '*' },
  { Sid: 'EmailTheAlertsTopic', Effect: 'Allow', Action: ['sns:Publish'], Resource: TOPIC },
  { Sid: 'WriteOwnLogs', Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: `arn:aws:logs:ap-south-1:310356785722:log-group:/aws/lambda/${NAME}:*` },
] })
const CREATES = {
  'aws_iam_role.aurora_extra_acu_check': { name: NAME, assume_role_policy: JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) },
  'aws_iam_role_policy.aurora_extra_acu_check': { name: NAME, policy: POLICY },
  'aws_cloudwatch_log_group.aurora_extra_acu_check': { name: `/aws/lambda/${NAME}`, retention_in_days: 14 },
  'aws_lambda_function.aurora_extra_acu_check': {
    function_name: NAME, runtime: 'nodejs22.x', handler: 'aurora-extra-acu-check.handler', reserved_concurrent_executions: 1, timeout: 60, memory_size: 128,
    environment: [{ variables: { AURORA_CLUSTER_ID: 'sea-n-shore-staging-aurora', ALERT_TOPIC_ARN: TOPIC, BASE_ACU: '2', ALLOWANCE_ACU_HOURS: '39', RUPEES_PER_ACU_HOUR: '17.8' } }],
  },
  'aws_cloudwatch_event_rule.aurora_extra_acu_check': { name: NAME, schedule_expression: 'cron(15 * * * ? *)', event_pattern: null },
  'aws_cloudwatch_event_target.aurora_extra_acu_check': { rule: NAME, input: null, input_transformer: [] },
  'aws_lambda_permission.aurora_extra_acu_check': { function_name: NAME, principal: 'events.amazonaws.com', action: 'lambda:InvokeFunction' },
  'aws_cloudwatch_metric_alarm.aurora_extra_acu_check_errors': {
    alarm_name: `${NAME}-errors`, namespace: 'AWS/Lambda', metric_name: 'Errors', statistic: 'Sum', threshold: 0,
    comparison_operator: 'GreaterThanThreshold', dimensions: { FunctionName: NAME }, alarm_actions: [TOPIC],
  },
}

function fullPlan(overrides = {}) {
  const changes = [
    ['aws_rds_cluster.aurora', ['update'], CLUSTER_BEFORE, { ...CLUSTER_BEFORE, serverlessv2_scaling_configuration: scaling(0.5, 4) }],
    ['aws_cloudwatch_metric_alarm.aurora_capacity_at_max', ['update'], ALARM_BEFORE, { ...ALARM_BEFORE, threshold: 4 }],
    ...Object.entries(CREATES).map(([address, after]) => [address, ['create'], null, after]),
  ].map(([address, actions, before, after]) => {
    const o = overrides[address]
    return o === null ? null : [address, o?.actions ?? actions, before, o?.after ? { ...after, ...o.after } : after]
  }).filter(Boolean)
  return { resource_changes: changes.map(([address, actions, before, after]) => ({ address, mode: 'managed', change: { actions, before, after, after_unknown: {} } })) }
}

function runChecker(planJson) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-capacity-plan-'))
  try {
    const file = path.join(dir, 'plan.json')
    writeFileSync(file, JSON.stringify(planJson))
    return spawnSync('python3', ['-I', checker, file], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the plan checker accepts exactly the approved change, or nothing', () => {
  const ok = runChecker(fullPlan())
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /AURORA_CAPACITY_PLAN_CHANGES=10/)
  assert.match(ok.stdout, /AURORA_CAPACITY_CHANGE=aws_rds_cluster\.aurora\|update/)
  const none = runChecker({ resource_changes: [{ address: 'aws_rds_cluster.aurora', mode: 'managed', change: { actions: ['no-op'], before: {}, after: {} } }] })
  assert.equal(none.status, 0, none.stderr)
  assert.match(none.stdout, /AURORA_CAPACITY_PLAN_CHANGES=0/)
})

test('the plan checker refuses anything else', () => {
  const refused = [
    [{ 'aws_rds_cluster.aurora': { after: { serverlessv2_scaling_configuration: scaling(0.5, 8) } } }, /0\.5 to 4 ACU/],
    [{ 'aws_rds_cluster.aurora': { after: { serverlessv2_scaling_configuration: scaling(0, 4) } } }, /0\.5 to 4 ACU/],
    [{ 'aws_rds_cluster.aurora': { after: { serverlessv2_scaling_configuration: [{ min_capacity: 0.5, max_capacity: 4, seconds_until_auto_pause: 300 }] } } }, /auto-pause/],
    [{ 'aws_rds_cluster.aurora': { after: { backup_retention_period: 7 } } }, /only change its capacity range/],
    [{ 'aws_rds_cluster.aurora': { after: { deletion_protection: false } } }, /deletion protection|capacity range/],
    [{ 'aws_rds_cluster.aurora': { actions: ['delete', 'create'] } }, /only be updated in place/],
    [{ 'aws_cloudwatch_metric_alarm.aurora_capacity_at_max': { after: { threshold: 8 } } }, /threshold to 4/],
    [{ 'aws_cloudwatch_metric_alarm.aurora_capacity_at_max': { after: { threshold: 4, alarm_actions: [] } } }, /threshold to 4/],
    [{ 'aws_iam_role_policy.aurora_extra_acu_check': { after: { policy: POLICY.replace('"sns:Publish"', '"sns:Publish","rds:ModifyDBCluster"') } } }, /may only read metrics/],
    [{ 'aws_iam_role_policy.aurora_extra_acu_check': { after: { policy: POLICY.replace(TOPIC, '*') } } }, /alerts topic only/],
    [{ 'aws_iam_role.aurora_extra_acu_check': { after: { assume_role_policy: JSON.stringify({ Statement: [{ Principal: { AWS: '*' } }] }) } } }, /assumable by Lambda only/],
    [{ 'aws_lambda_function.aurora_extra_acu_check': { after: { environment: [{ variables: { ...CREATES['aws_lambda_function.aurora_extra_acu_check'].environment[0].variables, ALLOWANCE_ACU_HOURS: '390' } }] } } }, /ALLOWANCE_ACU_HOURS=39/],
    [{ 'aws_lambda_function.aurora_extra_acu_check': { after: { reserved_concurrent_executions: 10 } } }, /reserved_concurrent_executions=1/],
    [{ 'aws_cloudwatch_event_rule.aurora_extra_acu_check': { after: { schedule_expression: 'rate(1 minute)' } } }, /hourly schedule/],
    [{ 'aws_lambda_permission.aurora_extra_acu_check': { after: { principal: 's3.amazonaws.com' } } }, /only let the schedule/],
    [{ 'aws_cloudwatch_metric_alarm.aurora_extra_acu_check_errors': null }, /created whole/],
    [{ 'aws_cloudwatch_log_group.aurora_extra_acu_check': { actions: ['delete'] } }, /only be created/],
  ]
  for (const [overrides, pattern] of refused) {
    const result = runChecker(fullPlan(overrides))
    assert.notEqual(result.status, 0, JSON.stringify(overrides))
    assert.match(result.stderr, pattern, JSON.stringify(overrides))
  }
  const extra = fullPlan()
  extra.resource_changes.push({ address: 'aws_ecs_service.web', mode: 'managed', change: { actions: ['update'], before: {}, after: {}, after_unknown: {} } })
  assert.match(runChecker(extra).stderr, /Unexpected change: aws_ecs_service\.web/)
})

// ---------------------------------------------------------------- the hourly check
const ENV = { AURORA_CLUSTER_ID: 'sea-n-shore-staging-aurora', ALERT_TOPIC_ARN: TOPIC, BASE_ACU: '2', ALLOWANCE_ACU_HOURS: '39', RUPEES_PER_ACU_HOUR: '17.8' }

/** A CloudWatch stand-in: capacity(timeMs) gives the ACU at each point of the asked period. */
function fakeCloudWatch(capacity) {
  const calls = []
  return {
    calls,
    async send(command) {
      const { StartTime, EndTime, MetricDataQueries } = command.input
      const period = MetricDataQueries[0].MetricStat.Period * 1000
      calls.push({ start: StartTime.toISOString(), end: EndTime.toISOString(), period: period / 1000, stat: MetricDataQueries[0].MetricStat.Stat })
      const Timestamps = []
      const Values = []
      for (let t = StartTime.getTime(); t < EndTime.getTime(); t += period) {
        Timestamps.push(new Date(t).toISOString())
        Values.push(capacity(t))
      }
      return { MetricDataResults: [{ Id: 'capacity', Timestamps, Values }] }
    },
  }
}
function fakeSns() {
  const sent = []
  return { sent, async send(command) { sent.push(command.input) } }
}

test('the check counts only capacity above 2 ACU, in ACU-hours', () => {
  assert.equal(check.extraAcuHours([0.5, 2, 1.9], 2, 60), 0)
  assert.equal(check.extraAcuHours([4, 4, 3], 2, 60), (2 + 2 + 1) / 60)
  assert.equal(check.extraAcuHours([3], 2, 300), 5 / 60)
  assert.equal(check.extraAcuHours([Number.NaN, undefined, 4], 2, 3600), 2)
  // Within 14 days: one-minute averages; earlier in the month: five-minute maximums (never under-counted).
  const end = new Date('2026-11-29T05:00:00Z')
  assert.deepEqual(check.monthWindows(end).map(([s, e, p, stat]) => [s.toISOString(), e.toISOString(), p, stat]), [
    ['2026-11-01T00:00:00.000Z', '2026-11-15T05:00:00.000Z', 300, 'Maximum'],
    ['2026-11-15T05:00:00.000Z', '2026-11-29T05:00:00.000Z', 60, 'Average'],
  ])
  assert.deepEqual(check.monthWindows(new Date('2026-11-03T00:00:00Z')).map(([, , p]) => p), [60])
  assert.equal(check.lastFullHour(new Date('2026-11-12T07:15:42Z')).toISOString(), '2026-11-12T07:00:00.000Z')
})

test('the check emails once, in the hour the month passes 39 ACU-hours above 2 ACU', async () => {
  // 4 ACU (2 above the base) from 10:00 UTC on 12 Nov: 39 ACU-hours are reached at 05:30 on 13 Nov.
  const from = Date.parse('2026-11-12T10:00:00Z')
  const capacity = (t) => (t >= from ? 4 : 0.5)
  const at = async (iso) => {
    const cloudwatch = fakeCloudWatch(capacity)
    const sns = fakeSns()
    const summary = await check.createHandler({ cloudwatch, sns, env: ENV, now: () => new Date(iso) })()
    return { summary, sns, cloudwatch }
  }
  const before = await at('2026-11-13T05:15:00Z')
  assert.equal(before.summary.extraAcuHours, 38)
  assert.equal(before.summary.crossed, false)
  assert.equal(before.sns.sent.length, 0)
  const crossing = await at('2026-11-13T06:15:00Z')
  assert.equal(crossing.summary.extraAcuHours, 40)
  assert.equal(crossing.summary.estimatedRupees, 712)
  assert.equal(crossing.summary.crossed, true)
  assert.equal(crossing.sns.sent.length, 1)
  assert.equal(crossing.sns.sent[0].TopicArn, TOPIC)
  assert.match(crossing.sns.sent[0].Subject, /above 2 ACU passed about Rs 694/)
  assert.match(crossing.sns.sent[0].Message, /40 ACU-hours above 2 ACU so far in 2026-11,\nabout Rs 712/)
  // One read of the metric per run (one window within the first 14 days), only the capacity metric.
  assert.equal(crossing.cloudwatch.calls.length, 1)
  const after = await at('2026-11-13T07:15:00Z')
  assert.equal(after.summary.crossed, false)
  assert.equal(after.sns.sent.length, 0)
  // A quiet month never emails; a new month starts from zero (its first full hour at 4 ACU is 2 ACU-hours).
  const quiet = await check.createHandler({ cloudwatch: fakeCloudWatch(() => 1.5), sns: fakeSns(), env: ENV, now: () => new Date('2026-11-20T00:15:00Z') })()
  assert.deepEqual([quiet.extraAcuHours, quiet.crossed], [0, false])
  const december = await at('2026-12-01T01:15:00Z')
  assert.equal(december.summary.month, '2026-12')
  assert.equal(december.summary.extraAcuHours, 2)
  assert.equal(december.summary.crossed, false)
})

test('the check refuses to run misconfigured', () => {
  for (const key of Object.keys(ENV)) {
    assert.throws(() => check.createHandler({ cloudwatch: {}, sns: {}, env: { ...ENV, [key]: '' } }), /misconfigured/)
  }
})
