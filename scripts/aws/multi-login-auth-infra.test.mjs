// Disk maintenance recovered bootstrap capacity; rerun the plan-only Google auth gate.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Stale state-lock recovery should leave this auth release path plan-safe.
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
  // Round 15: phone/SMS sign-in is retired; the custom auth challenge Lambdas are neither targeted
  // nor accepted here (sms-retirement-infra removes them), and the live pool must not have them.
  assert.doesNotMatch(script, /aws_lambda_function\.cognito_(define|create|verify)_auth_challenge|cognito_auth_challenge|otp_limits/)
  assert.match(script, /\(\.UserPool\.LambdaConfig\.DefineAuthChallenge \/\/ null\) == null/)
  assert.match(script, /\(\.UserPoolClient\.ExplicitAuthFlows \| index\("ALLOW_CUSTOM_AUTH"\)\) == null/)
  assert.match(script, /CUSTOM_AUTH_RETIRED_VERIFIED=true/)
  assert.match(script, /aws_cognito_identity_provider\.google/)
  assert.match(script, /cognito-pre-sign-up-link\.mjs/)
  assert.match(script, /aws_lambda_function\.cognito_pre_sign_up_link/)
  assert.match(script, /aws_lambda_permission\.cognito_pre_sign_up_link/)
  // Round 14 (2.7): the disposable-email block ships as an in-place code update of this Lambda
  // (new source_code_hash), which the plan classifier must accept as an allowed ['update'].
  assert.match(script, /'aws_lambda_function\.cognito_pre_sign_up_link',/)
  assert.match(script, /if actions not in \(\['create'\], \['update'\]\):/)
  assert.match(script, /PreSignUp/)
  assert.match(script, /aws ecs describe-task-definition/)
  assert.match(script, /aws ecs update-service/)
  assert.match(script, /AWS_COGNITO_GOOGLE_ENABLED/)
  assert.match(script, /AWS_COGNITO_DOMAIN/)
  assert.match(script, /DESIRED_COGNITO_DOMAIN/)
  assert.match(script, /CURRENT_COGNITO_DOMAIN/)
  assert.match(script, /\.type=="aws_cognito_user_pool_domain" and \.name=="custom"/)
  assert.match(script, /\[\[ "\$DESIRED_COGNITO_DOMAIN" == "auth\.seanshore\.in" \]\]/)
  assert.match(script, /COGNITO_CUSTOM_DOMAIN_ACTIVE=true/)
  assert.match(script, /"https:\/\/\$DESIRED_COGNITO_DOMAIN\/oauth2\/authorize"\*/)
  assert.doesNotMatch(script, /amazoncognito\.com/)
  assert.match(script, /\.services\[0\]\.desiredCount >= 1/)
  assert.match(script, /\.services\[0\]\.runningCount == \.services\[0\]\.desiredCount/)
  assert.match(script, /\(\.services\[0\]\.deployments \| length\) == 1/)
  assert.match(script, /rolloutState\) == "COMPLETED"/)
  assert.match(script, /failedTasks\) == 0/)
  assert.match(script, /WEB_SERVICE_STATE=/)
  assert.doesNotMatch(script, /desiredCount == 1/)
  assert.match(script, /Refusing Google runtime rollout because fields other than AWS_COGNITO_GOOGLE_ENABLED and AWS_COGNITO_DOMAIN changed/)
  assert.match(script, /GOOGLE_RUNTIME_VERIFIED=true/)
  assert.match(script, /Continue with Google/)
  assert.match(script, /GOOGLE_OAUTH_CREDENTIALS_READY/)
  assert.match(script, /GOOGLE_IDP_DETAIL_DIFF/)
  assert.match(script, /sensitive = \{'client_id', 'client_secret'\}/)
  assert.match(script, /MULTI_LOGIN_AUTH_INFRA_PLAN_VERIFIED=true/)
  assert.match(script, /MULTI_LOGIN_AUTH_INFRA_APPLY_VERIFIED=true/)
  assert.match(script, /COGNITO_CLIENT_SITE_URLS_VERIFIED=true/)
  assert.match(script, /aws\.cognito\.signin\.user\.admin/)
  assert.match(script, /COGNITO_CLIENT_SELF_SERVICE_SCOPE_VERIFIED=true/)
  assert.match(script, /GOOGLE_VERIFIED_EMAIL_MAPPING_VERIFIED=true/)
  assert.match(script, /sea-n-shore-staging-cognito-pre-sign-up-link/)
  assert.match(script, /\.UserPoolClient\.CallbackURLs \| index\(\$site \+ "\/auth\/google\/callback"\)/)
  assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  // Cognito account emails through Resend: sender first with a no-send smoke call, then the pool switch.
  assert.match(script, /infra\/aws\/app\/cognito-email-sender\.tf \\/)
  assert.match(script, /infra\/aws\/app\/lambda\/cognito-resend-email-sender\.mjs \\/)
  assert.match(script, /aws_kms_key\.cognito_email_sender/)
  assert.match(script, /aws_lambda_function\.cognito_resend_email_sender/)
  assert.match(script, /aws_lambda_permission\.cognito_resend_email_sender/)
  assert.match(script, /'aws_lambda_function\.cognito_resend_email_sender',/)
  assert.match(script, /RESEND_SECRET_FORMAT=/)
  assert.match(script, /refusing to route Cognito email through it/)
  assert.match(script, /refusing to switch Cognito email to Resend/)
  assert.doesNotMatch(script, /echo[^\n]*\$RESEND_SECRET_STRING/)
  assert.match(script, /unset RESEND_SECRET_STRING/)
  assert.match(script, /The sender-only plan would change the user pool; refusing\./)
  assert.doesNotMatch(script, /^! grep/m)
  assert.match(script, /CustomEmailSender_AccountTakeOverNotification/)
  assert.match(script, /COGNITO_RESEND_SENDER_SMOKE_VERIFIED=true/)
  assert.match(script, /Cognito was not switched/)
  assert.match(script, /\.UserPool\.LambdaConfig\.KMSKeyID == \$key/)
  assert.match(script, /CustomEmailSender\.LambdaVersion == "V1_0"/)
  assert.match(script, /COGNITO_RESEND_EMAIL_SENDER_VERIFIED=true/)
  const smokeAt = script.indexOf('COGNITO_RESEND_SENDER_SMOKE_VERIFIED=true')
  const finalApplyAt = script.indexOf('apply -input=false -no-color "$WORK_DIR/auth-final.tfplan"')
  assert.ok(smokeAt > 0 && finalApplyAt > smokeAt, 'the user pool switch must follow the sender smoke check')
  assert.doesNotMatch(script, /apply -input=false -no-color "\$WORK_DIR\/auth\.tfplan"/)
  assert.doesNotMatch(script, /terraform[^\n]+-auto-approve/)
  assert.doesNotMatch(script, /aws\s+cognito-idp\s+(create|update|delete)-user-pool/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Multi Login Auth Infrastructure/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/multi-login-auth-infra\.sh/)
  assert.match(workflow, /- infra\/aws\/app\/cognito-email-sender\.tf/)
  assert.match(workflow, /- infra\/aws\/app\/lambda\/cognito-resend-email-sender\.mjs/)
})

// Round 14 (2.11): MFA OPTIONAL with authenticator apps only; no SMS MFA, no Plus / threat protection.
test('multi-login auth runner accepts only optional authenticator-app MFA and verifies it after apply', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const script = await readFile(new URL('./multi-login-auth-infra.sh', import.meta.url), 'utf8')
  const auth = await readFile(new URL('../../infra/aws/app/auth.tf', import.meta.url), 'utf8')

  // Terraform: OPTIONAL + software tokens, and nothing paid or SMS-based on the pool.
  const pool = auth.slice(auth.indexOf('resource "aws_cognito_user_pool" "app"'), auth.indexOf('resource "aws_cognito_user_pool_domain" "app"'))
  assert.match(pool, /^\s*mfa_configuration\s*=\s*"OPTIONAL"$/m)
  assert.match(pool, /software_token_mfa_configuration\s*\{\s*enabled\s*=\s*true\s*\}/)
  assert.doesNotMatch(pool, /mfa_configuration\s*=\s*"(OFF|ON)"/)
  assert.doesNotMatch(pool, /^\s*(sms_configuration|email_mfa_configuration|user_pool_add_ons|user_pool_tier|advanced_security_mode)\b/m)
  // Round 15: the web client keeps password, SRP and refresh-token sign-in; custom auth is retired.
  assert.match(auth, /"ALLOW_USER_PASSWORD_AUTH",\s*"ALLOW_USER_SRP_AUTH",\s*"ALLOW_REFRESH_TOKEN_AUTH",\s*\]/)
  assert.doesNotMatch(auth, /ALLOW_CUSTOM_AUTH"/)

  // Post-apply verification reads the live pool, read-only.
  assert.match(script, /aws cognito-idp get-user-pool-mfa-config --region "\$AWS_REGION" --user-pool-id "\$USER_POOL_ID"/)
  assert.match(script, /\.MfaConfiguration == "OPTIONAL"\n\s*and \.SoftwareTokenMfaConfiguration\.Enabled == true/)
  assert.match(script, /\.UserPool\.MfaConfiguration == "OPTIONAL"/)
  assert.match(script, /\(\.UserPool\.UserPoolAddOns\.AdvancedSecurityMode \/\/ "OFF"\) == "OFF"/)
  assert.match(script, /\(\.UserPool\.UserPoolTier \/\/ "ESSENTIALS"\) != "PLUS"/)
  assert.match(script, /COGNITO_TOTP_MFA_OPTIONAL_VERIFIED=true/)
  const verifiedAt = script.indexOf('COGNITO_TOTP_MFA_OPTIONAL_VERIFIED=true')
  assert.ok(verifiedAt > script.indexOf('apply -input=false -no-color "$WORK_DIR/auth-final.tfplan"'))
  assert.ok(verifiedAt < script.indexOf('MULTI_LOGIN_AUTH_INFRA_APPLY_VERIFIED=true'))

  // Run the plan classifier itself against representative plans.
  const start = script.indexOf(`cat > "$WORK_DIR/classify-plan.py" <<'PY'\n`)
  assert.ok(start > 0)
  const bodyStart = script.indexOf('\n', start) + 1
  const classifier = script.slice(bodyStart, script.indexOf('\nPY\n', bodyStart))
  const dir = mkdtempSync(join(tmpdir(), 'mfa-classifier-'))
  try {
    const classifierPath = join(dir, 'classify.py')
    writeFileSync(classifierPath, classifier)
    const poolChange = (after, actions = ['update'], before = { mfa_configuration: 'OFF', software_token_mfa_configuration: [], lambda_config: [{}] }) => ({
      resource_changes: [{ address: 'aws_cognito_user_pool.app', mode: 'managed', change: { actions, before, after } }],
    })
    const optional = { mfa_configuration: 'OPTIONAL', software_token_mfa_configuration: [{ enabled: true }], sms_configuration: [], user_pool_tier: 'ESSENTIALS', user_pool_add_ons: [], lambda_config: [{}] }
    const run = (plan) => {
      const planPath = join(dir, `plan-${Math.random().toString(36).slice(2)}.json`)
      writeFileSync(planPath, JSON.stringify(plan))
      try {
        return { ok: true, output: execFileSync('python3', [classifierPath, planPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
      } catch (error) {
        return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
      }
    }

    const accepted = run(poolChange(optional))
    assert.equal(accepted.ok, true, accepted.output)
    assert.match(accepted.output, /MULTI_LOGIN_AUTH_INFRA_CHANGE=aws_cognito_user_pool\.app\|update/)
    assert.match(accepted.output, /COGNITO_MFA_CONFIG_BEFORE=\{[^\n]*"mfa_configuration": "OFF"/)
    assert.match(accepted.output, /COGNITO_MFA_CONFIG_AFTER=\{[^\n]*"mfa_configuration": "OPTIONAL"[^\n]*"software_token_mfa_enabled": true/)

    for (const [label, after, pattern] of [
      ['MFA left off', { ...optional, mfa_configuration: 'OFF' }, /must be OPTIONAL/],
      ['MFA required for everyone', { ...optional, mfa_configuration: 'ON' }, /must be OPTIONAL/],
      ['no authenticator apps', { ...optional, software_token_mfa_configuration: [{ enabled: false }] }, /must be OPTIONAL/],
      ['SMS MFA', { ...optional, sms_configuration: [{ external_id: 'x', sns_caller_arn: 'arn:aws:iam::1:role/sms' }] }, /SMS MFA/],
      ['Plus tier', { ...optional, user_pool_tier: 'PLUS' }, /Plus/],
      ['threat protection', { ...optional, user_pool_add_ons: [{ advanced_security_mode: 'ENFORCED' }] }, /threat protection/],
      ['audit-only threat protection', { ...optional, user_pool_add_ons: [{ advanced_security_mode: 'AUDIT' }] }, /threat protection/],
    ]) {
      const refused = run(poolChange(after))
      assert.equal(refused.ok, false, `${label} must be refused`)
      assert.match(refused.output, pattern, label)
    }

    const replaced = run(poolChange(optional, ['delete', 'create']))
    assert.equal(replaced.ok, false)
    assert.match(replaced.output, /destructive\/replacement auth infrastructure change refused/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
