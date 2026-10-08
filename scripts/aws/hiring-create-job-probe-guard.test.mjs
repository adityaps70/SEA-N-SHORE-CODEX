import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const actionPath = 'scripts/aws/hiring-create-job-probe-action.txt'
const workflowPath = '.github/workflows/aws-hiring-create-job-probe.yml'
const wrapperPath = 'scripts/aws/hiring-create-job-probe.cjs'
const remotePath = 'scripts/aws/hiring-create-job-probe-remote.sh'

test('hiring create-job probe is exact-head, staging-only and one-shot guarded', () => {
  for (const path of [actionPath, workflowPath, wrapperPath, remotePath]) {
    assert.equal(existsSync(path), true, `${path} must exist`)
  }

  const action = guardAction(readFileSync(actionPath, 'utf8'))
  const workflow = readFileSync(workflowPath, 'utf8')
  const wrapper = readFileSync(wrapperPath, 'utf8')

  assert.ok(['plan', 'probe-once'].includes(action), `Unexpected hiring probe action: ${action}`)
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/hiring-create-job-probe-action\.txt/)
  assert.match(workflow, /probe-once/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard probe against a moved branch/)
  assert.match(workflow, /310356785722/)
  assert.doesNotMatch(workflow, /992382634586/)
  assert.match(wrapper, /ssm.*send-command/s)
  assert.doesNotMatch(wrapper, /ecs.*run-task/s)
})

// Rewritten in Round 15: e56de2c1 replaced the stage-by-stage insert probe with a parse-only
// probe (PREPARE the exact createJob INSERT, never EXECUTE it), so the old stage names
// (authorized_company, insert_job, certificate/visa requirements) no longer exist. The safety
// properties are unchanged and still required: a transaction, no writes, mandatory rollback,
// rollback verified afterwards, and a SQLSTATE report.
test('hiring create-job probe only parses the createJob INSERT and always rolls back', () => {
  const probe = readFileSync(remotePath, 'utf8')

  assert.match(probe, /BEGIN/)
  assert.match(probe, /aws rds-data begin-transaction/)
  assert.match(probe, /PREPARE hiring_create_job_parameter_probe AS\s+insert into public\.jobs \(/)
  assert.doesNotMatch(probe, /EXECUTE\s+hiring_create_job_parameter_probe/i)
  assert.doesNotMatch(probe, /insert into public\.job_certificate_requirements|insert into public\.job_visa_requirements/)
  assert.match(probe, /RETURNED_SQLSTATE/)
  assert.match(probe, /ROLLBACK/)
  assert.match(probe, /trap rollback_probe EXIT/)
  assert.match(probe, /aws rds-data rollback-transaction/)
  assert.doesNotMatch(probe, /commit-transaction/)
  assert.match(probe, /HIRING_CREATE_JOB_PROBE_PARAMETER_SQLSTATE=/)
  assert.match(probe, /HIRING_CREATE_JOB_PROBE_ERROR_MESSAGE=/)
  assert.match(probe, /HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=true/)
  assert.match(probe, /select count\(\*\)::text from public\.jobs where title='E2E Hiring Probe \$\{MARKER\}'/)
  assert.match(probe, /\[\[ "\$MARKER" =~ \^\[0-9\]\+\$ \]\]/)
})
