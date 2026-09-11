import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const actionPath = 'scripts/aws/hiring-create-job-probe-action.txt'
const workflowPath = '.github/workflows/aws-hiring-create-job-probe.yml'
const wrapperPath = 'scripts/aws/hiring-create-job-probe.cjs'
const remotePath = 'scripts/aws/hiring-create-job-probe-remote.sh'

describe('staging create-job diagnostic probe contract', () => {
  it('is branch-scoped, staging-only, one-shot guarded and uses the approved SSM path', () => {
    for (const path of [actionPath, workflowPath, wrapperPath, remotePath]) {
      expect(existsSync(path)).toBe(true)
    }

    const action = readFileSync(actionPath, 'utf8').trim()
    const workflow = readFileSync(workflowPath, 'utf8')
    const wrapper = readFileSync(wrapperPath, 'utf8')

    expect(['plan', 'probe-once']).toContain(action)
    expect(workflow).toMatch(/feat\/aws-native-phase-0-1/)
    expect(workflow).toMatch(/scripts\/aws\/hiring-create-job-probe-action\.txt/)
    expect(workflow).toMatch(/probe-once/)
    expect(workflow).toMatch(/environment:\s*staging/)
    expect(workflow).toMatch(/Wait for exact-head AWS Infrastructure CI/)
    expect(workflow).toMatch(/Guard probe against a moved branch/)
    expect(workflow).toMatch(/310356785722/)
    expect(workflow).not.toMatch(/992382634586/)
    expect(wrapper).toMatch(/ssm[\s\S]*send-command/)
    expect(wrapper).not.toMatch(/ecs[\s\S]*run-task/)
  })

  it('proves createJob parameter inference with PREPARE only and never executes or commits the statement', () => {
    const probe = readFileSync(remotePath, 'utf8')

    expect(probe).toMatch(/BEGIN/)
    expect(probe).toMatch(/PREPARE\s+hiring_create_job_parameter_probe/i)
    expect(probe).toMatch(/insert into public\.jobs/i)
    expect(probe).toMatch(/\$10/)
    expect(probe).toMatch(/case when \$10 = 'published' then now\(\) else null end/i)
    expect(probe).toMatch(/42P08/)
    expect(probe).toMatch(/HIRING_CREATE_JOB_PROBE_PARAMETER_SQLSTATE=/)
    expect(probe).toMatch(/RETURNED_SQLSTATE/)
    expect(probe).toMatch(/ROLLBACK/)
    expect(probe).not.toMatch(/commit-transaction/)
    expect(probe).not.toMatch(/EXECUTE\s+hiring_create_job_parameter_probe/i)
    expect(probe).toMatch(/HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=true/)
  })
})
