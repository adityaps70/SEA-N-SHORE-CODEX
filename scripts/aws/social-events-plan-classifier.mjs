import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const SOCIAL_EVENT_RESOURCES = new Set([
  'aws_cloudwatch_event_bus.social',
  'aws_sqs_queue.notification_dlq',
  'aws_sqs_queue.notification_events',
  'aws_cloudwatch_event_rule.notification_events',
  'aws_cloudwatch_event_target.notification_queue',
  'aws_sqs_queue_policy.notification_events',
  'aws_iam_role.outbox_worker',
  'aws_iam_role_policy.outbox_worker',
  'aws_iam_role.notification_worker',
  'aws_iam_role_policy.notification_worker',
  'aws_cloudwatch_log_group.outbox_worker',
  'aws_cloudwatch_log_group.notification_worker',
  'aws_ecs_task_definition.outbox_worker',
  'aws_ecs_task_definition.notification_worker',
  'aws_ecs_service.outbox_worker',
  'aws_ecs_service.notification_worker',
  'aws_cloudwatch_metric_alarm.notification_dlq_depth',
  'aws_cloudwatch_metric_alarm.notification_queue_age',
])

export function classifySocialEventsPlan(plan, action) {
  if (!['plan', 'apply-once'].includes(action)) {
    throw new Error(`Unsupported social event infrastructure action: ${action}`)
  }

  const changes = (plan.resource_changes ?? []).filter(
    (resource) => JSON.stringify(resource?.change?.actions ?? []) !== JSON.stringify(['no-op']),
  )

  if (changes.length === 0) {
    if (action === 'apply-once') {
      throw new Error('apply-once requires an actual create-only plan')
    }
    return { mode: 'steady', createCount: 0 }
  }

  for (const resource of changes) {
    const address = resource.address
    const actions = resource?.change?.actions ?? []
    if (!SOCIAL_EVENT_RESOURCES.has(address)) {
      throw new Error(`Unexpected actual change outside social event allowlist: ${address} ${JSON.stringify(actions)}`)
    }
    if (JSON.stringify(actions) !== JSON.stringify(['create'])) {
      throw new Error(`Expected create-only social event change: ${address} ${JSON.stringify(actions)}`)
    }
  }

  const addresses = new Set(changes.map((resource) => resource.address))
  const missing = [...SOCIAL_EVENT_RESOURCES].filter((address) => !addresses.has(address))
  if (missing.length > 0) {
    throw new Error(`Expected create changes missing from plan: ${missing.sort().join(', ')}`)
  }

  return { mode: 'create', createCount: changes.length }
}

async function main() {
  const [planPath, action] = process.argv.slice(2)
  if (!planPath || !action) {
    throw new Error('Usage: node social-events-plan-classifier.mjs <plan.json> <plan|apply-once>')
  }
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  process.stdout.write(`${JSON.stringify(classifySocialEventsPlan(plan, action))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
