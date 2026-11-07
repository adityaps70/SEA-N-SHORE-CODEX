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
  assert.match(workflow, /\n  CASHFREE_ENVIRONMENT: sandbox\n/)
})

test('the keys must be accepted by Cashfree sandbox, checked read-only, before anything runs', () => {
  const step = workflow.slice(workflow.indexOf('- name: Check the keys against Cashfree sandbox (read-only)'), workflow.indexOf('- name: Start the Cognito stand-in'))
  assert.ok(step.length > 100)
  // After production is made unreachable, and before the Cognito stand-in, the build and the checkouts.
  assert.ok(workflow.indexOf('- name: Make Cashfree production unreachable') < workflow.indexOf('- name: Check the keys against Cashfree sandbox'))
  // One GET of an order id that cannot exist: it creates nothing.
  assert.equal((step.match(/curl /g) ?? []).length, 1)
  assert.doesNotMatch(step, /-X |--request|-d |--data/)
  assert.match(step, /"https:\/\/sandbox\.cashfree\.com\/pg\/orders\/sns_credential_check_\$\{GITHUB_RUN_ID\}_does_not_exist"/)
  // Only 404 (unknown order, key accepted) continues; 401/403 and anything else stop.
  assert.match(step, /404\) echo "CASHFREE_SANDBOX_KEYS_ACCEPTED=true" ;;/)
  assert.match(step, /401\|403\) echo "Cashfree sandbox refused these keys \(HTTP \$STATUS\)[^"]*" >&2; exit 1 ;;/)
  assert.match(step, /\*\) echo "Unexpected answer from Cashfree sandbox \(HTTP \$STATUS\); stopping\." >&2; exit 1 ;;/)
  // The keys go in a private header file, never on the command line or in the log, and the body is discarded.
  assert.match(step, /umask 077/)
  assert.match(step, /-H @"\$HEADERS"/)
  assert.match(step, /-o \/dev\/null/)
  assert.doesNotMatch(step, /echo[^\n]*\$CASHFREE_TEST_CLIENT_(ID|SECRET)/)
  assert.doesNotMatch(workflow, /TEST\*|_test_\*/)
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
  assert.match(spec, /SANDBOX_CHECKOUT_RESULT course=paid event_ticket=paid organization_pro=\$\{runPro \? 'active' : 'skipped'\} csp_violations=0/)
  // The Pro step runs only when asked for (Cashfree sandbox Subscriptions must be enabled first).
  assert.match(workflow, /pro_plan:\n        description: [^\n]+\n        type: boolean\n        default: false\n/)
  assert.match(workflow, /RUN_PRO_PLAN: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.pro_plan \}\}/)
  assert.match(spec, /const runPro = process\.env\.RUN_PRO_PLAN === 'true'/)
})

test("Cashfree's submit button is matched by its whole name, never a wallet tile or a disabled button", () => {
  const literal = spec.match(/const SUBMIT_BUTTON = \/(.+)\/i\n/)
  assert.ok(literal, 'SUBMIT_BUTTON is a case-insensitive regex literal')
  const submit = new RegExp(literal[1], 'i')
  for (const name of ['Proceed to Pay', 'Pay ₹1,003.00', 'Pay now', 'Verify and Pay']) assert.ok(submit.test(name), name)
  // The sandbox card screen of 7 Nov: the Samsung Pay tile sits above the card form and opened Samsung's QR screen.
  for (const name of ['Samsung Pay', 'Google Pay', 'Pay with cards saved on', 'Proceed to Pay button is disabled', 'Use', 'Know More'])
    assert.ok(!submit.test(name), name)
  assert.doesNotMatch(spec, /name: \/[a-z|]*pay\|[a-z|]*\/i/, 'no loose pay|… button pattern is left')
  assert.match(spec, /if \(Date\.now\(\) - \(lastSubmit\.get\(key\) \?\? 0\) < 15_000\) return/)
})

test('our own checkout controls are the visible ones, never a hidden streaming copy or the phone bar', () => {
  // Run of 7 Nov: while the course page streamed, a hidden copy of the purchase panel matched 'Billing state' too.
  assert.match(spec, /getByLabel\('Billing state'\)\.filter\(\{ visible: true \}\)\.selectOption\('27'\)/)
  assert.match(spec, /getByRole\('button', \{ name: \/\^Buy course\/ \}\)\.filter\(\{ visible: true \}\)\.click\(\)/)
  assert.match(spec, /getByRole\('button', \{ name: \/\^Pay \.\* and register\$\/ \}\)\.filter\(\{ visible: true \}\)\.click\(\)/)
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
