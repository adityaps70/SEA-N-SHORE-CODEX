import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function text(path) {
  return readFileSync(path, 'utf8')
}

test('GitHub remote execution stays scoped to the bootstrap instance and repository verifier', () => {
  const terraform = text('infra/aws/bootstrap/main.tf')
  const workflow = text('.github/workflows/aws-remote-verify.yml')
  const verifier = text('scripts/aws/remote-verify.sh')

  for (const action of [
    'ec2:DescribeInstances',
    'ssm:SendCommand',
    'ssm:GetCommandInvocation',
    'ssm:ListCommandInvocations',
  ]) {
    assert.match(terraform, new RegExp(action.replace(':', '\\:')))
  }

  assert.match(terraform, /AWS-RunShellScript/)
  assert.match(terraform, /ssm:resourceTag\/Name/)
  assert.match(terraform, /sea-n-shore-bootstrap/)

  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Name=tag:Name,Values=sea-n-shore-bootstrap/)
  assert.match(workflow, /AWS-RunShellScript/)
  assert.match(workflow, /bash scripts\/aws\/remote-verify\.sh/)
  assert.match(workflow, /git reset --hard/)

  assert.doesNotMatch(workflow, /inputs:\s*[\s\S]*?command\s*:/)
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\.command\s*\}\}/)

  assert.match(verifier, /set -euo pipefail/)
  assert.match(verifier, /npm run lint/)
  assert.match(verifier, /npm run typecheck/)
  assert.match(verifier, /vitest run/)
})
