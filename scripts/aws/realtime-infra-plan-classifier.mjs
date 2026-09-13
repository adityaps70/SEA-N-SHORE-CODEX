import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const REALTIME_INFRA_CREATE_RESOURCES = [
  'random_password.realtime_ticket',
  'aws_secretsmanager_secret.realtime_ticket',
  'aws_secretsmanager_secret_version.realtime_ticket',
  'aws_iam_role_policy.ecs_execution_realtime_ticket_secret',
  'aws_dynamodb_table.realtime_connections',
  'aws_sqs_queue.realtime_dlq',
  'aws_sqs_queue.realtime_events',
  'aws_cloudwatch_event_rule.realtime_events',
  'aws_cloudwatch_event_target.realtime_queue',
  'aws_sqs_queue_policy.realtime_events',
  'aws_iam_role.realtime_authorizer',
  'aws_iam_role.realtime_connection',
  'aws_iam_role.realtime_fanout',
  'aws_iam_role_policy_attachment.realtime_authorizer_logs',
  'aws_iam_role_policy_attachment.realtime_connection_logs',
  'aws_iam_role_policy_attachment.realtime_fanout_logs',
  'aws_iam_role_policy.realtime_authorizer',
  'aws_iam_role_policy.realtime_connection',
  'aws_iam_role_policy.realtime_fanout',
  'aws_cloudwatch_log_group.realtime_authorizer',
  'aws_cloudwatch_log_group.realtime_connection',
  'aws_cloudwatch_log_group.realtime_fanout',
  'aws_lambda_function.realtime_authorizer',
  'aws_lambda_function.realtime_connection',
  'aws_apigatewayv2_api.realtime',
  'aws_lambda_permission.realtime_authorizer_apigateway',
  'aws_apigatewayv2_authorizer.realtime_connect',
  'aws_apigatewayv2_integration.realtime_connection',
  'aws_apigatewayv2_route.realtime_connect',
  'aws_apigatewayv2_route.realtime_disconnect',
  'aws_apigatewayv2_route.realtime_default',
  'aws_lambda_permission.realtime_connection_apigateway',
  'aws_cloudwatch_log_group.realtime_api',
  'aws_apigatewayv2_stage.realtime',
  'aws_lambda_function.realtime_fanout',
  'aws_lambda_event_source_mapping.realtime_events',
  'aws_cloudwatch_metric_alarm.realtime_dlq_depth',
  'aws_cloudwatch_metric_alarm.realtime_queue_age',
]

export const REALTIME_WEB_TASK_RESOURCE = 'aws_ecs_task_definition.web'

const CREATE_RESOURCES = new Set(REALTIME_INFRA_CREATE_RESOURCES)
const REPLACEMENT_ACTIONS = new Set([
  JSON.stringify(['create', 'delete']),
  JSON.stringify(['delete', 'create']),
])

export function classifyRealtimeInfraPlan(plan, action) {
  if (!['plan', 'apply-once'].includes(action)) {
    throw new Error(`Unsupported realtime infrastructure action: ${action}`)
  }

  const changes = (plan.resource_changes ?? []).filter((resource) => {
    if (resource?.mode === 'data') return false
    return JSON.stringify(resource?.change?.actions ?? []) !== JSON.stringify(['no-op'])
  })

  if (changes.length === 0) {
    if (action === 'apply-once') {
      throw new Error('apply-once requires the initial realtime infrastructure plan')
    }
    return { mode: 'steady', createCount: 0, replaceCount: 0 }
  }

  let replaceCount = 0
  const created = new Set()

  for (const resource of changes) {
    const address = resource.address
    const actions = resource?.change?.actions ?? []
    const serializedActions = JSON.stringify(actions)

    if (CREATE_RESOURCES.has(address)) {
      if (serializedActions !== JSON.stringify(['create'])) {
        throw new Error(`Expected create-only realtime resource change: ${address} ${serializedActions}`)
      }
      created.add(address)
      continue
    }

    if (address === REALTIME_WEB_TASK_RESOURCE) {
      if (!REPLACEMENT_ACTIONS.has(serializedActions)) {
        throw new Error(`Expected web task definition replacement: ${address} ${serializedActions}`)
      }
      replaceCount += 1
      continue
    }

    throw new Error(`Unexpected actual change outside realtime allowlist: ${address} ${serializedActions}`)
  }

  const missingCreates = REALTIME_INFRA_CREATE_RESOURCES.filter((address) => !created.has(address))
  if (missingCreates.length > 0) {
    throw new Error(`Expected realtime create changes missing from plan: ${missingCreates.sort().join(', ')}`)
  }
  if (replaceCount !== 1) {
    throw new Error(`Expected exactly one web task definition replacement; found ${replaceCount}`)
  }

  return {
    mode: 'create',
    createCount: created.size,
    replaceCount,
  }
}

async function main() {
  const [planPath, action] = process.argv.slice(2)
  if (!planPath || !action) {
    throw new Error('Usage: node realtime-infra-plan-classifier.mjs <plan.json> <plan|apply-once>')
  }

  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  process.stdout.write(`${JSON.stringify(classifyRealtimeInfraPlan(plan, action))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
