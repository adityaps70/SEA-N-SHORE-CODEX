import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bootstrap = readFileSync('infra/aws/bootstrap/main.tf', 'utf8')
const reconcile = readFileSync('scripts/aws/github-deploy-iam.sh', 'utf8')

// Rewritten in Round 15: the bootstrap stack builds the role ARNs from
// local.name_prefix ("${var.project_name}-${var.environment}", defaults sea-n-shore / staging)
// instead of spelling "sea-n-shore-staging-..." out, so the literal names never matched it.
test('GitHub deploy role can pass only the exact ECS roles needed for web and event workers', () => {
  assert.match(bootstrap, /name_prefix\s*=\s*"\$\{var\.project_name\}-\$\{var\.environment\}"/)
  assert.match(bootstrap, /variable "project_name" \{[^}]*default\s*=\s*"sea-n-shore"/)
  assert.match(bootstrap, /variable "environment" \{[^}]*default\s*=\s*"staging"/)

  const passRole = bootstrap.match(/Sid\s*=\s*"PassEcsRoles"[\s\S]*?Resource\s*=\s*\[([\s\S]*?)\]/)
  assert.ok(passRole, 'PassEcsRoles statement with a Resource list')
  const resources = [...passRole[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  const suffixes = ['ecs-execution', 'ecs-task', 'outbox-worker', 'notification-worker']
  assert.deepEqual(
    resources,
    suffixes.map((suffix) => `arn:aws:iam::\${data.aws_caller_identity.current.account_id}:role/\${local.name_prefix}-${suffix}`),
  )

  for (const suffix of suffixes) {
    assert.match(reconcile, new RegExp(`sea-n-shore-staging-${suffix}`))
  }

  assert.match(bootstrap, /Sid\s*=\s*"PassEcsRoles"/)
  assert.match(reconcile, /PassEcsRoles/)
  assert.match(reconcile, /verify_pass_role_statement/)
  // Each iam:PassRole statement's own Resource must be the exact role list, never "*". (The old
  // 300-character window also reached the next statement, ReviewCognitoSignupCapacity, whose
  // read-only Resource "*" is unrelated to PassRole.)
  const passRoleStatements = [...reconcile.matchAll(/Action:\s*\[[^\]]*"iam:PassRole"[^\]]*\],\s*Resource:\s*([^\n]+)/g)]
  assert.equal(passRoleStatements.length, 1)
  assert.equal(passRoleStatements[0][1].trim(), '$passRoles')
  assert.match(reconcile, /PASS_ROLE_RESOURCES="\$\(jq -nc[\s\S]*?'\[\$execution,\$task,\$outbox,\$notifications\]'\)"/)
  assert.match(reconcile, /--argjson passRoles "\$PASS_ROLE_RESOURCES"/)
  assert.doesNotMatch(reconcile, /"iam:PassRole"[^}]*Resource["']?\s*:\s*["']\*["']/)
  assert.doesNotMatch(bootstrap, /"iam:PassRole"\][^}]*Resource\s*=\s*"\*"/)
})
