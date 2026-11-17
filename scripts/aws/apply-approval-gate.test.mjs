import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

// Round 16 (E): every guarded run that changes AWS waits for the owner's approval in the
// 'staging-apply' environment; plans never wait. The AWS job itself stays on 'staging'.
const dir = new URL('../../.github/workflows/', import.meta.url)
const workflows = readdirSync(dir).filter((name) => name.endsWith('.yml')).map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }))
const guarded = workflows.filter(({ text }) => /scripts\/aws\/[a-z0-9-]+-action\.txt/.test(text) && /^    environment: staging$/m.test(text))

// Owner choice (Round 16 follow-up, option 2): read-only and test-data runs never wait. Exactly these.
const TEST_DATA_GUARD_VALUES = {
  'aws-onboarding-e2e.yml': 'probe|run-once',
  'aws-organization-hiring-e2e.yml': 'run-once',
  'aws-learning-assignment-review-e2e.yml': 'run-once',
  'aws-hiring-create-job-probe.yml': 'probe-once',
  'aws-onboarding-e2e-stale-cleanup.yml': 'cleanup-once',
  'aws-admin-identity-audit.yml': 'audit-once',
  'aws-identity-cleanup.yml': 'accounts-once',
}
// E2E suites whose every AWS job only creates and removes disposable test users: no approval job at all.
const TEST_DATA_WORKFLOWS = ['aws-events-e2e.yml', 'aws-realtime-e2e.yml']

test('every guarded workflow that reaches AWS has a staging-apply approval job', () => {
  assert.ok(guarded.length >= 36, `expected the guarded runners, found ${guarded.length}`)
  for (const { name, text } of guarded) {
    if (TEST_DATA_WORKFLOWS.includes(name)) continue
    assert.match(text, /^  apply-approval:\n(?:    .*\n)*?    environment: staging-apply\n/m, `${name} needs an apply-approval job in staging-apply`)
    assert.doesNotMatch(text, /^    environment: staging-apply\n(?:    .*\n)*?    steps:\n(?:      .*\n|\n)*?.*aws-actions\/configure-aws-credentials/m, `${name}: the approval job must not touch AWS`)
    // Each job on 'staging' waits for the approval (directly or through its guard's outputs).
    const jobs = text.split(/^(?=  [A-Za-z0-9_-]+:\n)/m).filter((block) => /^    environment: staging$/m.test(block))
    for (const job of jobs) {
      assert.match(job, /^      - apply-approval$/m, `${name}: ${job.split('\n')[0].trim()} must need apply-approval`)
      assert.match(job, /needs\.apply-approval\.result == 'success'/, `${name}: ${job.split('\n')[0].trim()} must check the approval`)
    }
  }
})

test('the approval is asked only when the guard value is not a plan', () => {
  for (const { name, text } of guarded) {
    if (!text.includes('apply-gate:')) continue
    const values = ['plan', 'discover', ...(TEST_DATA_GUARD_VALUES[name] ? TEST_DATA_GUARD_VALUES[name].split('|') : [])].join('\\|')
    assert.match(text, new RegExp(`case "\\$ACTION" in\\n(?:\\s+#.*\\n)?\\s+${values}\\) echo "approval=false" >> "\\$GITHUB_OUTPUT" ;;\\n\\s+\\*\\) echo "approval=true" >> "\\$GITHUB_OUTPUT" ;;`), `${name}: only plans${TEST_DATA_GUARD_VALUES[name] ? ' and its test-data runs' : ''} skip the approval`)
    assert.match(text, /if: needs\.apply-gate\.outputs\.approval == 'true'\n\s+runs-on: \$\{\{ vars\.GATE_RUNNER \|\| 'ubuntu-latest' \}\}\n\s+environment: staging-apply/, name)
    assert.match(text, /needs\.apply-approval\.result == 'success' \|\| needs\.apply-approval\.result == 'skipped'/, `${name}: a plan (approval skipped) must still run`)
  }
})

test('applies, migrations and deploys always wait; only the pinned test-data runs and suites skip', () => {
  for (const extra of Object.values(TEST_DATA_GUARD_VALUES)) {
    assert.doesNotMatch(extra, /apply|migrate|deploy|repair|swap|grow|unlock/, `${extra} is not a test-data value`)
  }
  for (const name of TEST_DATA_WORKFLOWS) {
    const { text } = workflows.find((w) => w.name === name)
    assert.doesNotMatch(text, /staging-apply/, `${name} has no approval job`)
    assert.match(text, /sea-n-shore-(events|realtime)-e2e-\$\{GITHUB_RUN_ID\}-/, `${name} only uses disposable E2E users`)
  }
  const byFile = Object.fromEntries(workflows.map(({ name, text }) => [name, text]))
  assert.match(byFile['aws-identity-cleanup.yml'], /plan\|discover\|accounts-once\) echo "approval=false"/, 'identity cleanup run-once (real profile rows) still waits')
})

test('deploys and the one-shot launch wait for the approval; the read-only probes do not', () => {
  const byName = Object.fromEntries(workflows.map(({ name, text }) => [name, text]))
  assert.match(byName['aws-staging-deploy.yml'], /apply-approval:\n    needs: gate\n    if: needs\.gate\.outputs\.deploy_to_ecs == 'true'/)
  assert.match(byName['aws-staging-deploy.yml'], /needs\.apply-approval\.result == 'skipped' && needs\.gate\.outputs\.deploy_to_ecs != 'true'/)
  assert.match(byName['aws-membership-launch-sequence.yml'], /apply-approval:\n    needs: preflight\n    if: inputs\.mode == 'execute'/)
  for (const probe of ['aws-remote-verify.yml', 'aws-google-auth-live-verify.yml', 'aws-logo-browser-verify.yml', 'aws-infra-ci.yml', 'ci.yml']) {
    assert.doesNotMatch(byName[probe], /environment: staging-apply/, `${probe} never waits for approval`)
  }
})
