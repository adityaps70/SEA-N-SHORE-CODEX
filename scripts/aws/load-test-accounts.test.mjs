// Round ARCH (Phase 1): the load-test accounts runner contract. It runs the accounts worker from the deployed web
// image, behind an owner-merged arm for anything but plan, and prints counts and statuses only.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./load-test-accounts.sh')
const workflow = read('../../.github/workflows/aws-load-test-accounts.yml')
const worker = read('../workers/load-test-accounts.ts')
const service = read('../../src/features/load-test/accounts.ts')

test('the guard reads plan, create-once or delete-once', () => {
  assert.ok(['plan', 'create-once', 'delete-once'].includes(guardAction(read('./load-test-accounts-action.txt'))))
})

test('the runner starts only the accounts worker from the web task, in the staging account, from an unmoved branch', () => {
  assert.match(script, /WORKER="dist\/workers\/load-test-accounts\.mjs"/)
  assert.match(script, /containerOverrides:\[\{name:"web",command:\["node",\$worker\],environment:\$environment\}\]/)
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /case "\$ACTION" in plan\|create-once\|delete-once\) ;;/)
  assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(script, /grep -oE 'LOAD_TEST_ACCOUNTS_\[A-Z_\]\+/)
  for (const line of ['LOAD_TEST_ACCOUNTS_PLAN_ONLY_NO_CHANGE', 'LOAD_TEST_ACCOUNTS_CREATE_ONCE_VERIFIED=true', 'LOAD_TEST_ACCOUNTS_DELETE_ONCE_VERIFIED=true']) {
    assert.ok(script.includes(`echo "${line}"`), line)
    assert.ok(workflow.includes(`'^${line}$'`), line)
  }
})

test('the workflow needs the owner-merged arm and staging-apply, and a deployed image with the worker', () => {
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/load-test-accounts-action\.txt\n\s+shell: bash\n\s+run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /git cat-file -e "\$IMAGE_SHA:scripts\/workers\/load-test-accounts\.ts"/)
  assert.match(workflow, /bash scripts\/aws\/load-test-accounts\.sh/)
})

test('the worker and service never print an address, name, password or token, and never email anyone', () => {
  assert.match(worker, /MessageAction: 'SUPPRESS'/)
  assert.match(service, /LOAD_TEST_EMAIL_DOMAIN = 'loadtest\.seanshore\.invalid'/)
  const logged = [...service.matchAll(/deps\.log\(`([^`]*)`\)/g)].map((match) => match[1])
  assert.ok(logged.length >= 6, `found ${logged.length} templated log lines`)
  for (const line of logged) assert.doesNotMatch(line, /\$\{(email|password|tokens?|activation|name)/, line)
  assert.match(service, /const sealed = encryptSessions\(result, publicKeyPem\)/)
  assert.doesNotMatch(worker, /console\.(log|info)\((?!line\))/)
  // Deleting refuses a flagged profile that is not one of the test addresses, and deletes only flagged rows.
  assert.match(service, /throw new Error\('load_test_flag_on_real_account'\)/)
  assert.match(service, /delete from public\.profiles where id = \$1 and is_load_test returning id/)
})

test('Cognito sends no email or SMS for the test accounts, and the clean-up empties Cognito too', () => {
  // Created by an administrator with Cognito's message suppressed and the address already verified, so the pool's
  // automatic email verification sends no code; the password is set as permanent (confirmed, no message).
  assert.match(worker, /new AdminCreateUserCommand\(\{\s+UserPoolId: poolId,\s+Username: email,\s+MessageAction: 'SUPPRESS',/)
  assert.match(worker, /\{ Name: 'email_verified', Value: 'true' \}/)
  assert.match(worker, /new AdminSetUserPasswordCommand\(\{ UserPoolId: poolId, Username: email, Password: password, Permanent: true \}\)/)
  // Never the self-service flows that send codes, and no attribute change that would trigger a new verification.
  assert.doesNotMatch(worker, /SignUpCommand|ConfirmSignUp|ResendConfirmationCode|ForgotPassword|AdminResetUserPassword|UpdateUserAttributes|GetUserAttributeVerificationCode/)
  // The pool has no SMS set up and only optional authenticator-app MFA, so a password sign-in raises no message.
  const auth = read('../../infra/aws/app/auth.tf')
  assert.match(auth, /mfa_configuration\s+= "OPTIONAL"/)
  assert.doesNotMatch(auth, /sms_configuration\s*\{|email_mfa_configuration/)
  // Admin-created users pass the pre-sign-up trigger untouched, and the email sender Lambda skips .invalid anyway.
  assert.match(read('../../infra/aws/app/lambda/cognito-pre-sign-up-link.mjs'), /if \(event\?\.triggerSource === 'PreSignUp_SignUp'\)/)
  assert.match(read('../../infra/aws/app/lambda/cognito-resend-email-sender.mjs'), /const RESERVED_TLDS = new Set\(\['test', 'example', 'invalid', 'localhost'\]\)/)
  // Clean-up deletes every test address from Cognito, re-checks it, and reports both counts.
  assert.match(worker, /new AdminDeleteUserCommand\(\{ UserPoolId: poolId, Username: email \}\)/)
  assert.match(service, /LOAD_TEST_ACCOUNTS_DELETED profiles=\$\{deleted\} cognito_users=\$\{cognitoDeleted\} cognito_users_left=\$\{cognitoLeft\}/)
  assert.match(service, /cognitoLeft !== 0\) throw new Error\('load_test_delete_incomplete'\)/)
})

// Run 42486602879: the sessions log spans several pages, and the first read was only its start.
test('the task log is read across every page, and the runner waits for the task\'s last line', () => {
  const fn = /\nread_task_log\(\) \{\n[\s\S]*?\n\}\n/.exec(script)?.[0]
  assert.ok(fn, 'read_task_log is defined')
  assert.match(script, /grep -qE 'LOAD_TEST_\[A-Z_\]\+_VERIFIED=true\|LOAD_TEST_ACCOUNTS_FAILED' <<<"\$LOGS" && break/)
  assert.doesNotMatch(script, /\[\[ -n "\$LOGS" \]\] && break/)
  const dir = mkdtempSync(join(tmpdir(), 'task-log-'))
  try {
    // A fake aws CLI: three pages, the last returning its own token again (the end of the stream).
    const pages = {
      '': { events: [{ message: 'LOAD_TEST_SESSIONS_SEALED_PART 1/2 aaa' }], nextForwardToken: 'f/1' },
      'f/1': { events: [{ message: 'LOAD_TEST_SESSIONS_SEALED_PART 2/2 bbb' }], nextForwardToken: 'f/2' },
      'f/2': { events: [{ message: 'LOAD_TEST_SESSIONS_VERIFIED=true' }], nextForwardToken: 'f/3' },
      'f/3': { events: [], nextForwardToken: 'f/3' },
    }
    writeFileSync(join(dir, 'pages.json'), JSON.stringify(pages))
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
token=""; while [[ $# -gt 0 ]]; do [[ "$1" == --next-token ]] && token="$2"; shift; done
jq -c --arg t "$token" '.[$t]' "${dir}/pages.json"
`)
    chmodSync(join(dir, 'aws'), 0o755)
    const run = spawnSync('bash', ['-c', `set -euo pipefail\nAWS_REGION=x LOG_GROUP=g LOG_STREAM=s\n${fn}read_task_log`], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.stdout.trim().split('\n'), ['LOAD_TEST_SESSIONS_SEALED_PART 1/2 aaa', 'LOAD_TEST_SESSIONS_SEALED_PART 2/2 bbb', 'LOAD_TEST_SESSIONS_VERIFIED=true'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
