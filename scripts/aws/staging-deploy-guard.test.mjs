import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-staging-deploy.yml'
const actionPath = 'scripts/aws/staging-deploy-action.txt'

test('staging deploy supports an explicit exact-head push trigger without weakening manual dispatch', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()

  assert.ok(['plan', 'deploy-once'].includes(action), `Unexpected staging deploy action: ${action}`)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/staging-deploy-action\.txt/)
  assert.match(workflow, /scripts\/aws\/staging-deploy-guard\.test\.mjs/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /STAGING_DEPLOY_ACTION/)
  assert.match(workflow, /deploy-once/)
  assert.match(workflow, /DEPLOY_TO_ECS/)
  assert.match(workflow, /IMAGE_TAG="\$\{GITHUB_SHA\}-\$\{GITHUB_RUN_ID\}"/)
})

test('staging deploy verifies the exact task revision and immutable image after ECS stabilizes', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /Verify exact ECS deployment/)
  assert.match(workflow, /describe-services/)
  assert.match(workflow, /list-tasks/)
  assert.match(workflow, /describe-tasks/)
  assert.match(workflow, /NEW_TASK_ARN/)
  assert.match(workflow, /steps\.image\.outputs\.uri/)
  assert.match(workflow, /EXPECTED_IMAGE_URI/)
  assert.match(workflow, /desiredCount/)
  assert.match(workflow, /runningCount/)
})

test('staging image verification uses docker push digest evidence without requiring ecr DescribeImages permission', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.doesNotMatch(workflow, /aws ecr describe-images/)
  assert.match(workflow, /PUSH_OUTPUT=.*docker push/)
  assert.match(workflow, /IMAGE_DIGEST/)
  assert.match(workflow, /sha256:\[0-9a-f\]\{64\}/)
  assert.match(workflow, /digest=\$IMAGE_DIGEST/)
})
