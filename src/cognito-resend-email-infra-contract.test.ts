import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Cognito account email through Resend infrastructure contract', () => {
  const auth = fs.readFileSync('infra/aws/app/auth.tf', 'utf8')
  const sender = fs.readFileSync('infra/aws/app/cognito-email-sender.tf', 'utf8')
  const lambda = fs.readFileSync('infra/aws/app/lambda/cognito-resend-email-sender.mjs', 'utf8')

  it('wires the custom email sender and its KMS key into the user pool behind a rollback flag', () => {
    expect(auth).toMatch(/kms_key_id\s*=\s*var\.enable_cognito_resend_email \? aws_kms_key\.cognito_email_sender\.arn : null/)
    expect(auth).toMatch(/dynamic "custom_email_sender"[\s\S]*?for_each\s*=\s*var\.enable_cognito_resend_email \? \[1\] : \[\]/)
    expect(auth).toMatch(/lambda_arn\s*=\s*aws_lambda_function\.cognito_resend_email_sender\.arn/)
    expect(auth).toMatch(/lambda_version\s*=\s*"V1_0"/)
    expect(auth).toMatch(/aws_lambda_permission\.cognito_resend_email_sender/)
    expect(sender).toMatch(/variable "enable_cognito_resend_email"[\s\S]*?default\s*=\s*true/)
  })

  it('keeps Cognito default email configuration as the fallback when the flag is off', () => {
    expect(auth).toMatch(/email_sending_account\s*=\s*var\.enable_cognito_ses_email \? "DEVELOPER" : "COGNITO_DEFAULT"/)
  })

  it('uses a rotating customer key that only this account\'s Cognito pools may encrypt with', () => {
    expect(sender).toMatch(/resource "aws_kms_key" "cognito_email_sender"/)
    expect(sender).toMatch(/enable_key_rotation\s*=\s*true/)
    expect(sender).toMatch(/deletion_window_in_days\s*=\s*30/)
    expect(sender).toMatch(/Principal\s*=\s*\{\s*Service\s*=\s*"cognito-idp\.amazonaws\.com"\s*\}/)
    expect(sender).toMatch(/"aws:SourceAccount"\s*=\s*data\.aws_caller_identity\.current\.account_id/)
    expect(sender).toMatch(/"aws:SourceArn"\s*=\s*"arn:aws:cognito-idp:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:userpool\/\*"/)
    const keyPolicy = sender.slice(sender.indexOf('resource "aws_kms_key"'), sender.indexOf('resource "aws_kms_alias"'))
    expect(keyPolicy).toMatch(/"kms:Encrypt"/)
    expect(keyPolicy).not.toMatch(/kms:Decrypt/)
  })

  it('grants the sender only decrypt on that key and read on the existing Resend secret', () => {
    expect(sender).toMatch(/Action\s*=\s*\["kms:Decrypt"\]\s*\n\s*Resource\s*=\s*aws_kms_key\.cognito_email_sender\.arn/)
    expect(sender).toMatch(/Action\s*=\s*\["secretsmanager:GetSecretValue"\]\s*\n\s*Resource\s*=\s*local\.resend_secret_arn_pattern/)
    expect(sender).not.toMatch(/"(ses|sns|cognito-idp):/)
    expect(sender).toMatch(/principal\s*=\s*"cognito-idp\.amazonaws\.com"/)
    expect(sender).toMatch(/source_account\s*=\s*data\.aws_caller_identity\.current\.account_id/)
  })

  it('sends from the Resend-verified accounts sender and the canonical site', () => {
    expect(sender).toMatch(/default\s*=\s*"Sea N Shore <accounts@mail\.seanshore\.in>"/)
    expect(sender).toMatch(/RESEND_SECRET_ID\s*=\s*"sea-n-shore\/resend"/)
    expect(sender).toMatch(/COGNITO_EMAIL_KMS_KEY_ARN\s*=\s*aws_kms_key\.cognito_email_sender\.arn/)
    expect(sender).toMatch(/runtime\s*=\s*"nodejs22\.x"/)
  })

  it('never logs codes, passwords or addresses from the sender', () => {
    // One structured logger; every field it is given must be on the safe list.
    expect(lambda.match(/console\.(log|error|warn|info)\(/g)).toHaveLength(1)
    const calls = [...lambda.matchAll(/\blog\(\{([^}]*)\}\)/g)].map((match) => match[1])
    expect(calls.length).toBeGreaterThanOrEqual(6)
    const safe = new Set(['outcome', 'triggerSource', 'error', 'status', 'reason', 'name', 'resendId'])
    for (const call of calls) {
      const keys = call.split(',').map((part) => part.split(':')[0].trim()).filter(Boolean)
      for (const key of keys) expect(safe, call).toContain(key)
    }
    expect(lambda).toMatch(/'Idempotency-Key': idempotencyKey/)
    expect(lambda).toMatch(/https:\/\/api\.resend\.com\/emails/)
  })
})
