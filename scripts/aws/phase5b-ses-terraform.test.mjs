import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = new URL('../../', import.meta.url)
const emailTf = fs.readFileSync(new URL('infra/aws/app/email.tf', repoRoot), 'utf8')
const varsTf = fs.readFileSync(new URL('infra/aws/app/aws-native-variables.tf', repoRoot), 'utf8')
const tfvarsExample = fs.readFileSync(new URL('infra/aws/app/terraform.tfvars.example', repoRoot), 'utf8')

test('Phase 5B defines the approved SES domain identity with 2048-bit Easy DKIM', () => {
  assert.match(emailTf, /resource "aws_sesv2_email_identity" "transactional_domain"/)
  assert.match(emailTf, /email_identity\s*=\s*var\.ses_domain/)
  assert.match(emailTf, /configuration_set_name\s*=\s*aws_sesv2_configuration_set\.transactional\.configuration_set_name/)
  assert.match(emailTf, /next_signing_key_length\s*=\s*"RSA_2048_BIT"/)
})

test('Phase 5B grants only Cognito-scoped SES sending authorization', () => {
  assert.match(emailTf, /email\.cognito-idp\.amazonaws\.com/)
  assert.match(emailTf, /aws:SourceAccount/)
  assert.match(emailTf, /aws:SourceArn/)
  assert.match(emailTf, /SES:SendEmail/)
  assert.match(emailTf, /SES:SendRawEmail/)
  assert.match(emailTf, /aws_cognito_user_pool\.app\.arn/)
  assert.doesNotMatch(emailTf, /ses:\*/i)
})

test('Phase 5B email variables default to the approved domain and sender with cutover disabled', () => {
  assert.match(varsTf, /variable "ses_domain"[\s\S]*default\s*=\s*"seaandshore\.in"/)
  assert.match(varsTf, /variable "ses_from_address"[\s\S]*default\s*=\s*"no-reply@seaandshore\.in"/)
  assert.match(varsTf, /variable "ses_from_display_name"[\s\S]*default\s*=\s*"Sea N Shore"/)
  assert.match(varsTf, /variable "enable_cognito_ses_email"[\s\S]*default\s*=\s*false/)

  assert.match(tfvarsExample, /ses_domain\s*=\s*"seaandshore\.in"/)
  assert.match(tfvarsExample, /ses_from_address\s*=\s*"no-reply@seaandshore\.in"/)
  assert.match(tfvarsExample, /ses_from_display_name\s*=\s*"Sea N Shore"/)
  assert.match(tfvarsExample, /enable_cognito_ses_email\s*=\s*false/)
})
