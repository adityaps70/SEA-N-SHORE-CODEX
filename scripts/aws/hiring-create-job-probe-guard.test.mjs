import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const actionPath = 'scripts/aws/hiring-create-job-probe-action.txt'
const workflowPath = '.github/workflows/aws-hiring-create-job-probe.yml'
const wrapperPath = 'scripts/aws/hiring-create-job-probe.cjs'
const remotePath = 'scripts/aws/hiring-create-job-probe-remote.sh'

test('hiring create-job probe is exact-head, staging-only and one-shot guarded', () => {
  for (const path of [actionPath, workflowPath, wrapperPath, remotePath]) {
    assert.equal(existsSync(path), true, `${path} must exist`)
  }

  const action = readFileSync(actionPath, 'utf8').trim()
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

test('hiring create-job probe exercises each repository SQL stage and always rolls back', () => {
  const probe = readFileSync(remotePath, 'utf8')

  assert.match(probe, /BEGIN/)
  assert.match(probe, /authorized_company/)
  assert.match(probe, /insert_job/)
  assert.match(probe, /insert_certificate_requirement/)
  assert.match(probe, /insert_visa_requirement/)
  assert.match(probe, /RETURNED_SQLSTATE/)
  assert.match(probe, /ROLLBACK/)
  assert.doesNotMatch(probe, /commit-transaction/)
  assert.match(probe, /HIRING_CREATE_JOB_PROBE_FAILED_STAGE=/)
  assert.match(probe, /HIRING_CREATE_JOB_PROBE_ERROR_CODE=/)
  assert.match(probe, /HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=true/)
  assert.match(probe, /public\.jobs/)
  assert.match(probe, /public\.job_certificate_requirements/)
  assert.match(probe, /public\.job_visa_requirements/)
})
