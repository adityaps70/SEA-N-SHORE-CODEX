import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const workflowPath = '.github/workflows/aws-staging-deploy.yml'
const actionPath = 'scripts/aws/staging-deploy-action.txt'

test('staging deploy supports an explicit exact-head push trigger without weakening manual dispatch', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const action = guardAction(readFileSync(actionPath, 'utf8'))

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

test('staging deploy builds with the exact canonical and CloudFront Server Action origins and the repository site URL', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const siteUrl = readFileSync('scripts/aws/public-site-url.txt', 'utf8').trim()

  // Domain move: exactly the repository site URL plus the distribution's own cloudfront.net name, no literal domain.
  assert.match(workflow, /^      EDGE_SITE_ORIGIN: https:\/\/d3prih0q6jofyr\.cloudfront\.net$/m)
  assert.match(workflow, /echo "SERVER_ACTION_ALLOWED_ORIGINS=\$SITE,\$EDGE_SITE_ORIGIN" >> "\$GITHUB_ENV"/)
  assert.doesNotMatch(workflow, /SERVER_ACTION_ALLOWED_ORIGINS:\s*https?:/)
  assert.ok(workflow.indexOf('echo "SERVER_ACTION_ALLOWED_ORIGINS=') < workflow.indexOf('test -n "$SERVER_ACTION_ALLOWED_ORIGINS"'), 'origins are resolved before they are validated')
  assert.match(workflow, /--build-arg SERVER_ACTION_ALLOWED_ORIGINS="\$SERVER_ACTION_ALLOWED_ORIGINS"/)
  assert.match(workflow, /--build-arg NEXT_PUBLIC_SITE_URL="\$NEXT_PUBLIC_SITE_URL"/)
  assert.doesNotMatch(workflow, /SERVER_ACTION_ALLOWED_ORIGINS:\s*['"]?\*/)
  assert.doesNotMatch(workflow, /vars\.NEXT_PUBLIC_SITE_URL/)
  assert.match(workflow, /Resolve public site URL/)
  assert.match(workflow, /scripts\/aws\/public-site-url\.txt/)
  assert.match(workflow, /echo "NEXT_PUBLIC_SITE_URL=\$SITE" >> "\$GITHUB_ENV"/)
  assert.ok(['https://seanshore.in', 'https://d3prih0q6jofyr.cloudfront.net'].includes(siteUrl), `Unexpected public site URL: ${siteUrl}`)
})

test('staging deploy verifies exact completed service revision and its immutable task-definition image without ListTasks permission', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /Verify exact ECS deployment/)
  assert.match(workflow, /describe-services/)
  assert.doesNotMatch(workflow, /aws ecs list-tasks/)
  assert.doesNotMatch(workflow, /aws ecs describe-tasks/)
  assert.match(workflow, /aws ecs describe-task-definition/)
  assert.match(workflow, /NEW_TASK_ARN/)
  assert.match(workflow, /steps\.image\.outputs\.uri/)
  assert.match(workflow, /EXPECTED_IMAGE_URI/)
  assert.match(workflow, /DEPLOYMENT_COUNT/)
  assert.match(workflow, /PRIMARY_TASK_ARN/)
  assert.match(workflow, /PRIMARY_ROLLOUT_STATE/)
  assert.match(workflow, /COMPLETED/)
  assert.match(workflow, /failedTasks/)
  assert.match(workflow, /TASK_DEF_IMAGE/)
  assert.match(workflow, /desiredCount/)
  assert.match(workflow, /runningCount/)
})

test('staging web deployment verification supports the configured service scale instead of hardcoding one task', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /DESIRED_COUNT" -ge 1/)
  assert.match(workflow, /RUNNING_COUNT" -eq "\$DESIRED_COUNT"/)
  assert.match(workflow, /PRIMARY_DESIRED_COUNT" -eq "\$DESIRED_COUNT"/)
  assert.match(workflow, /PRIMARY_RUNNING_COUNT" -eq "\$DESIRED_COUNT"/)
})

test('staging deploy waits for ECS rolloutState COMPLETED before exact verification', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /for attempt in \$\(seq 1 30\)/)
  assert.match(workflow, /PRIMARY_ROLLOUT_STATE/)
  assert.match(workflow, /sleep 5/)
  assert.match(workflow, /Timed out waiting for exact ECS deployment completion/)
})

test('staging image verification uses docker push digest evidence without requiring ecr DescribeImages permission', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.doesNotMatch(workflow, /aws ecr describe-images/)
  assert.match(workflow, /PUSH_OUTPUT=.*docker push/)
  assert.match(workflow, /IMAGE_DIGEST/)
  assert.match(workflow, /sha256:\[0-9a-f\]\{64\}/)
  assert.match(workflow, /digest=\$IMAGE_DIGEST/)
})

test('one-shot staging deploy applies and verifies only the restricted browser PUT CORS rule on the media bucket', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /Apply restricted browser PUT CORS to media bucket/)
  assert.match(workflow, /aws s3api put-bucket-cors/)
  assert.match(workflow, /--bucket "\$AWS_MEDIA_BUCKET"/)
  assert.match(workflow, /"AllowedMethods":\["PUT"\]/)
  assert.match(workflow, /"AllowedOrigins":\(\$origins\|split\(","\)\)/)
  assert.match(workflow, /AllowedOrigins == \(\$origins\|split\(","\)\)/)
  assert.match(workflow, /"AllowedHeaders":\["Content-Type"\]/)
  assert.match(workflow, /"MaxAgeSeconds":300/)
  assert.match(workflow, /aws s3api get-bucket-cors/)
  assert.match(workflow, /MEDIA_CORS_VERIFIED=true/)
  assert.doesNotMatch(workflow, /"AllowedOrigins":\["\*"\]/)
  assert.doesNotMatch(workflow, /"AllowedHeaders":\["\*"\]/)
})



test('staging deploy promotes outbox and notification workers with the same immutable image', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /OUTBOX_WORKER_SERVICE:\s*sea-n-shore-staging-outbox-worker/)
  assert.match(workflow, /NOTIFICATION_WORKER_SERVICE:\s*sea-n-shore-staging-notification-worker/)
  assert.match(workflow, /OUTBOX_WORKER_TASK_DEFINITION:\s*sea-n-shore-staging-outbox-worker/)
  assert.match(workflow, /NOTIFICATION_WORKER_TASK_DEFINITION:\s*sea-n-shore-staging-notification-worker/)
  assert.match(workflow, /Promote event worker task definitions/)
  assert.match(workflow, /Deploy event workers and wait for stability/)
  assert.match(workflow, /Verify exact event worker deployments/)
  assert.match(workflow, /steps\.image\.outputs\.uri/)
  assert.match(workflow, /outbox-worker/)
  assert.match(workflow, /notification-worker/)
  assert.match(workflow, /WORKER_EXPECTED_IMAGE_URI/)
  assert.match(workflow, /rolloutState/)
  assert.match(workflow, /COMPLETED/)
  assert.match(workflow, /desiredCount/)
  assert.match(workflow, /runningCount/)
  assert.match(workflow, /pendingCount/)
})

test('staging deploy never shrinks the web task below 2048 MiB / 512 CPU (Round 13)', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /\| \.memory = \(if \(\(\.memory \/\/ "0"\) \| tonumber\) < 2048 then "2048" else \.memory end\)/)
  assert.match(workflow, /\| \.cpu = \(if \(\(\.cpu \/\/ "0"\) \| tonumber\) < 512 then "512" else \.cpu end\)/)
})

test('manual deploys ship only the live branch and a deployed SHA is never deployed twice (Round 14)', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const dispatch = workflow.slice(workflow.indexOf('if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]; then'))
  assert.match(dispatch.slice(0, 400), /\[\[ "\$GITHUB_REF" == "refs\/heads\/feat\/aws-native-phase-0-1" \]\] \|\| \{ echo "Manual deploys are allowed only from feat\/aws-native-phase-0-1\."/)
  assert.match(workflow, /- name: Refuse a commit that is already deployed/)
  assert.match(workflow, /if \[\[ "\$\{LIVE_IMAGE##\*:\}" == "\$\{GITHUB_SHA\}-"\* \]\]; then/)
  assert.ok(workflow.indexOf('Refuse a commit that is already deployed') < workflow.indexOf('Build and push immutable application image'))
})

test('staging deploy turns ECS Exec off on the web service and verifies it', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const step = workflow.slice(workflow.indexOf('- name: Deploy ECS service and wait for stability'), workflow.indexOf('- name: Promote event worker task definitions'))

  assert.match(step, /--service "\$ECS_SERVICE"[\s\S]*--disable-execute-command/)
  assert.doesNotMatch(workflow, /--enable-execute-command/)
  assert.match(step, /--query 'services\[0\]\.enableExecuteCommand' --output json/)
  assert.match(step, /\[\[ "\$EXEC_ENABLED" == "false" \]\]/)
  assert.match(step, /ECS_EXEC_DISABLED_VERIFIED=true/)
  assert.match(readFileSync('infra/aws/app/main.tf', 'utf8'), /enable_execute_command = false/)
})

test('Round 15: the web task drops the phone OTP settings and gets HEALTH_CHECK_TOKEN from Secrets Manager', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  // Phone/SMS sign-in is retired: no OTP table or calling-code settings are set any more, and the
  // copy of the live task definition strips any that are still there.
  assert.doesNotMatch(workflow, /OTP_LIMITS_TABLE:|ALLOWED_PHONE_CALLING_CODES:|--arg OTP_LIMITS_TABLE|--arg ALLOWED_PHONE_CALLING_CODES/)
  assert.doesNotMatch(workflow, /\{"name":"OTP_LIMITS_TABLE"|\{"name":"ALLOWED_PHONE_CALLING_CODES"/)
  assert.match(workflow, /and \.name != "OTP_LIMITS_TABLE"\n\s+and \.name != "ALLOWED_PHONE_CALLING_CODES"/)

  // The secret's ARN is resolved (never its value) before the build, and only for a real deploy.
  assert.match(workflow, /HEALTH_CHECK_TOKEN_SECRET_NAME: sea-n-shore-staging\/health-check-token\n/)
  const resolve = workflow.slice(workflow.indexOf('- name: Resolve health check token secret'), workflow.indexOf('- name: Login to Amazon ECR'))
  assert.match(resolve, /if: env\.DEPLOY_TO_ECS == 'true'/)
  assert.match(resolve, /aws secretsmanager describe-secret --secret-id "\$HEALTH_CHECK_TOKEN_SECRET_NAME" --query ARN --output text/)
  assert.match(resolve, /secret:sea-n-shore-staging\/health-check-token-\[A-Za-z0-9\]\{6\}\$/)
  assert.doesNotMatch(workflow, /get-secret-value|SecretString/)
  assert.ok(workflow.indexOf('- name: Resolve health check token secret') < workflow.indexOf('Build and push immutable application image'))

  // Web container only, same pattern as AURORA_USER / AURORA_PASSWORD.
  const web = workflow.slice(workflow.indexOf('- name: Create new ECS task definition revision'), workflow.indexOf('- name: Deploy ECS service and wait for stability'))
  assert.match(web, /--arg HEALTH_CHECK_TOKEN_SECRET "\$HEALTH_CHECK_TOKEN_SECRET_ARN"/)
  assert.match(web, /and \.name != "HEALTH_CHECK_TOKEN"/)
  assert.match(web, /\{"name":"AURORA_PASSWORD","valueFrom":\$AURORA_PASSWORD_SECRET\},\n\s+\{"name":"HEALTH_CHECK_TOKEN","valueFrom":\$HEALTH_CHECK_TOKEN_SECRET\}/)
  const workers = workflow.slice(workflow.indexOf('- name: Promote event worker task definitions'), workflow.indexOf('- name: Deploy event workers and wait for stability'))
  assert.doesNotMatch(workers, /HEALTH_CHECK_TOKEN/)
})

test('the job that waits for exact-head CI can read the Actions API (a job-level permissions block replaces the workflow one)', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  // Each job is a two-space-indented key under jobs:; find the one that runs the exact-head CI wait.
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n')).split(/\n(?=  [a-z0-9_-]+:\n)/)
  const waiting = jobs.filter((job) => job.includes('Wait for exact-head AWS Infrastructure CI'))
  assert.ok(waiting.length > 0, 'a job waits for exact-head AWS Infrastructure CI')
  for (const job of waiting) {
    const block = job.match(/\n    permissions:\n((?:      [a-z-]+: [a-z]+\n)+)/)
    if (block) assert.match(block[1], /actions: (read|write)/, 'a job-level permissions block must keep actions: read for the CI wait')
  }
})
