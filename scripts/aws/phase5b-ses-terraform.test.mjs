import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = new URL('../../', import.meta.url)
const emailTf = fs.readFileSync(new URL('infra/aws/app/email.tf', repoRoot), 'utf8')
const authTf = fs.readFileSync(new URL('infra/aws/app/auth.tf', repoRoot), 'utf8')
const varsTf = fs.readFileSync(new URL('infra/aws/app/aws-native-variables.tf', repoRoot), 'utf8')
const tfvarsExample = fs.readFileSync(new URL('infra/aws/app/terraform.tfvars.example', repoRoot), 'utf8')
const bootstrapTf = fs.readFileSync(new URL('infra/aws/bootstrap/main.tf', repoRoot), 'utf8')
const productionAccessPolicyUrl = new URL(
  'infra/aws/bootstrap/phase5b-ses-production-access.tf',
  repoRoot,
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

test('Phase 5B removes SES production-access write permission after the request is submitted', () => {
  assert.equal(fs.existsSync(productionAccessPolicyUrl), false)
  assert.doesNotMatch(bootstrapTf, /ses:PutAccountDetails/)
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

test('Phase 5B has a read-only SSM audit for SES Terraform state versus live AWS', () => {
  const scriptUrl = new URL('scripts/aws/audit-ses-terraform-state.sh', repoRoot)
  const workflowUrl = new URL('.github/workflows/aws-ses-terraform-state-audit.yml', repoRoot)

  assert.equal(fs.existsSync(scriptUrl), true, 'missing SES Terraform state audit script')
  assert.equal(fs.existsSync(workflowUrl), true, 'missing SES Terraform state audit workflow')

  const script = fs.readFileSync(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"/)
  assert.match(script, /STATE_KEY="sea-n-shore\/staging\/terraform\.tfstate"/)
  assert.match(script, /\.type=="aws_sesv2_configuration_set" and \.name=="transactional"/)
  assert.match(script, /\.type=="aws_sesv2_email_identity" and \.name=="transactional_domain"/)
  assert.match(script, /\.type=="aws_ses_identity_policy" and \.name=="cognito_sender"/)
  assert.match(script, /SES_CONFIGURATION_SET_STATE_COUNT=/)
  assert.match(script, /SES_IDENTITY_STATE_COUNT=/)
  assert.match(script, /SES_IDENTITY_POLICY_STATE_COUNT=/)
  assert.match(script, /aws sesv2 get-configuration-set/)
  assert.match(script, /aws sesv2 get-email-identity/)
  assert.match(script, /aws ses get-identity-policies/)
  assert.match(script, /SES_CONFIGURATION_SET_LIVE_EXISTS=/)
  assert.match(script, /SES_IDENTITY_LIVE_EXISTS=/)
  assert.match(script, /SES_IDENTITY_POLICY_LIVE_EXISTS=/)
  assert.match(script, /SES_IDENTITY_POLICY_LIVE_MATCHES_DESIRED=/)
  assert.match(script, /SES_CONFIGURATION_SET_SENDING_ENABLED=/)
  assert.match(script, /SES_CONFIGURATION_SET_SUPPRESSION_REASONS=/)
  assert.match(script, /SES_CONFIGURATION_SET_REPUTATION_METRICS_ENABLED=/)
  assert.match(script, /SES_IDENTITY_CONFIGURATION_SET=/)
  assert.match(script, /SES_IDENTITY_VERIFIED_FOR_SENDING=/)
  assert.match(script, /SES_IDENTITY_DKIM_STATUS=/)
  assert.match(script, /SES_IDENTITY_CURRENT_SIGNING_KEY_LENGTH=/)
  assert.match(script, /SES_IDENTITY_NEXT_SIGNING_KEY_LENGTH=/)
  assert.doesNotMatch(script, /terraform[^\n]+import/)
  assert.doesNotMatch(script, /terraform[^\n]+apply/)
  assert.doesNotMatch(script, /aws\s+sesv2\s+create-/)
  assert.doesNotMatch(script, /aws\s+sesv2\s+update-/)
  assert.doesNotMatch(script, /aws\s+sesv2\s+put-/)
  assert.doesNotMatch(script, /aws\s+ses\s+(?:set|put|delete)-/)
  assert.doesNotMatch(script, /aws\s+cognito-idp\s+update-/)

  const workflow = fs.readFileSync(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS SES Terraform State Audit/)
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_TO_ASSUME \}\}/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /SES_TERRAFORM_STATE_AUDIT_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/audit-ses-terraform-state\.sh/)
  assert.doesNotMatch(workflow, /terraform\s+-chdir=/)
})

test('Phase 5B SES identity has a single-resource guarded Terraform state-import path', () => {
  const runnerUrl = new URL('scripts/aws/ses-identity-state.sh', repoRoot)
  const actionUrl = new URL('scripts/aws/ses-identity-state-action.txt', repoRoot)
  const workflowUrl = new URL('.github/workflows/aws-ses-identity-state.yml', repoRoot)

  assert.equal(fs.existsSync(runnerUrl), true, 'missing SES identity state runner')
  assert.equal(fs.existsSync(actionUrl), true, 'missing SES identity state action guard')
  assert.equal(fs.existsSync(workflowUrl), true, 'missing SES identity state workflow')
  assert.equal(fs.readFileSync(actionUrl, 'utf8').trim(), 'plan')

  const runner = fs.readFileSync(runnerUrl, 'utf8')
  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(runner, /STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"/)
  assert.match(runner, /RESOURCE="aws_sesv2_email_identity\.transactional_domain"/)
  assert.match(runner, /IMPORT_ID="seaandshore\.in"/)
  assert.match(runner, /SES_CONFIGURATION_SET="sea-n-shore-staging-transactional"/)
  assert.match(runner, /ses-identity-state-action\.txt/)
  assert.match(runner, /plan\|apply-once/)
  assert.match(runner, /aws sesv2 get-email-identity/)
  assert.match(runner, /VerifiedForSendingStatus/)
  assert.match(runner, /DkimAttributes\.Status/)
  assert.match(runner, /CurrentSigningKeyLength/)
  assert.match(runner, /NextSigningKeyLength/)
  assert.match(runner, /terraform[^\n]+plan/)
  assert.match(runner, /-target="\$RESOURCE"/)
  assert.match(runner, /SES_IDENTITY_STATE_PLAN_VERIFIED=IMPORT_ONLY/)
  assert.match(runner, /SES_IDENTITY_STATE_PLAN_ONLY_NO_IMPORT/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /get-bucket-versioning/)
  assert.match(runner, /STATE_BACKUP_VERSION=/)
  assert.match(runner, /terraform[^\n]+import/)
  assert.match(runner, /"\$RESOURCE" "\$IMPORT_ID"/)
  assert.match(runner, /SES_IDENTITY_STATE_IMPORT_VERIFIED=true/)
  assert.match(runner, /SES_IDENTITY_STATE_COUNT_AFTER=1/)
  assert.doesNotMatch(runner, /terraform[^\n]+apply/)
  assert.doesNotMatch(runner, /aws\s+sesv2\s+(?:create|update|put|delete)-/)
  assert.doesNotMatch(runner, /aws\s+ses\s+(?:set|put|delete)-/)
  assert.doesNotMatch(runner, /aws\s+cognito-idp\s+update-/)

  const workflow = fs.readFileSync(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS SES Identity State/)
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_TO_ASSUME \}\}/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /SES_IDENTITY_STATE_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/ses-identity-state\.sh/)
  assert.doesNotMatch(workflow, /terraform\s+-chdir=/)
})
