import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const instanceId = process.env.INSTANCE_ID
const courseSlug = process.env.E2E_COURSE_SLUG
const courseTitle = process.env.E2E_COURSE_TITLE

assert.match(instanceId ?? '', /^i-[0-9a-f]+$/)
assert.match(courseSlug ?? '', /^sea-n-shore-learning-review-e2e-[0-9]+$/)
assert.match(courseTitle ?? '', /^E2E Learning Review Course [0-9]+$/)

function quote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function aws(args, { allowFailure = false } = {}) {
  const result = spawnSync('aws', args, { encoding: 'utf8', env: process.env })
  if (!allowFailure && result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `AWS CLI failed: ${args.join(' ')}\n`)
    process.exit(result.status || 1)
  }
  return result
}

const remote = `set -euo pipefail
export AWS_PAGER=""
AWS_REGION=${quote(process.env.AWS_REGION || 'ap-south-1')}
COURSE_SLUG=${quote(courseSlug)}
COURSE_TITLE=${quote(courseTitle)}
CLUSTER_JSON=$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier sea-n-shore-staging-aurora --output json)
CLUSTER_ARN=$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")
SECRET_ARN=$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")
test "$CLUSTER_ARN" = 'arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora'
test -n "$SECRET_ARN"
SQL="UPDATE public.learning_courses SET is_discoverable=false, updated_at=now() WHERE slug='${courseSlug}' AND title='${courseTitle}' AND status='published'"
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --sql "$SQL" >/dev/null
VERIFY_SQL="SELECT count(*)::text FROM public.learning_courses WHERE slug='${courseSlug}' AND title='${courseTitle}' AND status='published' AND is_discoverable=false"
COUNT=$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --sql "$VERIFY_SQL" --output json | jq -r '.records[0][0].stringValue // empty')
test "$COUNT" = 1
echo LEARNING_ASSIGNMENT_REVIEW_E2E_UNLIST_VERIFIED=true
`

const command = `runuser -u ssm-user -- bash -lc ${quote(remote)}`
const parameters = JSON.stringify({ executionTimeout: ['600'], commands: [command] })
const sent = aws([
  'ssm', 'send-command',
  '--region', process.env.AWS_REGION || 'ap-south-1',
  '--instance-ids', instanceId,
  '--document-name', 'AWS-RunShellScript',
  '--comment', `Sea N Shore learning assignment review unlist fixture ${process.env.GITHUB_SHA || ''}`,
  '--timeout-seconds', '600',
  '--parameters', parameters,
  '--query', 'Command.CommandId',
  '--output', 'text',
])
const commandId = sent.stdout.trim()
assert.match(commandId, /^[0-9a-f-]{36}$/)

let invocation = null
for (let attempt = 0; attempt < 200; attempt += 1) {
  const result = aws([
    'ssm', 'get-command-invocation',
    '--region', process.env.AWS_REGION || 'ap-south-1',
    '--command-id', commandId,
    '--instance-id', instanceId,
    '--output', 'json',
  ], { allowFailure: true })
  if (result.status === 0) {
    const current = JSON.parse(result.stdout)
    if (!['Pending', 'InProgress', 'Delayed'].includes(current.Status)) {
      invocation = current
      break
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))
}

assert.ok(invocation, 'Timed out waiting for fixture unlist SSM command')
if (invocation.StandardOutputContent) process.stdout.write(invocation.StandardOutputContent)
if (invocation.StandardErrorContent) process.stderr.write(invocation.StandardErrorContent)
assert.equal(invocation.Status, 'Success', `Fixture unlist ended with ${invocation.Status}`)
assert.match(invocation.StandardOutputContent ?? '', /^LEARNING_ASSIGNMENT_REVIEW_E2E_UNLIST_VERIFIED=true$/m)
