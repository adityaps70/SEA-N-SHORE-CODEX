import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Cognito custom domain auth.seanshore.in has a guarded create-only release path', async () => {
  const scriptUrl = new URL('./cognito-custom-domain-infra.sh', import.meta.url)
  const actionUrl = new URL('./cognito-custom-domain-infra-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-cognito-custom-domain-infra.yml', import.meta.url)
  const terraformUrl = new URL('../../infra/aws/app/cognito_custom_domain.tf', import.meta.url)

  for (const url of [scriptUrl, actionUrl, workflowUrl, terraformUrl]) assert.equal(existsSync(url), true)
  assert.ok(['plan', 'apply-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const terraform = await readFile(terraformUrl, 'utf8')
  assert.match(terraform, /cognito_custom_auth_domain = "auth\.seanshore\.in"/)
  assert.match(terraform, /resource "aws_acm_certificate" "cognito_auth" \{\s+provider\s+= aws\.us_east_1/)
  assert.match(terraform, /validation_method = "DNS"/)
  assert.match(terraform, /resource "aws_acm_certificate_validation" "cognito_auth" \{\s+provider\s+= aws\.us_east_1/)
  assert.match(terraform, /zone_id = aws_route53_zone\.seanshore\.zone_id/)
  assert.match(terraform, /certificate_arn = aws_acm_certificate_validation\.cognito_auth\.certificate_arn/)
  assert.match(terraform, /user_pool_id\s+= aws_cognito_user_pool\.app\.id/)
  assert.match(terraform, /aws_cognito_user_pool_domain\.custom\.cloudfront_distribution_zone_id/)
  assert.match(terraform, /type\s+= "A"\n/)
  assert.match(terraform, /type\s+= "AAAA"\n/)

  // The prefix domain stays and the running app keeps it until the domain switch is released.
  const auth = await readFile(new URL('../../infra/aws/app/auth.tf', import.meta.url), 'utf8')
  assert.match(auth, /resource "aws_cognito_user_pool_domain" "app"/)

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /COGNITO_CUSTOM_DOMAIN_EXPECTED_SHA/)
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /if actions != \['create'\]:/)
  assert.match(script, /unexpected Cognito custom domain change/)
  for (const target of [
    'aws_acm_certificate.cognito_auth',
    'aws_route53_record.cognito_auth_validation',
    'aws_acm_certificate_validation.cognito_auth',
    'aws_cognito_user_pool_domain.custom',
    'aws_route53_record.cognito_auth_a',
    'aws_route53_record.cognito_auth_aaaa',
  ]) assert.ok(script.includes(`  ${target}\n`), `missing target ${target}`)
  assert.match(script, /COGNITO_CUSTOM_DOMAIN_PLAN_VERIFIED=true/)
  assert.match(script, /COGNITO_CUSTOM_DOMAIN_PLAN_ONLY_NO_APPLY/)
  assert.match(script, /COGNITO_CUSTOM_DOMAIN_CERTIFICATE_ISSUED=true/)
  assert.match(script, /COGNITO_PREFIX_DOMAIN_KEPT=true/)
  assert.match(script, /COGNITO_CUSTOM_DOMAIN_ALIAS_RECORDS_VERIFIED=true/)
  assert.match(script, /COGNITO_CUSTOM_DOMAIN_APPLY_VERIFIED=true/)
  assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(script, /get-bucket-versioning/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.doesNotMatch(script, /aws ecs (update-service|register-task-definition)/)
  assert.doesNotMatch(script, /AWS_COGNITO_DOMAIN/)
  assert.doesNotMatch(script, /delete-user-pool-domain|terraform[^\n]+destroy/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Cognito Custom Domain Infrastructure/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /COGNITO_CUSTOM_DOMAIN_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/cognito-custom-domain-infra\.sh/)
  assert.doesNotMatch(workflow, /infra\/aws\/app\/auth\.tf/)
})
