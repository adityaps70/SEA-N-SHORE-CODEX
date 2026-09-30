import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('stale Terraform state locks are released only through the bounded guarded path', async () => {
  const script = await read('./terraform-state-unlock.sh')
  const action = (await read('./terraform-state-unlock-action.txt')).trim()
  const workflow = await read('../../.github/workflows/aws-terraform-state-unlock.yml')

  assert.ok(action === 'plan' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(action), `Unexpected unlock action: ${action}`)
  assert.match(script, /TERRAFORM_STATE_UNLOCK_EXPECTED_SHA/)
  assert.match(script, /LOCK_KEY="sea-n-shore\/staging\/terraform\.tfstate\.tflock"/)
  assert.match(script, /MIN_LOCK_AGE_SECONDS=900/)
  assert.match(script, /\[\[ "\$ACTION" == "\$LOCK_ID" \]\]/)
  assert.match(script, /LOCK_WHO" == ssm-user@\*/)
  assert.match(script, /pgrep -u "\$\(id -u\)" -x terraform/)
  assert.match(script, /force-unlock -force "\$LOCK_ID"/)
  assert.match(script, /TERRAFORM_STATE_UNCHANGED=true/)
  assert.match(script, /TERRAFORM_STATE_UNLOCK_PLAN_ONLY_NO_RELEASE/)
  assert.match(script, /TERRAFORM_STATE_UNLOCK_VERIFIED=true/)
  assert.doesNotMatch(script, /terraform -chdir="\$APP_DIR" (plan|apply|import|state rm)/)
  assert.doesNotMatch(script, /delete-object/)

  assert.match(workflow, /name: AWS Terraform State Unlock/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard state unlock against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /bash scripts\/aws\/terraform-state-unlock\.sh/)
})
