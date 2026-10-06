import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bootstrap = readFileSync(new URL('../../infra/aws/bootstrap/main.tf', import.meta.url), 'utf8')
const reconcile = readFileSync(new URL('./github-deploy-iam.sh', import.meta.url), 'utf8')

// Private repo: the runner hands the bootstrap host an exact-SHA git bundle through S3 instead of the host cloning
// from GitHub. The deploy role may write and delete only under the migration bucket's ci-checkouts/ prefix.
test('GitHub deploy role can write and delete checkout bundles only under migration/ci-checkouts/', () => {
  const tf = /Sid\s+= "CiCheckoutBundles"\n\s+Effect\s+= "Allow"\n\s+Action\s+= \[([^\]]+)\]\n\s+Resource = "([^"]+)"/.exec(bootstrap)
  assert.ok(tf, 'bootstrap main.tf has the CiCheckoutBundles statement')
  assert.deepEqual(tf[1].split(',').map((a) => a.trim().replace(/"/g, '')).sort(), ['s3:DeleteObject', 's3:DeleteObjectVersion', 's3:PutObject'])
  assert.equal(tf[2], 'arn:aws:s3:::${local.name_prefix}-${data.aws_caller_identity.current.account_id}-migration/ci-checkouts/*')

  assert.match(reconcile, /^CI_CHECKOUT_ARN="arn:aws:s3:::sea-n-shore-staging-\$\{EXPECTED_ACCOUNT\}-migration\/ci-checkouts\/\*"$/m)
  assert.match(reconcile, /Sid: "CiCheckoutBundles",\n\s+Effect: "Allow",\n\s+Action: \["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"\],\n\s+Resource: \$ciCheckouts\n/)
  // Managed like the other reconciled statements: replaced, verified before and after, excluded from the drift check.
  assert.equal((reconcile.match(/\.Sid != "CiCheckoutBundles"/g) || []).length, 3)
  assert.match(reconcile, /verify_ci_checkout_statement "\$CURRENT"\n/)
  assert.match(reconcile, /verify_ci_checkout_statement "\$VERIFIED" \|\| \{/)
  // No read, list or bucket-wide grant to the runner.
  for (const source of [bootstrap, reconcile]) {
    assert.doesNotMatch(source, /-migration"|-migration\/\*"|migration\/ci-checkouts\/\*"[^\n]*GetObject/)
  }
})
