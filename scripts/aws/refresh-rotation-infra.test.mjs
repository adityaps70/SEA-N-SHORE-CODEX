// Round I (I3): guarded release path and Terraform contract for refresh token rotation on the public web client.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./refresh-rotation-infra.sh')
const action = guardAction(await read('./refresh-rotation-infra-action.txt'))
const workflow = await read('../../.github/workflows/aws-refresh-rotation-infra.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const auth = await read('../../infra/aws/app/auth.tf')
const ledger = await read('../../src/features/account-security/refresh-token-ledger.ts')
const cognitoApi = await read('../../src/lib/auth/cognito-api.ts')
const webClient = auth.slice(auth.indexOf('resource "aws_cognito_user_pool_client" "web"'), auth.indexOf('\n}\n', auth.indexOf('resource "aws_cognito_user_pool_client" "web"')))

test('the runner is guarded like the other bootstrap-host Terraform runners', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /REFRESH_ROTATION_INFRA_EXPECTED_SHA/)
  assert.match(script, /jq -e '\.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"'/)
  const account = script.search(/get-caller-identity/)
  const lock = script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh')
  assert.ok(account > 0 && lock > account, 'host lock right after the account check')
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  assert.doesNotMatch(script, /^terraform -chdir="\$APP_DIR" plan /m, 'plans are bounded')
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/plan\.log" -chdir="\$APP_DIR" plan /)
  // Only the web client is planned.
  assert.match(script, /TARGETS=\(\n  aws_cognito_user_pool_client\.web\n\)/)
  // Saved-plan apply only, after the branch and state backup checks.
  assert.match(script, /terraform -chdir="\$APP_DIR" apply -input=false -no-color "\$WORK_DIR\/refresh-rotation\.tfplan"/)
  assert.doesNotMatch(script, /-auto-approve|terraform[^\n]* destroy|state rm/)
  const applyAt = script.indexOf('apply -input=false -no-color "$WORK_DIR/refresh-rotation.tfplan"')
  assert.ok(script.indexOf('bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1') < applyAt)
  assert.ok(script.indexOf('STATE_BACKUP_VERSION=') < applyAt)
  assert.ok(script.indexOf('REFRESH_ROTATION_PLAN_ONLY_NO_APPLY') < applyAt)
  assert.ok(script.indexOf('Refresh token rotation is already applied; nothing to apply.') < applyAt)
  assert.match(script, /The web client still drifts after apply/)
  // Settings only: never a token, a secret, a user or an email.
  assert.doesNotMatch(script, /get-secret-value|SecretString|list-users|initiate-auth|get-tokens-from-refresh-token|ClientSecret/)

  assert.match(workflow, /name: AWS Refresh Rotation Infrastructure/)
  assert.match(workflow, /group: sea-n-shore-refresh-rotation-infra\n  cancel-in-progress: false/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/refresh-rotation-infra-action\.txt\n\s+shell: bash\n\s+run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /apply-once is allowed only from an exact branch push/)
  assert.match(workflow, /export REFRESH_ROTATION_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/refresh-rotation-infra\.sh/)
  assert.match(workflow, /grep -q 'REFRESH_ROTATION_PLAN_VERIFIED=true'/)
  assert.match(workflow, /grep -q 'REFRESH_ROTATION_PLAN_ONLY_NO_APPLY'/)
  assert.match(workflow, /grep -q 'REFRESH_ROTATION_APPLY_VERIFIED=true'/)
  const on = workflow.split('\njobs:')[0]
  for (const path of ['infra/aws/app/auth.tf', 'scripts/aws/refresh-rotation-infra.sh', 'scripts/aws/refresh-rotation-infra-action.txt', 'scripts/aws/refresh-rotation-infra.test.mjs']) {
    assert.ok(on.includes(`- ${path}\n`), path)
  }
  assert.ok(!on.includes('- infra/aws/app/main.tf\n'))
  assert.match(ci, /node --test scripts\/aws\/refresh-rotation-infra\.test\.mjs/)
})

test('the web client is planned by this runner only', async () => {
  const dir = new URL('./', import.meta.url)
  const owners = []
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sh'))) {
    const text = await readFile(new URL(name, dir), 'utf8')
    const targets = text.match(/\nTARGETS=\(\n([\s\S]*?)\n\)/)
    if (targets && /^\s*aws_cognito_user_pool_client\.web$/m.test(targets[1])) owners.push(name)
  }
  assert.deepEqual(owners, ['refresh-rotation-infra.sh'])
})

test('post-apply evidence reads the live client', () => {
  for (const marker of ['REFRESH_ROTATION_DRIFT_FREE', 'REFRESH_TOKEN_ROTATION_ENABLED', 'REFRESH_TOKEN_AUTH_FLOW_DISABLED', 'PUBLIC_SITE_LIVE_VERIFIED', 'REFRESH_ROTATION_APPLY_VERIFIED']) {
    assert.match(script, new RegExp(`${marker}=true`), marker)
  }
  assert.match(script, /\(\.ExplicitAuthFlows \| sort\) == \["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"\]/)
  assert.match(script, /\.RefreshTokenRotation\.Feature == "ENABLED"/)
  assert.match(script, /\.RefreshTokenRotation\.RetryGracePeriodSeconds == 60/)
  assert.match(script, /\.RefreshTokenValidity == 3650/)
  assert.match(script, /\.EnableTokenRevocation == true/)
  const liveCheck = script.indexOf('REFRESH_TOKEN_ROTATION_ENABLED=true')
  assert.ok(liveCheck > script.indexOf('REFRESH_ROTATION_DRIFT_FREE=true'))
  assert.ok(script.indexOf('REFRESH_ROTATION_APPLY_VERIFIED=true') > liveCheck)
})

test('Terraform: rotation on with the app\'s grace, no REFRESH_TOKEN_AUTH, a 3650-day limit and nothing else changed', () => {
  assert.match(webClient, /explicit_auth_flows = \[\n    "ALLOW_USER_PASSWORD_AUTH",\n    "ALLOW_USER_SRP_AUTH",\n  \]/)
  assert.doesNotMatch(webClient, /"ALLOW_REFRESH_TOKEN_AUTH"|"ALLOW_CUSTOM_AUTH"/)
  assert.match(webClient, /refresh_token_rotation \{\n    feature                    = "ENABLED"\n    retry_grace_period_seconds = 60\n  \}/)
  assert.match(webClient, /access_token_validity  = 60\n  id_token_validity      = 60\n  refresh_token_validity = 3650\n/)
  assert.match(webClient, /refresh_token = "days"/)
  assert.doesNotMatch(webClient, /enable_token_revocation\s*=\s*false/)
  assert.doesNotMatch(webClient, /write_attributes\s*=/)
  // The grace period is the same window the app's reuse detection allows.
  assert.match(ledger, /export const REFRESH_REUSE_GRACE_SECONDS = 60\n/)
  // The app refreshes with GetTokensFromRefreshToken (REFRESH_TOKEN_AUTH is only a fallback for an endpoint
  // that does not know that operation).
  assert.match(cognitoApi, /request<CognitoAuthenticationResponse>\('GetTokensFromRefreshToken'/)
})

// Runs the runner's own plan classifier against synthetic plans.
const classifierStart = script.indexOf(`cat > "$WORK_DIR/classify-plan.py" <<'PY'\n`)
const classifier = script.slice(script.indexOf('\n', classifierStart) + 1, script.indexOf('\nPY\n', classifierStart))

const clientBefore = {
  name: 'sea-n-shore-staging-web',
  explicit_auth_flows: ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH'],
  refresh_token_rotation: [],
  refresh_token_validity: 30,
  access_token_validity: 60,
  id_token_validity: 60,
  token_validity_units: [{ access_token: 'minutes', id_token: 'minutes', refresh_token: 'days' }],
  enable_token_revocation: true,
  callback_urls: ['https://seanshore.in/auth/google/callback'],
  supported_identity_providers: ['COGNITO', 'Google'],
}
const clientAfter = {
  ...clientBefore,
  explicit_auth_flows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH'],
  refresh_token_rotation: [{ feature: 'ENABLED', retry_grace_period_seconds: 60 }],
  refresh_token_validity: 3650,
}
const change = (address, actions, before, after, afterUnknown = {}) => ({ address, mode: 'managed', change: { actions, before, after, after_unknown: afterUnknown } })
const validPlan = () => [change('aws_cognito_user_pool_client.web', ['update'], structuredClone(clientBefore), structuredClone(clientAfter))]
const editAfter = (edit) => validPlan().map((r) => (edit(r.change.after), r))

async function classify(resourceChanges) {
  const dir = await mkdtemp(join(tmpdir(), 'refresh-rotation-plan-'))
  try {
    const planPath = join(dir, 'plan.json')
    const classifierPath = join(dir, 'classify.py')
    await writeFile(planPath, JSON.stringify({ resource_changes: resourceChanges }))
    await writeFile(classifierPath, classifier)
    const run = spawnSync('python3', [classifierPath, planPath], { encoding: 'utf8' })
    return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the classifier accepts exactly the rotation change on the web client', async () => {
  const accepted = await classify(validPlan())
  assert.equal(accepted.ok, true, accepted.output)
  assert.match(accepted.output, /REFRESH_ROTATION_KEYS=aws_cognito_user_pool_client\.web\|explicit_auth_flows,refresh_token_rotation,refresh_token_validity/)
  assert.match(accepted.output, /COGNITO_CLIENT_EXPLICIT_AUTH_FLOWS_PLANNED_AFTER=ALLOW_USER_PASSWORD_AUTH,ALLOW_USER_SRP_AUTH/)
  assert.match(accepted.output, /COGNITO_CLIENT_REFRESH_TOKEN_ROTATION_PLANNED_AFTER=ENABLED\|grace=60/)
  assert.match(accepted.output, /COGNITO_CLIENT_REFRESH_TOKEN_VALIDITY_PLANNED_AFTER=3650\|days/)
  assert.match(accepted.output, /REFRESH_ROTATION_PLAN_CHANGES=1/)
})

test('the classifier refuses anything outside the allowlist', async () => {
  const cases = [
    ['an unrelated change', [...validPlan(), change('aws_ecs_service.web', ['update'], { desired_count: 2 }, { desired_count: 1 })], /unexpected change aws_ecs_service\.web/],
    ['a user pool change', [...validPlan(), change('aws_cognito_user_pool.app', ['update'], { mfa_configuration: 'OPTIONAL' }, { mfa_configuration: 'OFF' })], /unexpected change aws_cognito_user_pool\.app/],
    ['replacing the client', validPlan().map((r) => ((r.change.actions = ['delete', 'create']), r)), /may only be updated in place/],
    ['destroying the client', validPlan().map((r) => ((r.change.actions = ['delete']), (r.change.after = null), r)), /may only be updated in place/],
    ['another client attribute', editAfter((a) => (a.callback_urls = ['https://evil.example/cb'])), /web client change outside refresh token rotation: callback_urls/],
    ['shorter access tokens', editAfter((a) => (a.access_token_validity = 5)), /outside refresh token rotation: access_token_validity/],
    ['turning revocation off', editAfter((a) => (a.enable_token_revocation = false)), /outside refresh token rotation: enable_token_revocation/],
    ['keeping REFRESH_TOKEN_AUTH', editAfter((a) => (a.explicit_auth_flows = clientBefore.explicit_auth_flows)), /exactly the password and SRP flows/],
    ['custom auth back', editAfter((a) => (a.explicit_auth_flows = ['ALLOW_CUSTOM_AUTH', 'ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH'])), /exactly the password and SRP flows/],
    ['dropping SRP sign-in', editAfter((a) => (a.explicit_auth_flows = ['ALLOW_USER_PASSWORD_AUTH'])), /exactly the password and SRP flows/],
    ['rotation left off', editAfter((a) => (a.refresh_token_rotation = [{ feature: 'DISABLED', retry_grace_period_seconds: 60 }])), /ENABLED with a 60-second retry grace/],
    ['no rotation block', editAfter((a) => (a.refresh_token_rotation = [])), /ENABLED with a 60-second retry grace/],
    ['a different grace', editAfter((a) => (a.refresh_token_rotation = [{ feature: 'ENABLED', retry_grace_period_seconds: 0 }])), /ENABLED with a 60-second retry grace/],
    ['a different validity', editAfter((a) => (a.refresh_token_validity = 30)), /refresh_token_validity must be 3650/],
    ['the validity in hours', editAfter((a) => (a.token_validity_units = [{ access_token: 'minutes', id_token: 'minutes', refresh_token: 'hours' }])), /outside refresh token rotation: token_validity_units/],
  ]
  for (const [label, plan, pattern] of cases) {
    const result = await classify(plan)
    assert.equal(result.ok, false, `${label} must be refused`)
    assert.match(result.output, pattern, label)
  }
})

test('after the apply an empty plan reads as already applied, and apply-once refuses it', async () => {
  const result = await classify([])
  assert.equal(result.ok, true, result.output)
  assert.match(result.output, /REFRESH_ROTATION_ALREADY_APPLIED=true/)
  assert.match(script, /if grep -qx 'REFRESH_ROTATION_ALREADY_APPLIED=true' "\$WORK_DIR\/classify\.out"; then\n  echo "Refresh token rotation is already applied; nothing to apply\." >&2\n  exit 1/)
})
