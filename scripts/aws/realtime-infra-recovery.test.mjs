import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runner = await readFile(resolve(process.cwd(), 'scripts/aws/realtime-infra.sh'), 'utf8')

describe('realtime infrastructure partial-apply recovery', () => {
  it('derives current web inputs from the live ECS service task definition', () => {
    expect(runner).toMatch(/aws ecs describe-task-definition[\s\S]*--task-definition "\$SERVICE_TASK_BEFORE"[\s\S]*service-task-before\.json/)
    expect(runner).toMatch(/python3 - "\$WORK_DIR\/state\.json" "\$WORK_DIR\/service-task-before\.json" "\$WORK_DIR\/variables\.json"/)
    expect(runner).not.toMatch(/web_task\s*=\s*attrs\('aws_ecs_task_definition',\s*'web'\)/)
  })
})
