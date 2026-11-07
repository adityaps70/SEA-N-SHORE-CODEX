// Cashfree sandbox checkout E2E contract: nothing live is touched and only Cashfree TEST keys can be used.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const workflow = read('../../.github/workflows/cashfree-sandbox-e2e.yml')
const spec = read('../e2e/cashfree-sandbox/checkout.spec.ts')
const config = read('../e2e/cashfree-sandbox/playwright.config.ts')
const seed = read('../e2e/cashfree-sandbox/seed.ts')

test('no AWS access at all, and the token can only read the repository', () => {
  assert.match(workflow, /\npermissions:\n  contents: read\n\n/)
  assert.doesNotMatch(workflow, /id-token|configure-aws-credentials|AWS_ROLE_TO_ASSUME|aws (sts|ssm|cognito|s3|secretsmanager)/)
  assert.match(workflow, /AURORA_HOST: 127\.0\.0\.1\n/)
  assert.doesNotMatch(workflow, /AURORA_SECRET_ARN|seanshore\.in/)
})

test('only the TEST secrets, only in the key check and the test step, only on a manual start', () => {
  const uses = workflow.match(/secrets\.[A-Z_]+/g) ?? []
  assert.deepEqual([...new Set(uses)].sort(), ['secrets.CASHFREE_TEST_CLIENT_ID', 'secrets.CASHFREE_TEST_CLIENT_SECRET'])
  assert.equal(uses.length, 4)
  assert.match(workflow, /CASHFREE_CLIENT_ID: \$\{\{ github\.event_name == 'workflow_dispatch' && secrets\.CASHFREE_TEST_CLIENT_ID \|\| '' \}\}/)
  assert.match(workflow, /\[\[ "\$CASHFREE_TEST_CLIENT_ID" == TEST\* \]\] \|\| \{ echo "CASHFREE_TEST_CLIENT_ID is not a Cashfree TEST App ID; refusing\." >&2; exit 1; \}/)
  assert.match(workflow, /\[\[ "\$CASHFREE_TEST_CLIENT_SECRET" == \*_test_\* \]\]/)
  assert.match(workflow, /\n  CASHFREE_ENVIRONMENT: sandbox\n/)
  assert.match(spec, /expect\(process\.env\.CASHFREE_CLIENT_ID \?\? ''\)\.toMatch\(\/\^TEST\/\)/)
})

test('Cashfree production is unreachable from the runner and from the browser', () => {
  assert.match(workflow, /for host in api\.cashfree\.com payments\.cashfree\.com payout-api\.cashfree\.com; do echo "192\.0\.2\.1 \$host"/)
  assert.match(workflow, /! curl -s --max-time 5 -o \/dev\/null https:\/\/api\.cashfree\.com\/ \|\|/)
  assert.match(config, /--host-resolver-rules=MAP api\.cashfree\.com ~NOTFOUND, MAP payments\.cashfree\.com ~NOTFOUND, MAP payout-api\.cashfree\.com ~NOTFOUND/)
  assert.match(config, /retries: 0/)
})

test('the CSP is enforced only in this throwaway build, by the one switch', () => {
  assert.match(workflow, /sed -i 's\/\^export const ENFORCE_CONTENT_SECURITY_POLICY = false\$\/export const ENFORCE_CONTENT_SECURITY_POLICY = true\/'/)
  assert.match(workflow, /\[\[ "\$\(git diff --name-only\)" == "\$FILE" \]\]/)
  assert.match(read('../../src/lib/security/content-security-policy.ts'), /\nexport const ENFORCE_CONTENT_SECURITY_POLICY = false\n/)
  assert.match(spec, /response\?\.headers\(\)\['content-security-policy'\]/)
  assert.match(spec, /expect\(violations, 'no CSP violation on our pages with the policy enforced'\)\.toEqual\(\[\]\)/)
})

test('the seed only ever writes to the runner database', () => {
  assert.match(seed, /if \(!\['127\.0\.0\.1', 'localhost'\]\.includes\(host\)\) throw/)
  assert.match(workflow, /image: postgres:16\n/)
})

test('success is the server confirming with Cashfree, read from the database, for all three items', () => {
  for (const table of ['course_payment_orders', 'event_payment_orders', 'subscription_checkouts']) assert.ok(spec.includes(`public.${table}`), table)
  assert.match(spec, /c\.provider_environment = 'sandbox'/)
  assert.match(spec, /SANDBOX_CHECKOUT_RESULT course=paid event_ticket=paid organization_pro=active csp_violations=0/)
})

test('the Cognito stand-in answers only sign-in, page-load and sign-out calls', async () => {
  Object.assign(process.env, { E2E_MEMBER_EMAIL: 'buyer@example.com', E2E_MEMBER_PASSWORD: 'pw-1', E2E_MEMBER_SUB: 'sub-1', AWS_COGNITO_CLIENT_ID: 'client-1' })
  const { handle } = await import('../e2e/cashfree-sandbox/fake-cognito.mjs')
  const auth = (password, clientId = 'client-1') => handle('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: 'Buyer@example.com', PASSWORD: password } })
  assert.equal(auth('wrong').status, 400)
  assert.equal(auth('pw-1', 'other').status, 400)
  const ok = auth('pw-1')
  assert.equal(ok.status, 200)
  const { AccessToken, RefreshToken } = ok.body.AuthenticationResult
  const claims = JSON.parse(Buffer.from(AccessToken.split('.')[1], 'base64url').toString())
  assert.equal(claims.sub, 'sub-1')
  assert.ok(claims.exp > Date.now() / 1000 && claims.origin_jti)
  const user = handle('GetUser', { AccessToken })
  assert.equal(user.status, 200)
  assert.deepEqual(user.body.UserAttributes.find((a) => a.Name === 'sub'), { Name: 'sub', Value: 'sub-1' })
  assert.equal(handle('GetUser', { AccessToken: 'forged' }).status, 400)
  assert.equal(handle('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: 'client-1', AuthParameters: { REFRESH_TOKEN: RefreshToken } }).status, 200)
  for (const operation of ['SignUp', 'AdminCreateUser', 'ForgotPassword', 'ChangePassword', 'DeleteUser']) assert.equal(handle(operation, {}).status, 400, operation)
  assert.equal(handle('GlobalSignOut', { AccessToken }).status, 200)
  assert.equal(handle('GetUser', { AccessToken }).status, 400)
})
