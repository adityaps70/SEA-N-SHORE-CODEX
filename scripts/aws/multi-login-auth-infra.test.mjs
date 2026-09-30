import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('multi-login Cognito infrastructure has a guarded bounded release path', async () => {
  const scriptUrl = new URL('./multi-login-auth-infra.sh', import.meta.url)
  const actionUrl = new URL('./multi-login-auth-infra-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-multi-login-auth-infra.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)
  assert.ok(['plan', 'apply-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /PUBLIC_SITE_URL="\$\(tr -d '\[:space:\]' < scripts\/aws\/public-site-url\.txt\)"/)
  assert.match(script, /scripts\/aws\/public-site-url\.txt \\/)

  const auth = await readFile(new URL('../../infra/aws/app/auth.tf', import.meta.url), 'utf8')
  assert.match(auth, /callback_urls = \[for origin in local\.browser_site_urls : "\$\{origin\}\/auth\/google\/callback"\]/)
  assert.match(auth, /logout_urls\s*=\s*local\.browser_site_urls/)
  assert.match(script, /MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA/)
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /aws_cognito_user_pool\.app/)
  assert.match(script, /aws_cognito_user_pool_client\.web/)
  assert.match(script, /aws_lambda_function\.cognito_define_auth_challenge/)
  assert.match(script, /aws_lambda_function\.cognito_create_auth_challenge/)
  assert.match(script, /aws_lambda_function\.cognito_verify_auth_challenge/)
  assert.match(script, /aws_cognito_identity_provider\.google/)
  assert.match(script, /aws_ecs_task_definition\.web/)
  assert.match(script, /aws ecs update-service/)
  assert.match(script, /AWS_COGNITO_GOOGLE_ENABLED/)
  assert.match(script, /GOOGLE_RUNTIME_VERIFIED=true/)
  assert.match(script, /Continue with Google/)
  assert.match(script, /GOOGLE_OAUTH_CREDENTIALS_READY/)
  assert.match(script, /MULTI_LOGIN_AUTH_INFRA_PLAN_VERIFIED=true/)
  assert.match(script, /MULTI_LOGIN_AUTH_INFRA_APPLY_VERIFIED=true/)
  assert.match(script, /COGNITO_CLIENT_SITE_URLS_VERIFIED=true/)
  assert.match(script, /\.UserPoolClient\.CallbackURLs \| index\(\$site \+ "\/auth\/google\/callback"\)/)
  assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.doesNotMatch(script, /terraform[^\n]+-auto-approve/)
  assert.doesNotMatch(script, /aws\s+cognito-idp\s+(create|update|delete)-user-pool/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Multi Login Auth Infrastructure/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/multi-login-auth-infra\.sh/)
})
