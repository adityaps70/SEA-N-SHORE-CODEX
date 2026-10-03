import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-onboarding-e2e.yml'
const actionPath = 'scripts/aws/onboarding-e2e-action.txt'
const browserScriptPath = 'scripts/aws/onboarding-staging-e2e.mjs'
const persistenceAuditPath = 'scripts/aws/onboarding-e2e-persistence-audit.sh'

test('onboarding e2e is safe by default and branch-scoped with exact-head CI gating', () => {
  const action = readFileSync(actionPath, 'utf8').trim()
  assert.ok(['plan', 'probe', 'run-once'].includes(action), `Unexpected onboarding e2e action: ${action}`)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/onboarding-e2e-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /ONBOARDING_E2E_ACTION/)
  assert.match(workflow, /run-once/)
})

test('probe mode remains read-only and runs on the staging bootstrap through SSM', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /Discover bootstrap instance/)
  assert.match(workflow, /sea-n-shore-bootstrap/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /sea-n-shore-staging-users/)
  assert.match(workflow, /admin-get-user/)
  assert.match(workflow, /UserNotFoundException/)
  assert.match(workflow, /COGNITO_ADMIN_PROBE_AVAILABLE=true/)

  const start = workflow.indexOf('- name: Send read-only Cognito admin capability probe through SSM')
  const end = workflow.indexOf('- name: Wait and surface read-only probe evidence')
  assert.ok(start >= 0 && end > start)
  const probeBlock = workflow.slice(start, end)
  assert.doesNotMatch(probeBlock, /admin-confirm-sign-up/)
  assert.doesNotMatch(probeBlock, /admin-delete-user/)
  assert.doesNotMatch(probeBlock, /delete from public\.profiles/i)
})

test('run-once covers the new eight-persona onboarding model and excludes the retired identity-root UI', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const auditScript = readFileSync(persistenceAuditPath, 'utf8')

  for (const key of ['seafarer', 'shore', 'recruiter', 'trainer', 'student', 'family', 'enthusiast', 'other']) {
    assert.match(workflow, new RegExp(`E2E_${key.toUpperCase()}_EMAIL`))
    assert.match(browserScript, new RegExp(`ONBOARDING_E2E_PERSONA_${key.toUpperCase()}_VERIFIED=true`))
  }

  for (const label of [
    'Seafarer',
    'Shore Professional',
    'Recruiter / HR',
    'Trainer / Instructor',
    'Student / Cadet',
    'Seafarer Family',
    'Maritime Enthusiast',
    'Other',
  ]) {
    assert.ok(browserScript.includes(label), `Missing persona journey for ${label}`)
  }

  assert.match(browserScript, /What are you here to do\?/)
  assert.match(browserScript, /aria-pressed/)
  assert.match(browserScript, /ONBOARDING_E2E_ALL_PERSONAS_VERIFIED=true/)
  assert.match(auditScript, /coalesce\(p\.persona,''\)/)
  assert.match(auditScript, /array_to_string\(p\.profile_intents,','\)/)
  assert.match(auditScript, /ONBOARDING_E2E_PERSONA_PERSISTENCE_VERIFIED=true/)

  assert.doesNotMatch(browserScript, /Professional Build your individual maritime identity/)
  assert.doesNotMatch(browserScript, /Search professional identities/)
  assert.doesNotMatch(browserScript, /Custom maritime identity/)
  assert.doesNotMatch(browserScript, /Organisation Represent a maritime organisation/)
  assert.doesNotMatch(browserScript, /Search organisation identities/)
})

test('persona selection uses exact accessible labels without Seafarer collisions', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.doesNotMatch(browserScript, /function personaButtonNamePattern\(user\)/)
  assert.match(browserScript, /getByRole\('button', \{\s*name:\s*user\.label,\s*exact:\s*true,?\s*\}\)/)
})

test('profile edit rank locator is exact so onboarding and profile labels cannot collide', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(browserScript, /getByLabel\('Rank', \{ exact: true \}\)/)
  assert.doesNotMatch(browserScript, /getByLabel\('Rank'\)(?!,)/)
})

test('onboarding e2e audits persistence without destructive inline cleanup', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /Audit persona persistence through SSM/)
  assert.match(workflow, /ONBOARDING_E2E_PERSONA_PERSISTENCE_VERIFIED=true/)
  assert.doesNotMatch(workflow, /admin-delete-user/)
  assert.doesNotMatch(workflow, /delete from public\.profiles/i)
})

test('persona persistence audit still runs after an unrelated avatar proof failure', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const start = workflow.indexOf('- name: Audit persona persistence through SSM')
  const end = workflow.indexOf('- name: Wait and surface persistence evidence')
  assert.ok(start >= 0 && end > start)
  const auditBlock = workflow.slice(start, end)
  assert.match(auditBlock, /if:\s*always\(\)/)
  assert.match(auditBlock, /steps\.journeys\.outcome == 'success'/)
  assert.doesNotMatch(auditBlock, /steps\.feed_avatar\.outcome/)
})

test('run-once includes mobile viewport and serious accessibility regression checks', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(browserScript, /@axe-core\/playwright/)
  assert.match(browserScript, /new AxeBuilder\(\{ page \}\)/)
  assert.match(browserScript, /critical/)
  assert.match(browserScript, /serious/)
  assert.match(browserScript, /width:\s*390/)
  assert.match(browserScript, /height:\s*844/)
  assert.match(browserScript, /scrollWidth/)
  assert.match(browserScript, /clientWidth/)
  assert.match(browserScript, /ONBOARDING_E2E_ACCESSIBILITY_VERIFIED=true/)
  assert.match(browserScript, /ONBOARDING_E2E_MOBILE_LAYOUT_VERIFIED=true/)
})

test('run-once keeps persona selection unambiguous and persistence audit syntax valid', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(browserScript, /name:\s*user\.label/)
  assert.match(browserScript, /exact:\s*true/)
  assert.match(workflow, /steps\.journeys\.outcome == 'success'/)
  assert.match(workflow, /scripts\/aws\/onboarding-e2e-persistence-audit\.sh/)
  assert.doesNotMatch(workflow, /ONBOARDING_E2E_CLEANUP_VERIFIED=true/)
})

test('public signup retries only explicit Cognito throttling with bounded backoff', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(browserScript, /const SIGNUP_THROTTLE_MESSAGE = 'Too many sign-up requests\. Please wait a moment and try again\.'/)
  assert.match(browserScript, /const SIGNUP_LIMIT_MESSAGE = 'Sign-up attempt limit reached\. Please try again later\.'/)
  assert.match(browserScript, /const SIGNUP_THROTTLE_RETRY_DELAYS_MS = \[15_000, 30_000, 60_000\]/)
  assert.match(browserScript, /outcome\?\.kind === 'error' && safeText === SIGNUP_THROTTLE_MESSAGE/)
  assert.match(browserScript, /outcome\?\.kind === 'error' && safeText === SIGNUP_LIMIT_MESSAGE/)
  assert.match(browserScript, /ONBOARDING_E2E_PUBLIC_SIGNUP_LIMIT_EXCEEDED=true/)
  assert.match(browserScript, /Cognito sign-up attempt limit is currently exceeded/)
  assert.match(browserScript, /ONBOARDING_E2E_SIGNUP_THROTTLE_RETRY=/)
  assert.match(browserScript, /await page\.waitForTimeout\(retryDelay\)/)
  assert.match(browserScript, /retryDelay !== undefined/)
})

test('public signup defers explicit confirmation-delivery quota failures to the admin confirmation proof', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(browserScript, /const SIGNUP_DELIVERY_LIMIT_MESSAGE = 'Email confirmation is temporarily unavailable\. Continue with mobile number below, or try email sign-up later\.'/)
  assert.match(browserScript, /outcome\?\.kind === 'error' && safeText === SIGNUP_DELIVERY_LIMIT_MESSAGE/)
  assert.match(browserScript, /ONBOARDING_E2E_PUBLIC_SIGNUP_DELIVERY_DEFERRED=/)
  assert.match(browserScript, /return 'delivery-deferred'/)
  assert.match(browserScript, /\['confirmed', 'delivery-deferred'\]\.includes\(signupOutcome\)/)
  assert.doesNotMatch(browserScript, /assert\.equal\(signupOutcome, 'confirmed'\)/)
})

test('admin confirmation proves deferred signups exist and surfaces Cognito failures', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const confirmStart = workflow.indexOf('- name: Confirm disposable sign-ups through staging bootstrap')
  const confirmEnd = workflow.indexOf('- name: Wait for disposable sign-up confirmation')
  assert.ok(confirmStart >= 0 && confirmEnd > confirmStart)
  const confirmBlock = workflow.slice(confirmStart, confirmEnd)

  assert.match(confirmBlock, /admin-get-user/)
  assert.match(confirmBlock, /UserNotFoundException/)
  assert.match(confirmBlock, /UserStatus/)
  assert.match(confirmBlock, /UNCONFIRMED/)
  assert.match(confirmBlock, /CONFIRMED/)
  assert.match(confirmBlock, /admin-confirm-sign-up/)
  assert.match(confirmBlock, /ONBOARDING_E2E_ADMIN_CONFIRM_VERIFIED=true/)

  const waitStart = confirmEnd
  const waitEnd = workflow.indexOf('- name: Run staging sign-in and onboarding browser journeys')
  assert.ok(waitEnd > waitStart)
  const waitBlock = workflow.slice(waitStart, waitEnd)
  assert.match(waitBlock, /StandardErrorContent/)
  assert.match(waitBlock, /ONBOARDING E2E ADMIN CONFIRM STDERR/)
})

test('public signup is quota-aware and creates all eight persona accounts', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(browserScript, /const SIGNUP_INTER_USER_DELAY_MS = 15_000/)
  assert.match(browserScript, /for \(const \[index, user\] of users\.entries\(\)\)/)
  assert.match(browserScript, /await signUp\(user\)/)
  assert.match(browserScript, /ONBOARDING_E2E_PUBLIC_SIGNUP_USER_VERIFIED=/)
  assert.match(browserScript, /ONBOARDING_E2E_PUBLIC_SIGNUP_THROTTLED=true/)
  assert.match(browserScript, /Public sign-up remained throttled after bounded retries/)

  assert.match(workflow, /Verify public sign-up UI creates eight disposable users/)
  assert.match(workflow, /admin-confirm-sign-up/)
  assert.doesNotMatch(workflow, /admin-create-user/)
  assert.doesNotMatch(workflow, /admin-set-user-password/)
})

test('run-once performs a public sign-up smoke check, eight persona journeys and read-only persistence audit', () => {
  assert.equal(existsSync(browserScriptPath), true, `${browserScriptPath} must exist`)
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /node scripts\/aws\/onboarding-staging-e2e\.mjs/)
  assert.match(workflow, /admin-confirm-sign-up/)
  assert.doesNotMatch(workflow, /admin-delete-user/)
  assert.doesNotMatch(workflow, /delete from public\.profiles/i)
  assert.match(workflow, /sea-n-shore-e2e-/)
  assert.match(workflow, /example\.com/)
  assert.match(workflow, /ONBOARDING_E2E_PERSONA_PERSISTENCE_VERIFIED=true/)

  assert.match(browserScript, /\/auth\/sign-up/)
  assert.match(browserScript, /Create account/)
  assert.match(browserScript, /\/auth\/sign-in/)
  assert.match(browserScript, /Sign in/)
  assert.match(browserScript, /Which best describes you|Set your course in the global shipping community/)
  assert.match(browserScript, /Current or most recent rank/)
  assert.match(browserScript, /Current role \/ designation/)
  assert.match(browserScript, /Role \/ designation/)
  assert.match(browserScript, /Training specialization/)
  assert.match(browserScript, /Institute \/ academy/)
  assert.match(browserScript, /Relationship to the maritime community/)
  assert.match(browserScript, /How would you describe yourself\?/)
  assert.match(browserScript, /ONBOARDING_E2E_ALL_PERSONAS_VERIFIED=true/)
  assert.match(browserScript, /\/home/)
  assert.match(browserScript, /\/profile/)
  assert.match(browserScript, /\/profile\/edit/)
})

test('run-once proves the full live Username contract and two-change server limit', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.doesNotMatch(browserScript, /Profile address/)
  assert.match(browserScript, /function usernameInput\(page\)/)
  assert.match(browserScript, /page\.locator\('input\[name="slug"\]'\)/)
  assert.doesNotMatch(
    browserScript,
    /getByLabel\('Username'\)/,
    'Username E2E must target the unique slug input instead of an ambiguous accessible label match',
  )
  assert.match(browserScript, /Checking username…/)
  assert.match(browserScript, /Username is available\./)
  assert.match(browserScript, /That username is already taken\./)
  assert.match(browserScript, /That username is reserved\./)
  assert.match(browserScript, /This is your current username\./)
  assert.match(browserScript, /ONBOARDING_E2E_USERNAME_LOWERCASE_VERIFIED=true/)
  assert.match(browserScript, /ONBOARDING_E2E_USERNAME_RESERVED_VERIFIED=true/)
  assert.match(browserScript, /ONBOARDING_E2E_USERNAME_CHECKING_GUARD_VERIFIED=true/)
  assert.match(browserScript, /ONBOARDING_E2E_USERNAME_CURRENT_VERIFIED=true/)
  assert.match(browserScript, /ONBOARDING_E2E_USERNAME_PUBLIC_URL_VERIFIED=true/)
  assert.match(browserScript, /ONBOARDING_E2E_LEGACY_PROFILE_URL_VERIFIED=true/)
  assert.match(browserScript, /a\[href\^="\/people\/"\]/)
  assert.match(browserScript, /Username changes remaining: 2 of 2\./)
  assert.match(browserScript, /Username changes remaining: 1 of 2\./)
  assert.match(browserScript, /Username changes remaining: 0 of 2\./)
  assert.match(browserScript, /both username changes have been used/)
  assert.match(browserScript, /removeAttribute\('readonly'\)/)
  assert.match(browserScript, /ONBOARDING_E2E_USERNAME_THIRD_CHANGE_BLOCKED=true/)
  assert.match(browserScript, /page\.reload/)
  assert.match(browserScript, /ONBOARDING_E2E_USERNAME_LIMIT_AUDIT_VERIFIED=true/)
  assert.doesNotMatch(
    browserScript,
    /page\.goto\(`\$\{siteUrl\}\/profile\/edit`, \{ waitUntil: 'domcontentloaded' \}\)/,
    'Profile edit E2E must wait for client hydration before editing controlled Username fields',
  )
})

test('onboarding e2e stays focused on onboarding and profile identity behavior', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.doesNotMatch(
    browserScript,
    /page\.goto\(`\$\{siteUrl\}\/events/,
    'Events content is mutable and must not make onboarding/Username verification data-dependent',
  )
  assert.doesNotMatch(browserScript, /ONBOARDING_E2E_EVENTS_VERIFIED=true/)
})

test('signup diagnostics ignore the empty Next.js route announcer and audit only completed journeys', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const auditScript = readFileSync(persistenceAuditPath, 'utf8')

  assert.equal(existsSync(persistenceAuditPath), true, `${persistenceAuditPath} must exist`)
  assert.match(browserScript, /locator\('p\[role="alert"\]'\)/)
  assert.match(browserScript, /locator\('p\[role="status"\]'\)/)
  assert.doesNotMatch(browserScript, /getByRole\('alert'\)/)
  assert.match(workflow, /id:\s*journeys/)
  assert.match(workflow, /steps\.journeys\.outcome == 'success'/)
  assert.match(workflow, /scripts\/aws\/onboarding-e2e-persistence-audit\.sh/)
  assert.match(auditScript, /ONBOARDING_E2E_PERSONA_PERSISTENCE_VERIFIED=true/)
  assert.doesNotMatch(auditScript, /delete\s+from/i)
  assert.doesNotMatch(auditScript, /admin-delete-user/)
})


test('workflow structure keeps step ids unique and admin confirmation assertion complete', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const ids = [...workflow.matchAll(/^\s+id:\s*([A-Za-z0-9_-]+)\s*$/gm)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length, `Duplicate onboarding workflow step id(s): ${ids.join(', ')}`)

  for (const stepName of [
    'Run staging sign-in and onboarding browser journeys',
    'Verify authenticated Home feed avatar hydration',
    'Audit persona persistence through SSM',
    'Wait and surface persistence evidence',
  ]) {
    const count = workflow.split(`- name: ${stepName}`).length - 1
    assert.equal(count, 1, `Expected exactly one "${stepName}" step, found ${count}`)
  }

  assert.match(
    workflow,
    /grep -q '\^ONBOARDING_E2E_ADMIN_CONFIRM_VERIFIED=true\$'/,
    'Admin confirmation marker assertion must be a complete quoted grep expression',
  )
})


test('confirmation shell variables do not leak into the Python f-string', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const start = workflow.indexOf('- name: Confirm disposable sign-ups through staging bootstrap')
  const end = workflow.indexOf('- name: Wait for disposable sign-up confirmation')
  assert.ok(start >= 0 && end > start)
  const confirmBlock = workflow.slice(start, end)

  assert.doesNotMatch(confirmBlock, /\$\{USER_STATUS:-missing\}/)
  assert.match(confirmBlock, /Unexpected Cognito UserStatus for disposable user \$EMAIL: \$USER_STATUS/)
})

