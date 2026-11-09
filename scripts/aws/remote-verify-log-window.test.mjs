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

test('CloudWatch runtime review excludes only the exact Next.js unauthenticated route guard while retaining generic auth error detection', () => {
  assert.equal(
    workflow.includes("EXPECTED_AUTH_REQUIRED_PATTERN='^⨯ Error \\[AwsAuthenticationRequiredError\\]: Authentication required\\.$'"),
    true,
  )
  assert.match(workflow, /IGNORED_EXPECTED_AUTH_REQUIRED_REQUESTS/)
  assert.match(workflow, /grep -Ev "\$EXPECTED_AUTH_REQUIRED_PATTERN"/)
  assert.match(workflow, /auth\[\^\[\:cntrl\:\]\]\*\(failed\|error\)/)
  assert.doesNotMatch(workflow, /grep -Ev ['"]Authentication required/)
})

test('CloudWatch runtime review counts the exact Cognito TooManyRequests safe message', () => {
  assert.match(workflow, /EXPECTED_COGNITO_THROTTLE_COUNT/)
  assert.match(workflow, /Too many Cognito requests\. Please try again later/)
})

test('CloudWatch runtime review reports safe Cognito issue reasons without treating them as strong runtime failures', () => {
  assert.match(workflow, /COGNITO_ISSUE_PATTERN/)
  assert.match(workflow, /COGNITO_ISSUE_COUNT/)
  assert.match(workflow, /COGNITO_ISSUE_REASONS/)
  assert.match(workflow, /COGNITO_ISSUE_PATTERN='\\\\\[cognito_issue\\\\\]'/)
})

test('remote verify reports Cognito signup capacity and throttle telemetry without mutating limits', () => {
  assert.match(workflow, /COGNITO_USER_CREATION_PROVISIONED_RPS=/)
  assert.match(workflow, /COGNITO_USER_CREATION_FREE_RPS=/)
  assert.match(workflow, /COGNITO_SIGNUP_THROTTLES_60M=/)
  assert.match(workflow, /COGNITO_SIGNUP_SUCCESSES_60M=/)
  assert.match(workflow, /COGNITO_SIGNUP_ATTEMPTS_60M=/)
  assert.match(workflow, /COGNITO_USER_CREATION_CALLS_60M=/)
  assert.match(workflow, /COGNITO_USER_CREATION_THROTTLES_60M=/)
  assert.match(workflow, /cognito-idp get-provisioned-limit/)
  assert.match(workflow, /--metric-name SignUpThrottles/)
  assert.match(workflow, /--metric-name SignUpSuccesses/)
  assert.match(workflow, /--namespace AWS\/Usage/)
  assert.doesNotMatch(workflow, /cognito-idp update-provisioned-limit/)
  assert.doesNotMatch(workflow, /service-quotas request-service-quota-increase/)
})

test('remote verify reports live Cognito confirmation email delivery mode', () => {
  assert.match(workflow, /COGNITO_EMAIL_SENDING_ACCOUNT=/)
  assert.match(workflow, /COGNITO_EMAIL_SOURCE_CONFIGURED=/)
  assert.match(workflow, /COGNITO_EMAIL_FROM_CONFIGURED=/)
  assert.match(workflow, /cognito-idp describe-user-pool/)
})

test('remote logo verification follows the compact header asset used by Wordmark', () => {
  assert.match(workflow, /ASSET_PATH="\/brand\/sea-n-shore-lockup\.webp"/)
  assert.doesNotMatch(workflow, /sea-and-shore-header-logo\.svg/)
  assert.match(workflow, /test "\$content_type" = "image\/webp"/)
})

test('remote verify counts Cashfree refusals as payment provider issues, not runtime errors', () => {
  assert.match(workflow, /PAYMENT_PROVIDER_ISSUE_PATTERN='\\\[payment_provider_issue\\\]'/)
  assert.match(workflow, /grep -Ev "\$PAYMENT_PROVIDER_ISSUE_PATTERN"/)
  assert.match(workflow, /PAYMENT_PROVIDER_ISSUE_COUNT=/)
})

test('staging deployment verification polls until ECS reports rolloutState COMPLETED', () => {
  assert.match(stagingDeployWorkflow, /for attempt in \$\(seq 1 30\)/)
  assert.match(stagingDeployWorkflow, /sleep 5/)
  assert.match(stagingDeployWorkflow, /Timed out waiting for exact ECS deployment completion/)
})

test('the no-ID stale-tab error is counted, excluded from strong matches, and fails the run when it stays high', () => {
  // Run 42645107588: Next.js logs the stale-tab error without the action ID too.
  assert.ok(workflow.includes("STALE_SERVER_ACTION_NO_ID_PATTERN='^⨯ Error: Failed to find Server Action\\. This request might be from an older or newer deployment\\.$'"))
  assert.match(workflow, /grep -Ev "\$STALE_SERVER_ACTION_NO_ID_PATTERN"/)
  assert.match(workflow, /STALE_SERVER_ACTION_NO_ID_REQUESTS=\$STALE_SERVER_ACTION_NO_ID_REQUESTS/)
  // Both forms, after the first 30 minutes, per hour over at least an hour, against a fixed limit.
  assert.match(workflow, /STALE_TAB_GRACE_SECONDS=1800\n/)
  assert.match(workflow, /STALE_TAB_MAX_PER_HOUR=60\n/)
  assert.match(workflow, /select\(\.timestamp >= \$after\)/)
  assert.match(workflow, /grep -Ec "\$STALE_SERVER_ACTION_PATTERN\|\$STALE_SERVER_ACTION_NO_ID_PATTERN"/)
  assert.match(workflow, /STALE_TAB_MEASURED_SECONDS > 3600 \? STALE_TAB_MEASURED_SECONDS : 3600/)
  assert.match(workflow, /if \[ "\$STALE_TAB_PER_HOUR" -gt "\$STALE_TAB_MAX_PER_HOUR" \]; then\n[^\n]*\n\s+exit 1\n/)
})

test('every error type is printed with its count, with addresses, ids, quoted values, links and numbers removed', () => {
  assert.match(workflow, /=== ERROR TYPES IN THE CURRENT PRIMARY DEPLOYMENT \(count, signature\) ===/)
  assert.match(workflow, /error_types \/tmp\/remote-verify-cloudwatch\.json/)
  for (const replaced of ['[email]', '[link]', '[uuid]', '[hex]', '[n]']) assert.ok(workflow.includes(`"${replaced}"`), replaced)
  assert.match(workflow, /grep -Eai "\$ERROR_LINE_REGEX"/)
  // The listing for an earlier window is report only: validated, and it never changes the pass/fail.
  assert.match(workflow, /types_since:\n\s+description: "Report only:/)
  assert.match(workflow, /\[\[ "\$TYPES_SINCE" =~ \^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T\[0-9\]\{2\}:\[0-9\]\{2\}:\[0-9\]\{2\}Z\$ \]\]/)
  const since = workflow.slice(workflow.indexOf('if [ -n "${TYPES_SINCE:-}" ]; then'), workflow.indexOf('if [ "$STALE_TAB_PER_HOUR"'))
  assert.ok(since.length > 0)
  assert.doesNotMatch(since, /MATCH_COUNT|STALE_TAB_PER_HOUR/)
})
