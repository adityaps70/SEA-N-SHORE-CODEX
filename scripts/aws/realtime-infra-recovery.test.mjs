import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const runner = await readFile(resolve(process.cwd(), 'scripts/aws/realtime-infra.sh'), 'utf8')
const terraform = await readFile(resolve(process.cwd(), 'infra/aws/app/realtime.tf'), 'utf8')
const classifier = await import(pathToFileURL(resolve(process.cwd(), 'scripts/aws/realtime-infra-plan-classifier.mjs')).href)

describe('realtime infrastructure partial-apply recovery', () => {
  it('derives current web inputs from the live ECS service task definition', () => {
    expect(runner).toMatch(/aws ecs describe-task-definition[\s\S]*--task-definition "\$SERVICE_TASK_BEFORE"[\s\S]*service-task-before\.json/)
    expect(runner).toMatch(/python3 - "\$WORK_DIR\/state\.json" "\$WORK_DIR\/service-task-before\.json" "\$WORK_DIR\/variables\.json"/)
    expect(runner).not.toMatch(/web_task\s*=\s*attrs\('aws_ecs_task_definition',\s*'web'\)/)
  })

  it('surfaces the residual non-no-op plan before the fail-closed classifier runs', () => {
    const diagnostic = `jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]' "$WORK_DIR/plan.json"`
    const diagnosticIndex = runner.indexOf(diagnostic)
    const classifierIndex = runner.indexOf('CLASSIFICATION="$(node "$PLAN_CLASSIFIER" "$WORK_DIR/plan.json" "$ACTION")"')

    expect(diagnosticIndex).toBeGreaterThan(-1)
    expect(classifierIndex).toBeGreaterThan(-1)
    expect(diagnosticIndex).toBeLessThan(classifierIndex)
  })

  it('configures the regional API Gateway CloudWatch role required by access logging', () => {
    expect(terraform).toMatch(/resource "aws_iam_role" "realtime_api_gateway_logs"/)
    expect(terraform).toMatch(/Service\s*=\s*"apigateway\.amazonaws\.com"/)
    expect(terraform).toMatch(/resource "aws_iam_role_policy_attachment" "realtime_api_gateway_logs"[\s\S]*AmazonAPIGatewayPushToCloudWatchLogs/)
    expect(terraform).toMatch(/resource "aws_api_gateway_account" "realtime"[\s\S]*cloudwatch_role_arn\s*=\s*aws_iam_role\.realtime_api_gateway_logs\.arn/)
    expect(terraform).toMatch(/resource "aws_apigatewayv2_stage" "realtime"[\s\S]*depends_on\s*=\s*\[[\s\S]*aws_api_gateway_account\.realtime[\s\S]*\]/)
  })

  it('accepts only the observed bounded recovery signature plus logging prerequisites', () => {
    const recoveryPlan = {
      resource_changes: [
        ['aws_apigatewayv2_stage.realtime', ['create']],
        ['aws_ecs_task_definition.web', ['create']],
        ['aws_iam_role_policy.realtime_fanout', ['create']],
        ['aws_lambda_event_source_mapping.realtime_events', ['create']],
        ['aws_lambda_function.realtime_authorizer', ['update']],
        ['aws_lambda_function.realtime_fanout', ['create']],
        ['aws_iam_role.realtime_api_gateway_logs', ['create']],
        ['aws_iam_role_policy_attachment.realtime_api_gateway_logs', ['create']],
        ['aws_api_gateway_account.realtime', ['create']],
      ].map(([address, actions]) => ({ address, mode: 'managed', change: { actions } })),
    }

    expect(classifier.classifyRealtimeInfraPlan(recoveryPlan, 'plan')).toEqual({
      mode: 'recovery',
      createCount: 8,
      updateCount: 1,
      replaceCount: 0,
    })
    expect(classifier.classifyRealtimeInfraPlan(recoveryPlan, 'apply-once')).toEqual({
      mode: 'recovery',
      createCount: 8,
      updateCount: 1,
      replaceCount: 0,
    })

    expect(() => classifier.classifyRealtimeInfraPlan({
      resource_changes: recoveryPlan.resource_changes.slice(0, -1),
    }, 'apply-once')).toThrow()
  })
})
