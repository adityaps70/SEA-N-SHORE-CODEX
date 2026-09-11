import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const actionPath = 'scripts/aws/hiring-create-job-probe-action.txt'
const workflowPath = '.github/workflows/aws-hiring-create-job-probe.yml'
const probePath = 'scripts/aws/hiring-create-job-probe.cjs'

describe('staging create-job diagnostic probe contract', () => {
  it('is branch-scoped, staging-only and one-shot guarded', () => {
    expect(existsSync(actionPath)).toBe(true)
    expect(existsSync(workflowPath)).toBe(true)
    expect(existsSync(probePath)).toBe(true)

    const action = readFileSync(actionPath, 'utf8').trim()
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(['plan', 'probe-once']).toContain(action)
    expect(workflow).toMatch(/feat\/aws-native-phase-0-1/)
    expect(workflow).toMatch(/scripts\/aws\/hiring-create-job-probe-action\.txt/)
    expect(workflow).toMatch(/probe-once/)
    expect(workflow).toMatch(/environment:\s*staging/)
    expect(workflow).toMatch(/Wait for exact-head AWS Infrastructure CI/)
    expect(workflow).toMatch(/Guard probe against a moved branch/)
    expect(workflow).toMatch(/310356785722/)
    expect(workflow).not.toMatch(/992382634586/)
  })

  it('exercises each createJob SQL stage and always rolls the transaction back', () => {
    const probe = readFileSync(probePath, 'utf8')

    expect(probe).toMatch(/BEGIN/)
    expect(probe).toMatch(/authorized_company/)
    expect(probe).toMatch(/insert_job/)
    expect(probe).toMatch(/insert_certificate_requirement/)
    expect(probe).toMatch(/insert_visa_requirement/)
    expect(probe).toMatch(/ROLLBACK/)
    expect(probe).not.toMatch(/client\.query\(['"]COMMIT['"]\)/)
    expect(probe).toMatch(/HIRING_CREATE_JOB_PROBE_FAILED_STAGE=/)
    expect(probe).toMatch(/HIRING_CREATE_JOB_PROBE_ERROR_CODE=/)
    expect(probe).toMatch(/HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=true/)
    expect(probe).toMatch(/public\.jobs/)
    expect(probe).toMatch(/public\.job_certificate_requirements/)
    expect(probe).toMatch(/public\.job_visa_requirements/)
  })
})
