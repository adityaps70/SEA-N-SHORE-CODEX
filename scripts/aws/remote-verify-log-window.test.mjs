import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/aws-remote-verify.yml', 'utf8')
const stagingDeployWorkflow = readFileSync('.github/workflows/aws-staging-deploy.yml', 'utf8')

test('CloudWatch runtime review starts from the live PRIMARY deployment instead of a fixed historical window', () => {
  assert.match(workflow, /PRIMARY_DEPLOYMENT_CREATED_AT/)
  assert.match(workflow, /select\(\.status == "PRIMARY"\)/)
  assert.match(workflow, /date -d "\$PRIMARY_DEPLOYMENT_CREATED_AT" \+%s/)
  assert.match(workflow, /START_MS=.*PRIMARY_DEPLOYMENT_START_SECONDS/)
  assert.doesNotMatch(workflow, /date \+%s\) - 7200/)
})

test('CloudWatch runtime review ignores only malformed client Server Reference IDs while retaining strong runtime failure detection', () => {
  assert.match(workflow, /MALFORMED_SERVER_REFERENCE_PATTERN/)
  assert.match(workflow, /The Server Reference ID did not match the expected format/)
  assert.match(workflow, /IGNORED_MALFORMED_SERVER_REFERENCE_REQUESTS/)
  assert.match(workflow, /grep -Ev "\$MALFORMED_SERVER_REFERENCE_PATTERN"/)
  assert.match(workflow, /ECONNREFUSED/)
  assert.match(workflow, /ETIMEDOUT/)
  assert.match(workflow, /password authentication failed/)
  assert.match(workflow, /HTTP\[\[:space:\]\]\+5/)
  assert.match(workflow, /Repeating runtime error signatures detected/)
})

test('CloudWatch runtime review reports and excludes only explicit old-or-new deployment Server Action version skew', () => {
  assert.match(workflow, /STALE_SERVER_ACTION_PATTERN/)
  assert.match(workflow, /Failed to find Server Action/)
  assert.match(workflow, /This request might be from an older or newer deployment/)
  assert.match(workflow, /IGNORED_STALE_SERVER_ACTION_REQUESTS/)
  assert.match(workflow, /grep -Ev "\$STALE_SERVER_ACTION_PATTERN"/)
})

test('CloudWatch runtime review excludes only the explicit unauthenticated route guard while retaining generic auth error detection', () => {
  assert.match(workflow, /EXPECTED_AUTH_REQUIRED_PATTERN='\^AwsAuthenticationRequiredError: Authentication required\\\.\$'/)
  assert.match(workflow, /IGNORED_EXPECTED_AUTH_REQUIRED_REQUESTS/)
  assert.match(workflow, /grep -Ev "\$EXPECTED_AUTH_REQUIRED_PATTERN"/)
  assert.match(workflow, /auth\[\^\[\:cntrl\:\]\]\*\(failed\|error\)/)
  assert.doesNotMatch(workflow, /grep -Ev ['"]Authentication required/)
})

test('remote logo verification follows the compact header asset used by Wordmark', () => {
  assert.match(workflow, /ASSET_PATH="\/brand\/sea-and-shore-header-logo\.svg"/)
  assert.doesNotMatch(workflow, /sea-n-shore-compact-lockup\.webp/)
  assert.match(workflow, /test "\$content_type" = "image\/svg\+xml"/)
})

test('staging deployment verification polls until ECS reports rolloutState COMPLETED', () => {
  assert.match(stagingDeployWorkflow, /for attempt in \$\(seq 1 30\)/)
  assert.match(stagingDeployWorkflow, /sleep 5/)
  assert.match(stagingDeployWorkflow, /Timed out waiting for exact ECS deployment completion/)
})
