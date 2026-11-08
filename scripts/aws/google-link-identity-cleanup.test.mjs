import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./google-link-identity-cleanup.sh')

test('Google link identity cleanup is guarded, plan-first, exact-count and counts-only', () => {
  assert.equal(existsSync(new URL('../../.github/workflows/aws-google-link-identity-cleanup.yml', import.meta.url)), true)
  assert.ok(['plan', 'delete-once'].includes(guardAction(read('./google-link-identity-cleanup-action.txt'))))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /GOOGLE_LINK_IDENTITY_CLEANUP_EXPECTED_SHA/)
  assert.match(script, /EXPECTED_TARGETS=5\n/)
  assert.match(script, /case "\$ACTION" in\n  plan\|delete-once\) ;;/)
  // An armed run refuses when the branch moved after it started.
  assert.match(script, /if \[\[ "\$ACTION" != "plan" \]\]; then\n  \[\[ "\$\(bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1 \| cut -f1\)" == "\$GOOGLE_LINK_IDENTITY_CLEANUP_EXPECTED_SHA" \]\]/)
  // The plan exits before anything can change; the only write is the one-row identity delete, in a transaction.
  const planAt = script.indexOf("if action == 'plan':")
  assert.ok(planAt > 0 && planAt < script.indexOf("'begin_transaction'") && planAt < script.indexOf('delete from public.identity_accounts'))
  assert.equal((script.match(/delete from /gi) || []).length, 1)
  assert.match(script, /delete from public\.identity_accounts\n\s+where id = cast\(:id as uuid\) and provider = 'cognito' and provider_subject = :subject\n\s+and profile_id = cast\(:profile as uuid\)/)
  assert.doesNotMatch(script, /admin-(delete|disable|enable|update|link|create)|update public\.|insert into/i)
  // Nothing personal in any evidence line: counts, statuses and reason codes only.
  for (const line of script.split('\n').filter((l) => /print\(f?'\{P\}_/.test(l))) {
    assert.doesNotMatch(line, /\['(email|subject|id|profile_id|username)'\]|\{row|\{user|\{attrs/, line)
  }
  const workflow = read('../../.github/workflows/aws-google-link-identity-cleanup.yml')
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /Guard cleanup against a moved branch/)
  assert.match(workflow, /export GOOGLE_LINK_IDENTITY_CLEANUP_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /grep -q 'GOOGLE_LINK_IDENTITY_CLEANUP_VERIFIED=true'/)
  assert.match(read('../../.github/workflows/aws-infra-ci.yml'), /run: node --test scripts\/aws\/google-link-identity-cleanup\.test\.mjs/)
})

// Behaviour: the script's Python block against a stub `aws` that keeps Cognito users, identity rows and Data API
// transactions in a state file.
const block = /python3 - "\$ACTION"[^\n]*<<'PY'\n([\s\S]*?)\nPY\n/.exec(script)[1]
const FAKE_AWS = `#!/usr/bin/env python3
import json, os, re, sys
path = os.environ['FAKE_AWS_STATE']
state = json.load(open(path))
a = sys.argv[1:]
def arg(name): return a[a.index(name) + 1] if name in a else None
def save(): json.dump(state, open(path, 'w'))
state['calls'].append(a[1])
if a[:2] == ['cognito-idp', 'list-users']:
    users = state['users']
    if arg('--filter'):
        sub = re.fullmatch(r'sub = "([^"]+)"', arg('--filter')).group(1)
        users = [u for u in users if any(x['Name'] == 'sub' and x['Value'] == sub for x in u['Attributes'])]
        users += [u for u in state.get('reappear', []) if any(x['Name'] == 'sub' and x['Value'] == sub for x in u['Attributes'])]
    print(json.dumps({'Users': users}))
elif a[:2] == ['rds-data', 'begin-transaction']:
    state['tx'] = json.loads(json.dumps(state['rows'])); print(json.dumps({'transactionId': 'tx-1'}))
elif a[:2] == ['rds-data', 'commit-transaction']:
    state['rows'] = state.pop('tx'); state['committed'] = True; print('{}')
elif a[:2] == ['rds-data', 'rollback-transaction']:
    state.pop('tx', None); state['rolled_back'] = True; print('{}')
elif a[:2] == ['rds-data', 'execute-statement']:
    sql = arg('--sql'); params = {p['name']: p['value']['stringValue'] for p in json.loads(arg('--parameters') or '[]')}
    rows = state['tx'] if arg('--transaction-id') else state['rows']
    if 'from public.identity_accounts ia' in sql:
        print(json.dumps({'formattedRecords': json.dumps(rows)}))
    elif sql.strip().startswith('delete from public.identity_accounts'):
        hit = [r for r in rows if r['id'] == params['id'] and r['subject'] == params['subject'] and r['profile_id'] == params['profile']
               and r['id'] not in state.get('delete_noop_ids', [])]
        for r in hit: rows.remove(r)
        print(json.dumps({'formattedRecords': '[]', 'numberOfRecordsUpdated': len(hit)}))
    elif 'select provider_subject as subject' in sql:
        print(json.dumps({'formattedRecords': json.dumps([{'subject': r['subject']} for r in rows if r['profile_id'] == params['profile']])}))
    else: sys.exit('unexpected sql')
else: sys.exit('unexpected aws call ' + ' '.join(a[:2]))
save()
`
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const cognitoUser = (sub, email, { google = [], status = 'CONFIRMED' } = {}) => ({
  Username: `u-${sub}`, UserStatus: status, Enabled: true,
  Attributes: [{ Name: 'sub', Value: sub }, { Name: 'email', Value: email },
    ...(google.length ? [{ Name: 'identities', Value: JSON.stringify(google.map((userId) => ({ providerName: 'Google', userId }))) }] : [])],
})
const identityRow = (id, profile, subject, email, { username = null, status = 'active' } = {}) =>
  ({ id: uuid(id), profile_id: uuid(profile), subject, email, username, account_status: status })

// Production-shaped data: five linked people with a dead Google row each, plus dead rows that must be kept.
function fixture({ targets = 5 } = {}) {
  const users = []
  const rows = []
  for (let i = 1; i <= targets; i += 1) {
    const native = uuid(100 + i)
    users.push(cognitoUser(native, `person${i}@x.test`, { google: [`1000${i}`] }))
    rows.push(identityRow(i, 500 + i, native, `person${i}@x.test`))
    rows.push(identityRow(20 + i, 500 + i, uuid(200 + i), `person${i}@x.test`, { username: i % 2 ? `Google_1000${i}` : null }))
  }
  // Kept: a deleted account's row; a profile with no linked Google sign-in; another email; another Google username.
  users.push(cognitoUser(uuid(301), 'plain@x.test'), cognitoUser(uuid(302), 'linked@x.test', { google: ['2000'] }))
  rows.push(identityRow(40, 600, uuid(399), 'gone@x.test', { status: 'deletion_requested' }))
  rows.push(identityRow(41, 601, uuid(301), 'plain@x.test'), identityRow(42, 601, uuid(398), 'plain@x.test'))
  rows.push(identityRow(43, 602, uuid(302), 'linked@x.test'), identityRow(44, 602, uuid(397), 'old@x.test'))
  rows.push(identityRow(45, 602, uuid(396), 'linked@x.test', { username: 'Google_9999' }))
  return { users, rows, calls: [] }
}

function run(action, state) {
  const dir = mkdtempSync(join(tmpdir(), 'google-link-cleanup-'))
  try {
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'aws'), FAKE_AWS)
    chmodSync(join(dir, 'bin', 'aws'), 0o755)
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
    const r = spawnSync('python3', ['-c', block, action, 'ap-south-1_pool', 'ap-south-1', 'arn:cluster', 'arn:secret', 'sea_n_shore', '5'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_AWS_STATE: join(dir, 'state.json') },
    })
    return { status: r.status, out: r.stdout, err: r.stderr, state: JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const noPersonalData = (text) => {
  assert.doesNotMatch(text, /@|00000000-0000-4000|Google_|1000\d/)
}

test('plan counts the five dead Google rows and the rows it keeps, and changes nothing', () => {
  const before = fixture()
  const r = run('plan', before)
  assert.equal(r.status, 0, r.err)
  noPersonalData(r.out + r.err)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_DEAD_IDENTITIES=9$/m)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_TARGETS=5$/m)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_TARGETS_BY_PROFILE_STATUS=\{"active": 5\}$/m)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_TARGETS_WITH_GOOGLE_USERNAME=3$/m)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_DEAD_KEPT=\{"email_differs": 1, "no_linked_google_sign_in": 2, "username_not_the_linked_google": 1\}$/m)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_MATCHES_EXPECTED=true$/m)
  assert.match(r.out, /GOOGLE_LINK_IDENTITY_CLEANUP_PLAN_ONLY_NO_CHANGES/)
  assert.deepEqual(r.state.rows, before.rows)
  assert.ok(!r.state.calls.some((c) => /transaction/.test(c)))
})

test('delete-once deletes exactly the five dead Google rows in one transaction and verifies', () => {
  const r = run('delete-once', fixture())
  assert.equal(r.status, 0, r.err)
  noPersonalData(r.out + r.err)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_DELETED=5$/m)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_DEAD_IDENTITIES_AFTER=4$/m)
  assert.match(r.out, /^GOOGLE_LINK_IDENTITY_CLEANUP_TARGETS_AFTER=0$/m)
  assert.match(r.out, /GOOGLE_LINK_IDENTITY_CLEANUP_VERIFIED=true/)
  assert.equal(r.state.committed, true)
  const left = new Set(r.state.rows.map((row) => row.id))
  for (let i = 1; i <= 5; i += 1) {
    assert.ok(!left.has(uuid(20 + i)), `dead Google row ${i} deleted`)
    assert.ok(left.has(uuid(i)), `working sign-in ${i} kept`)
  }
  for (const kept of [40, 41, 42, 43, 44, 45]) assert.ok(left.has(uuid(kept)), `row ${kept} kept`)
})

test('delete-once refuses and changes nothing when anything differs from the plan', () => {
  const refuses = (label, state, reason) => {
    const before = JSON.parse(JSON.stringify(state.rows))
    const r = run('delete-once', state)
    assert.notEqual(r.status, 0, label)
    assert.match(r.err, reason, label)
    assert.deepEqual(r.state.rows, before, `${label}: nothing deleted`)
    assert.notEqual(r.state.committed, true, label)
  }
  refuses('four targets, not five', fixture({ targets: 4 }), /target_count_is_not_the_expected_count/)
  refuses('six targets, not five', fixture({ targets: 6 }), /target_count_is_not_the_expected_count/)

  const back = fixture()
  back.reappear = [cognitoUser(uuid(203), 'person3@x.test')]
  refuses('a target\'s Cognito user exists again', back, /target_cognito_user_exists_again/)

  const noop = fixture()
  noop.delete_noop_ids = [uuid(24)]
  const r = run('delete-once', noop)
  assert.notEqual(r.status, 0)
  assert.match(r.err, /delete_matched_other_than_one_row/)
  assert.equal(r.state.rolled_back, true, 'the transaction is rolled back')
  assert.deepEqual(r.state.rows, fixture().rows)
})
