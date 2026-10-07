import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// Worker task-definition drift: Terraform never moves a worker service off the revision the deploy promoted, and the
// read-only drift plan can only plan.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const terraform = read('../../infra/aws/app/social-events.tf')
const script = read('./worker-drift-plan.sh')
const workflow = read('../../.github/workflows/aws-worker-drift-plan.yml')

const block = (kind, name) => {
  const start = terraform.indexOf(`resource "${kind}" "${name}" {`)
  assert.ok(start >= 0, `${kind}.${name}`)
  return terraform.slice(start, terraform.indexOf('\n}\n', start))
}

// Each service's platform_version matches what its live service records (worker drift plan run 37667793020):
// the outbox worker records 1.4.0, the notification worker records LATEST.
const LIVE_PLATFORM_VERSION = { outbox_worker: '1.4.0', notification_worker: 'LATEST' }

test('worker services ignore the task definition revision and match their live platform version', () => {
  for (const [name, version] of Object.entries(LIVE_PLATFORM_VERSION)) {
    const service = block('aws_ecs_service', name)
    assert.match(service, /lifecycle \{\n\s+ignore_changes = \[task_definition\]\n\s+\}/, name)
    assert.ok(service.includes(`platform_version = "${version}"`), name)
  }
})

test('the worker drift plan only plans the four worker resources and never applies', () => {
  assert.equal(guardAction(read('./worker-drift-plan-action.txt')), 'plan')
  assert.match(script, /\[\[ "\$ACTION" == "plan" \]\] \|\| \{ echo "The worker drift plan only plans\." >&2; exit 1; \}/)
  assert.doesNotMatch(script, /terraform[^\n]*\bapply\b|\bimport\b -|state rm|update-service|register-task-definition/)
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/plan\.log" -chdir="\$APP_DIR" plan /)
  assert.ok(script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh') < script.indexOf('terraform -chdir'))
  for (const target of ['aws_ecs_service.outbox_worker', 'aws_ecs_service.notification_worker', 'aws_ecs_task_definition.outbox_worker', 'aws_ecs_task_definition.notification_worker']) {
    assert.ok(script.includes(`  ${target}\n`), target)
  }
  assert.match(script, /WORKER_DRIFT_PLAN_ONLY_NO_APPLY/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/worker-drift-plan-action\.txt/)
  assert.match(workflow, /run: bash scripts\/aws\/arm-commit-guard\.sh/)
})
