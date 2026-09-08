import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/aws-remote-verify.yml', 'utf8')
const stagingDeployWorkflow = readFileSync('.github/workflows/aws-staging-deploy.yml', 'utf8')

test('CloudWatch runtime review starts from the live PRIMARY deployment instead of a fixed historical window', () => {
  assert.match(workflow, /PRIMARY_DEPLOYMENT_CREATED_AT/)
  assert.match(workflow, /select\(\.status == "PRIMARY"\)/)
  assert.match(workflow, /date -d "\$PRIMARY_DEPLOYMENT_CREATED_AT" \+%s/)
  assert.match(workflow, /START_MS=.*PRIMARY_DEPLOYMENT_START_SECONDS/)
  assert.doesNotMatch(workflow, /date \+%s\) - 7200/)
})

test('remote logo verification follows the compact header asset used by Wordmark', () => {
  assert.match(workflow, /ASSET_PATH="\/brand\/sea-and-shore-header-logo\.svg"/)
  assert.doesNotMatch(workflow, /sea-n-shore-compact-lockup\.webp/)
  assert.match(workflow, /test "\$content_type" = "image\/svg\+xml"/)
})

test('staging deployment verification polls until ECS reports rolloutState COMPLETED', () => {
  assert.match(stagingDeployWorkflow, /for attempt in \$\(seq 1 30\)/)
  assert.match(stagingDeployWorkflow, /sleep 5/)
  assert.match(stagingDeployWorkflow, /Timed out waiting for exact ECS deployment completion/)
})
