import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = new URL('../../', import.meta.url)
const emailTf = fs.readFileSync(new URL('infra/aws/app/email.tf', repoRoot), 'utf8')
const authTf = fs.readFileSync(new URL('infra/aws/app/auth.tf', repoRoot), 'utf8')
const varsTf = fs.readFileSync(new URL('infra/aws/app/aws-native-variables.tf', repoRoot), 'utf8')
const tfvarsExample = fs.readFileSync(new URL('infra/aws/app/terraform.tfvars.example', repoRoot), 'utf8')
const bootstrapTf = fs.readFileSync(new URL('infra/aws/bootstrap/main.tf', repoRoot), 'utf8')
const productionAccessTf = fs.readFileSync(
  new URL('infra/aws/bootstrap/phase5b-ses-production-access.tf', repoRoot),
  'utf8',
)

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

test('Phase 5B ops role may read SES account state without broad SES administration', () => {
  assert.match(bootstrapTf, /Sid\s*=\s*"Phase5bSesAccountRead"/)
  assert.match(bootstrapTf, /"ses:GetAccount"/)
  assert.doesNotMatch(bootstrapTf, /"ses:\*"/i)
})

test('Phase 5B ops role may request SES production access without broad SES administration', () => {
  assert.match(productionAccessTf, /Sid\s*=\s*"Phase5bSesProductionAccess"/)
  assert.match(productionAccessTf, /"ses:PutAccountDetails"/)
  assert.match(productionAccessTf, /Resource\s*=\s*"\*"/)
  assert.doesNotMatch(productionAccessTf, /"ses:\*"/i)
})

test('Phase 5B ops role may read only the approved SES identity and configuration set', () => {
  assert.match(bootstrapTf, /Sid\s*=\s*"Phase5bSesResourceRead"/)
  assert.match(bootstrapTf, /"ses:GetEmailIdentity"/)
  assert.match(bootstrapTf, /"ses:GetConfigurationSet"/)
  assert.match(
    bootstrapTf,
    /arn:aws:ses:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:identity\/seaandshore\.in/,
  )
  assert.match(
    bootstrapTf,
    /arn:aws:ses:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:configuration-set\/sea-n-shore-staging-transactional/,
  )
  assert.doesNotMatch(bootstrapTf, /"ses:\*"/i)
})

test('Phase 5B ops role may create only the approved SES domain identity', () => {
  assert.match(bootstrapTf, /Sid\s*=\s*"Phase5bSesIdentityCreate"/)
  assert.match(bootstrapTf, /"ses:CreateEmailIdentity"/)
  assert.match(
    bootstrapTf,
    /arn:aws:ses:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:identity\/seaandshore\.in/,
  )
  assert.doesNotMatch(bootstrapTf, /"ses:\*"/i)
})

test('Phase 5B ops role may describe only the discovered staging Cognito user pool', () => {
  assert.match(
    bootstrapTf,
    /variable "phase5b_cognito_user_pool_id"[\s\S]*default\s*=\s*"ap-south-1_FKyi5lJsY"/,
  )
  assert.match(bootstrapTf, /Sid\s*=\s*"Phase5bCognitoRead"/)
  assert.match(bootstrapTf, /"cognito-idp:DescribeUserPool"/)
  assert.match(
    bootstrapTf,
    /arn:aws:cognito-idp:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:userpool\/\$\{var\.phase5b_cognito_user_pool_id\}/,
  )
  assert.doesNotMatch(bootstrapTf, /"cognito-idp:\*"/i)
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

test('Phase 5B keeps Cognito default delivery until the explicit SES cutover flag is enabled', () => {
  assert.match(authTf, /email_configuration\s*\{/)
  assert.match(
    authTf,
    /email_sending_account\s*=\s*var\.enable_cognito_ses_email\s*\?\s*"DEVELOPER"\s*:\s*"COGNITO_DEFAULT"/,
  )
  assert.match(
    authTf,
    /source_arn\s*=\s*var\.enable_cognito_ses_email\s*\?\s*aws_sesv2_email_identity\.transactional_domain\.arn\s*:\s*null/,
  )
  assert.match(
    authTf,
    /from_email_address\s*=\s*var\.enable_cognito_ses_email\s*\?\s*"\$\{var\.ses_from_display_name\} <\$\{var\.ses_from_address\}>"\s*:\s*null/,
  )
  assert.match(
    authTf,
    /reply_to_email_address\s*=\s*var\.enable_cognito_ses_email\s*\?\s*var\.ses_from_address\s*:\s*null/,
  )
  assert.match(
    authTf,
    /configuration_set\s*=\s*var\.enable_cognito_ses_email\s*\?\s*aws_sesv2_configuration_set\.transactional\.configuration_set_name\s*:\s*null/,
  )
})
