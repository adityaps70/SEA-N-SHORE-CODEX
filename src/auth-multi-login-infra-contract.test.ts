import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('multi-login Cognito infrastructure contract', () => {
  const auth = fs.readFileSync('infra/aws/app/auth.tf', 'utf8')
  const main = fs.readFileSync('infra/aws/app/main.tf', 'utf8')
  const defineChallenge = fs.readFileSync('infra/aws/app/lambda/cognito-define-auth-challenge.mjs', 'utf8')
  const createChallenge = fs.readFileSync('infra/aws/app/lambda/cognito-create-auth-challenge.mjs', 'utf8')
  const verifyChallenge = fs.readFileSync('infra/aws/app/lambda/cognito-verify-auth-challenge.mjs', 'utf8')

  it('enables custom auth and wires the three Cognito challenge triggers', () => {
    expect(auth).toMatch(/ALLOW_CUSTOM_AUTH/)
    expect(auth).toMatch(/define_auth_challenge\s*=\s*aws_lambda_function\.cognito_define_auth_challenge\.arn/)
    expect(auth).toMatch(/create_auth_challenge\s*=\s*aws_lambda_function\.cognito_create_auth_challenge\.arn/)
    expect(auth).toMatch(/verify_auth_challenge_response\s*=\s*aws_lambda_function\.cognito_verify_auth_challenge\.arn/)
    expect(auth).toMatch(/cognito-idp\.amazonaws\.com/)
  })

  it('limits OTP challenge attempts and sends the code only to the Cognito phone attribute', () => {
    expect(defineChallenge).toMatch(/session\.length\s*>=\s*3/)
    expect(createChallenge).toMatch(/request\.userAttributes\?\.phone_number/)
    expect(createChallenge).toMatch(/sns:Publish|PublishCommand/)
    expect(createChallenge).not.toMatch(/console\.log\([^)]*code/i)
    expect(verifyChallenge).toMatch(/privateChallengeParameters\?\.answer/)
  })

  it('configures optional Google federation using the existing secret and OAuth code flow', () => {
    expect(auth).toMatch(/aws_cognito_identity_provider" "google"/)
    expect(auth).toMatch(/aws_secretsmanager_secret_version" "google_oauth"/)
    expect(auth).toMatch(/authorize_scopes\s*=\s*"openid email profile"/)
    expect(auth).toMatch(/allowed_oauth_flows\s*=\s*\["code"\]/)
    expect(auth).toMatch(/callback_urls/)
    expect(auth).toMatch(/supported_identity_providers/)
  })

  it('passes Cognito domain and Google availability to the web task and permits phone administration', () => {
    expect(main).toMatch(/AWS_COGNITO_DOMAIN/)
    expect(main).toMatch(/AWS_COGNITO_GOOGLE_ENABLED/)
    expect(auth).toMatch(/cognito-idp:ListUsers/)
    expect(auth).toMatch(/cognito-idp:AdminCreateUser/)
    expect(auth).toMatch(/cognito-idp:AdminSetUserPassword/)
    expect(auth).toMatch(/cognito-idp:AdminUpdateUserAttributes/)
  })
})
