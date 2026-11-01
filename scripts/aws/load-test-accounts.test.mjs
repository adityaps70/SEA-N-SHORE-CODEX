// Round ARCH (Phase 1): the load-test accounts runner contract. It runs the accounts worker from the deployed web
// image, behind an owner-merged arm for anything but plan, and prints counts and statuses only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
