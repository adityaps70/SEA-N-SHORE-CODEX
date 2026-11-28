import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const actionPath = 'scripts/aws/organization-hiring-e2e-action.txt'
const workflowPath = '.github/workflows/aws-organization-hiring-e2e.yml'
const browserScriptPath = 'scripts/aws/organization-hiring-staging-e2e.mjs'
const ssmHelperPath = 'scripts/aws/organization-hiring-e2e-ssm.mjs'
const remoteScriptPath = 'scripts/aws/organization-hiring-e2e-remote.sh'

test('organization hiring e2e is branch scoped with a plan or exact one-shot guard', () => {
  assert.equal(existsSync(actionPath), true, `${actionPath} must exist`)
  const action = guardAction(readFileSync(actionPath, 'utf8'))
  assert.ok(['plan', 'run-once'].includes(action), `Unexpected organization hiring E2E action: ${action}`)
  assert.equal(existsSync(workflowPath), true, `${workflowPath} must exist`)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/organization-hiring-e2e-action\.txt/)
  assert.match(workflow, /ORGANIZATION_HIRING_E2E_ACTION/)
  assert.match(workflow, /run-once/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /Guard push E2E against a moved branch/)
  assert.match(workflow, /310356785722/)
  assert.doesNotMatch(workflow, /992382634586/)
})

test('run-once uses disposable authenticated users and the live organization approval and hiring UI', () => {
  for (const path of [browserScriptPath, ssmHelperPath, remoteScriptPath]) assert.equal(existsSync(path), true, `${path} must exist`)
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const ssmHelper = readFileSync(ssmHelperPath, 'utf8')

  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /sea-n-shore-hiring-e2e-/)
  assert.match(workflow, /-applicant@example\.com/)
  assert.match(workflow, /-admin@example\.com/)
  assert.match(workflow, /-unauthorized@example\.com/)
  assert.match(ssmHelper, /aws|ssm|send-command/i)

  assert.match(browserScript, /\/auth\/sign-up/)
  assert.match(browserScript, /\/auth\/sign-in/)
  assert.match(browserScript, /\/organizations\/register/)
  assert.match(browserScript, /getByRole\('form', \{ name: 'Register a new organization' \}\)/)
  assert.match(browserScript, /selectOption\('shipowner'\)/)
  assert.match(browserScript, /Submit for verification/)
  assert.match(browserScript, /Organization verification in progress/)
  assert.match(browserScript, /\/admin\/organizations\//)
  assert.match(browserScript, /Approve organization/)
  assert.match(browserScript, /Verified employer/)
  assert.match(browserScript, /\/hiring\/jobs\/new/)
  assert.match(browserScript, /Post a maritime job/)
  assert.match(browserScript, /getByRole\('button', \{ name: 'Publish job', exact: true \}\)/)
  assert.match(browserScript, /\/jobs\?q=/)
  assert.match(browserScript, /Easy Apply/)
  assert.match(browserScript, /Applied/)
  assert.match(browserScript, /\/jobs\/\$\{jobId\}/)
  assert.match(browserScript, /Application submitted/)
  assert.match(browserScript, /ORGANIZATION_HIRING_E2E_JOB_APPLICATION_UI_VERIFIED=true/)
  assert.match(browserScript, /To publish this job, you still need:/)
  assert.match(browserScript, /cross-company edit route must return 404/)
})

test('the disposable admin turns on two-step verification, then approves and grants only hiring access', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remoteScriptPath, 'utf8')
  const twoStep = browserScript.match(/async function enableAdminTwoStep[\s\S]*?\n}\n/)?.[0] ?? ''
  const approval = browserScript.match(/async function approveOrganization[\s\S]*?\n}\n/)?.[0] ?? ''
  const grant = browserScript.match(/async function grantOrganizationEntitlement[\s\S]*?\n}\n/)?.[0] ?? ''

  // Admin pages and decisions require an authenticator app (Round 14); the E2E uses the real setup, not a bypass.
  assert.match(browserScript, /^import \{ freshTotpCode \} from '\.\/e2e-totp\.mjs'$/m)
  assert.match(twoStep, /url\.pathname === '\/settings\/security' && url\.searchParams\.get\('required'\) === 'admin'/)
  assert.match(twoStep, /getByRole\('button', \{ name: 'Set up authenticator app' \}\)/)
  assert.match(twoStep, /getByLabel\('Setup key', \{ exact: true \}\)/)
  assert.match(twoStep, /freshTotpCode\(secret\)/)
  assert.match(twoStep, /Verify and turn on/)
  assert.doesNotMatch(twoStep, /console\.log\([^)]*secret/)
  assert.match(approval, /enableAdminTwoStep\(page\)/)
  assert.match(approval, /assert\.equal\(new URL\(page\.url\(\)\)\.pathname, `\/admin\/organizations\/\$\{applicationId\}`/)

  // Verification alone gives no publishing; exactly these two admin grants, each with a reason naming the run.
  assert.deepEqual([...approval.matchAll(/grantOrganizationEntitlement\(page, '([a-z._]+)'\)/g)].map((match) => match[1]), ['job.publish', 'job.manage_applicants'])
  assert.match(grant, /Disposable staging hiring E2E \$\{runId\}: \$\{capability\}/)
  assert.match(grant, /Entitlement granted and recorded in the audit trail\./)
  assert.match(grant, /toBeDisabled\(\)/)
  assert.match(remote, /g\.source='admin' AND g\.granted_by=\(\$admin_id_sql\)/)
  assert.match(remote, /\[\[ "\$GRANTS" == 'job\.manage_applicants,job\.publish' \]\]/)
  assert.match(remote, /\[\[ "\$OTHER_GRANTS" == 0 \]\]/)
  assert.match(workflow, /grep -q '\^ORGANIZATION_HIRING_E2E_HIRING_GRANTS_VERIFIED=true\$'/)
  assert.match(workflow, /paths:[\s\S]*?\n\s+- scripts\/aws\/e2e-totp\.mjs\n[\s\S]*?workflow_dispatch:/)
  assert.match(workflow, /RUNNER_FILES: "[^"]*\bscripts\/aws\/e2e-totp\.mjs\b[^"]*"/)
})

test('the owner publishes through the current job form, with roles from the taxonomy and no match gate', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const ownerFlow = browserScript.match(/async function postJobAsOwner[\s\S]*?\n}\n/)?.[0] ?? ''

  assert.match(ownerFlow, /getByText\(`Ready · \$\{organizationName\}`, \{ exact: true \}\)/)
  assert.match(ownerFlow, /getByRole\('radio', \{ name: new RegExp\(`\^\$\{escapeRegExp\(organizationName\)\}`\) \}\)/)
  assert.match(ownerFlow, /toBeChecked\(\)/)
  assert.match(ownerFlow, /getByLabel\('Department', \{ exact: true \}\)\.selectOption\('deck_officers'\)/)
  assert.match(ownerFlow, /getByRole\('group', \{ name: 'Accepted ranks \/ roles' \}\)\.getByRole\('checkbox', \{ name: 'Chief Officer', exact: true \}\)\.check\(\)/)
  assert.match(ownerFlow, /getByLabel\('Last date to apply', \{ exact: true \}\)\.fill\(isoDateFromToday\(30\)\)/)
  assert.match(ownerFlow, /getByLabel\('Minimum match to apply'\)\.fill\('0'\)/)
  assert.match(ownerFlow, /url\.pathname === '\/hiring\/jobs'/)
  assert.match(ownerFlow, /name: 'Your jobs'/)
  assert.match(ownerFlow, /getByText\('Live', \{ exact: true \}\)/)
})

test('the retired job form, lifecycle and access screens are gone', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  for (const retired of [
    "'Create job'",
    'Job saved successfully.',
    'Changes saved successfully.',
    "getByLabel('Status')",
    "getByLabel('Apply until')",
    "getByLabel('Rank / position')",
    "getByLabel('Visas')",
    "fill('Deck')",
    "'2026-09-01'",
    "'Company jobs'",
    "'Verified company'",
    "'Review candidate'",
    "'Hiring access required'",
    "'Hiring access'",
    "getByText('published', { exact: true })",
    "getByText('closed', { exact: true })",
  ]) {
    assert.equal(browserScript.includes(retired), false, `retired hiring UI is still used: ${retired}`)
  }
})


test('organization hiring e2e proves expired published visibility and archived republish lifecycle', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const ssmHelper = readFileSync(ssmHelperPath, 'utf8')
  const remote = readFileSync(remoteScriptPath, 'utf8')

  assert.match(workflow, /candidate-expired-visibility/)
  assert.match(workflow, /owner-republish/)
  assert.match(workflow, /verify-republish/)
  assert.match(browserScript, /ORGANIZATION_HIRING_E2E_JOBS_DISCOVERY_RENDERED=true/)
  assert.match(browserScript, /ORGANIZATION_HIRING_E2E_EXPIRED_PUBLISHED_VISIBLE=true/)
  assert.match(browserScript, /ORGANIZATION_HIRING_E2E_ARCHIVE_REPUBLISH_UI_VERIFIED=true/)

  // The UI refuses a past apply-by date, so one guarded SSM step backdates this run's published job only.
  const expire = remote.match(/\n  expire-job\)\n[\s\S]*?\n    ;;\n/)?.[0] ?? ''
  assert.match(ssmHelper, /'expire-job'/)
  assert.match(workflow, /organization-hiring-e2e-ssm\.mjs expire-job\)"[\s\S]*?grep -q '\^ORGANIZATION_HIRING_E2E_JOB_EXPIRED=true\$'/)
  assert.ok(workflow.indexOf('ssm.mjs resolve-job') < workflow.indexOf('ssm.mjs expire-job'), 'the job is resolved before it is expired')
  assert.ok(workflow.indexOf('ssm.mjs expire-job') < workflow.indexOf('E2E_PHASE: candidate-expired-visibility'), 'the job is expired before the candidate checks it')
  assert.match(expire, /UPDATE public\.jobs SET apply_until = current_date - 1 WHERE id='\$JOB_ID'::uuid AND company_id='\$COMPANY_ID'::uuid AND title='\$JOB_TITLE' AND status::text='published' AND deleted_at IS NULL RETURNING/)
  assert.match(expire, /\[\[ "\$UPDATED" == 1 \]\]/)
  assert.doesNotMatch(expire, /\b(?:DELETE|INSERT)\b/i)

  // Members still find the expired job but cannot apply; the owner archives, then republishes with no closing date.
  const expired = browserScript.match(/async function verifyExpiredPublishedJobVisible[\s\S]*?\n}\n/)?.[0] ?? ''
  const lifecycle = browserScript.match(/async function archiveAndRepublishJob[\s\S]*?\n}\n/)?.[0] ?? ''
  assert.match(expired, /getByText\('Applications closed', \{ exact: true \}\)/)
  assert.match(expired, /getByRole\('button', \{ name: 'Easy Apply' \}\)\)\.toHaveCount\(0\)/)
  assert.match(expired, /Applications for this job closed on /)
  assert.match(lifecycle, /runLifecycleAction\(page, 'Archive', 'Archive job', 'Job archived\./)
  assert.match(lifecycle, /runLifecycleAction\(page, 'Republish', 'Republish job', 'Job republished\./)
  assert.match(lifecycle, /getByLabel\('No closing date', \{ exact: true \}\)\.check\(\)/)
  assert.match(lifecycle, /getByLabel\('Last date to apply', \{ exact: true \}\)\)\.toHaveValue\(''\)/)
  assert.match(ssmHelper, /verify-republish/)
  assert.match(remote, /verify-republish\)/)
  assert.match(remote, /ORGANIZATION_HIRING_E2E_REPUBLISH_VERIFIED=true/)
  assert.match(remote, /apply_until is null/i)
  assert.match(remote, /published_at > created_at/i)
})

test('applicant onboarding is the Recruiter / HR persona and lands on Home, like production', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const organizationFlow = browserScript.match(/async function completeApplicantOrganisation[\s\S]*?\n}\n/)?.[0] ?? ''

  // Persona onboarding no longer creates an organization (src/features/profiles/actions-organization-redirect.test.ts).
  assert.match(organizationFlow, /getByRole\('button', \{ name: 'Recruiter \/ HR', exact: true \}\)/)
  assert.match(organizationFlow, /getByRole\('button', \{ name: 'Hire people', exact: true \}\)/)
  assert.match(organizationFlow, /toHaveAttribute\('aria-pressed', 'true'\)/)
  assert.match(organizationFlow, /getByLabel\('Current organisation', \{ exact: true \}\)/)
  assert.match(organizationFlow, /`hire-org-\$\{runId\}`/)
  assert.match(organizationFlow, /url\.pathname === '\/home'/)
  assert.doesNotMatch(organizationFlow, /hiring\/organization/)
  assert.doesNotMatch(organizationFlow, /Organisation name/)
})

test('member onboarding uses the shared Seafarer Master helper with the script\'s own disposable username', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const professionalFlow = browserScript.match(/async function completeProfessional[\s\S]*?\n}\n/)?.[0] ?? ''

  assert.match(browserScript, /^import \{ chooseSeafarerMaster \} from '\.\/e2e-onboarding\.mjs'$/m)
  assert.match(professionalFlow, /await chooseSeafarerMaster\(page, \{ organisation \}\)/)
  assert.match(professionalFlow, /`hire-\$\{slugSuffix\}-\$\{runId\}`/)
  assert.match(professionalFlow, /username\.length <= 30/)
  assert.match(professionalFlow, /input\[name="slug"\]/)
  assert.match(professionalFlow, /getByText\('Username is available\.', \{ exact: true \}\)/)
  assert.match(professionalFlow, /url\.pathname === '\/home'/)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /paths:[\s\S]*?\n\s+- scripts\/aws\/e2e-onboarding\.mjs\n[\s\S]*?workflow_dispatch:/)
  assert.match(workflow, /RUNNER_FILES: "[^"]*\bscripts\/aws\/e2e-onboarding\.mjs\b[^"]*"/)
})

test('the retired Professional / Organisation onboarding cards and old hiring form are gone', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  for (const retired of [
    'Professional Build your individual maritime identity',
    'Organisation Represent a maritime organisation',
    'Search professional identities',
    'Search organisation identities',
    'Master — Sea-going · Deck',
    'Shipowner — Shipping & Ship Management',
    'data-primary-identity',
    'Organisation name',
    'Organization verification\'',
    'Official company email',
    "fill('Shipowner and Ship Manager')",
  ]) {
    assert.equal(browserScript.includes(retired), false, `retired onboarding or registration UI is still used: ${retired}`)
  }
  assert.doesNotMatch(browserScript, /\$\{siteUrl\}\/hiring\/organization/)
})

test('organization submission verifies durable review state instead of a transient toast', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const submissionFlow = browserScript.match(/async function submitOrganizationApplication[\s\S]*?\n}\n/)?.[0] ?? ''

  assert.match(submissionFlow, /\$\{siteUrl\}\/organizations\/register/)
  assert.match(submissionFlow, /getByLabel\('Organization name', \{ exact: true \}\)\.fill\(organizationName\)/)
  // The status line only proves the action returned; the review state is read back after loading Organizations.
  assert.match(submissionFlow, /getByRole\('status'\)[\s\S]*goto\(`\$\{siteUrl\}\/organizations`[\s\S]*getByRole\('heading', \{ name: 'Organization verification in progress', exact: true \}\)/)
  assert.doesNotMatch(submissionFlow, /getByText\('Organization submitted for verification\.'\)/)
})

test('organization approval verifies durable employer state instead of a transient toast', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const approvalFlow = browserScript.match(/async function approveOrganization[\s\S]*?\n}\n/)?.[0] ?? ''

  assert.match(approvalFlow, /getByText\('Verified employer', \{ exact: true \}\)/)
  assert.doesNotMatch(approvalFlow, /getByText\('Review decision saved\.'\)/)
})

test('owner job submission records actionable Server Action diagnostics before failing', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const ownerFlow = browserScript.match(/async function postJobAsOwner[\s\S]*?\n}\n/)?.[0] ?? ''

  assert.match(ownerFlow, /postObservations/)
  assert.match(ownerFlow, /requestFailures/)
  assert.match(ownerFlow, /consoleErrors/)
  assert.match(ownerFlow, /jobStatus/)
  assert.match(ownerFlow, /Job create action failed/)
  assert.match(ownerFlow, /Job create navigation failed/)
})

test('failed owner submission probes persisted job state and live schema before throwing', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const ssmHelper = readFileSync(ssmHelperPath, 'utf8')
  const remote = readFileSync(remoteScriptPath, 'utf8')

  assert.match(browserScript, /organization-hiring-e2e-ssm\.mjs/)
  assert.match(browserScript, /probe-job/)
  assert.match(ssmHelper, /probe-job/)
  assert.match(remote, /probe-job\)/)
  assert.match(remote, /ORGANIZATION_HIRING_E2E_JOB_PRESENT_COUNT=/)
  assert.match(remote, /information_schema\.columns/i)
  assert.match(remote, /pg_get_constraintdef/i)
})

test('database audit proves admin grant, approval, published job ownership and unauthorized denial', () => {
  const remote = readFileSync(remoteScriptPath, 'utf8')

  assert.match(remote, /admin-confirm-sign-up/)
  assert.match(remote, /insert into public\.user_roles/i)
  assert.match(remote, /administrator/i)
  assert.match(remote, /organization_applications/i)
  assert.match(remote, /company_members/i)
  assert.match(remote, /is_verified/i)
  assert.match(remote, /approved_at/i)
  assert.match(remote, /public\.jobs/i)
  assert.match(remote, /status::text = 'published'/i)
  assert.match(remote, /ORGANIZATION_HIRING_E2E_APPROVAL_VERIFIED=true/)
  assert.match(remote, /ORGANIZATION_HIRING_E2E_JOB_VERIFIED=true/)
  assert.match(remote, /job_applications/i)
  assert.match(remote, /job_application_events/i)
  assert.match(remote, /ORGANIZATION_HIRING_E2E_JOB_APPLICATION_VERIFIED=true/)
  assert.match(remote, /ORGANIZATION_HIRING_E2E_UNAUTHORIZED_VERIFIED=true/)
  assert.match(remote, /entitlement_grants WHERE profile_id=\(\$unauthorized_id_sql\)/)
  assert.match(remote, /\[\[ "\$MEMBER_COUNT" == 0 && "\$ADMIN_COUNT" == 0 && "\$GRANT_COUNT" == 0 \]\]/)
})

test('cleanup is unconditional, prefix constrained, and removes every disposable hiring artifact', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remoteScriptPath, 'utf8')

  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(remote, /delete from public\.jobs/i)
  assert.match(remote, /delete from public\.audit_events/i)
  assert.match(remote, /delete from public\.organization_applications/i)
  assert.match(remote, /delete from public\.company_access_requests/i)
  assert.match(remote, /delete from public\.company_members/i)
  assert.match(remote, /delete from public\.companies/i)
  assert.match(remote, /delete from public\.entitlement_grants/i)
  assert.match(remote, /RUN_ID="\$\{ORGANIZATION_NAME##\* \}"/)
  assert.match(remote, /\[\[ "\$RUN_ID" =~ \^\[0-9\]\+\$ && "\$JOB_TITLE" == "E2E Chief Officer \$RUN_ID" \]\]/)
  assert.match(remote, /entitlement_grants WHERE reason LIKE 'Disposable staging hiring E2E \$RUN_ID:%'/)
  assert.ok(remote.indexOf('DELETE FROM public.entitlement_grants') < remote.indexOf('DELETE FROM public.companies'), 'grants are removed before their company')
  assert.match(remote, /delete from public\.user_roles/i)
  assert.match(remote, /delete from public\.profiles/i)
  assert.match(remote, /admin-delete-user/)
  assert.match(remote, /sea-n-shore-hiring-e2e-/)
  assert.match(remote, /ORGANIZATION_HIRING_E2E_CLEANUP_VERIFIED=true/)
  assert.match(remote, /company_access_requests where user_id in/i)
  assert.doesNotMatch(remote, /company_access_requests where requested_by/i)
})


test('organization hiring e2e uses current onboarding username controls before candidate application', () => {
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  assert.match(browserScript, /input\[name="slug"\]/)
  assert.doesNotMatch(browserScript, /Profile address/)
})


test('organization hiring remote shell is syntax-valid and cleanup is defined once', () => {
  const syntax = spawnSync('bash', ['-n', remoteScriptPath], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout)
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.equal((workflow.match(/Cleanup every disposable organization hiring artifact/g) ?? []).length, 1)
  assert.equal((workflow.match(/Verify unauthorized identity has no hiring authority through SSM/g) ?? []).length, 1)
})
