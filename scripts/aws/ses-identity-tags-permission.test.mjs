import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = new URL('../../', import.meta.url)
const runner = fs.readFileSync(new URL('scripts/aws/ses-identity-tags.sh', repoRoot), 'utf8')

test('SES identity tag reconciliation proves exact TagResource permission before mutation', () => {
  assert.match(runner, /BOOTSTRAP_ROLE_ARN="arn:aws:iam::310356785722:role\/SeaNShore-Bootstrap-Role"/)
  assert.match(runner, /aws iam simulate-principal-policy/)
  assert.match(runner, /--policy-source-arn "\$BOOTSTRAP_ROLE_ARN"/)
  assert.match(runner, /--action-names ses:TagResource/)
  assert.match(runner, /--resource-arns "\$SES_IDENTITY_ARN"/)
  assert.match(runner, /SES_IDENTITY_TAGS_PERMISSION_DECISION=/)
  assert.match(runner, /EvalDecision/)
  assert.match(runner, /allowed/)
  assert.doesNotMatch(runner, /--action-names ses:\*/i)
  assert.doesNotMatch(runner, /--resource-arns ['"]?\*['"]?/)
})
