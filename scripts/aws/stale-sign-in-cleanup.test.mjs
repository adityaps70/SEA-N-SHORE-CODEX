import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// Deletes ONE stale identity_accounts row (Cognito user gone, active profile that keeps another working sign-in).
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./stale-sign-in-cleanup.sh')
const workflow = read('../../.github/workflows/aws-stale-sign-in-cleanup.yml')
const block = /<<'PY'\n([\s\S]*?)\nPY\n/.exec(script)[1]

test('guarded, plan by default, pinned, exact-head, approval and arm guard', () => {
  assert.ok(['plan', 'delete-once'].includes(guardAction(read('./stale-sign-in-cleanup-action.txt'))))
  assert.match(script, /case "\$ACTION" in plan\|delete-once\) ;;/)
  assert.match(script, /PINNED_IDENTITY_PREFIX="(?:[0-9a-f]{8})?"/)
  assert.match(script, /PINNED_PROFILE_PREFIX="(?:[0-9a-f]{8})?"/)
  assert.match(script, /delete-once needs the row pinned/)
  assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
  // Exactly one delete statement, on identity_accounts only, bound to id + subject + profile.
  assert.equal((script.match(/\bdelete from\b/gi) || []).length, 1)
  assert.match(script, /delete from public\.identity_accounts\n\s+where id = cast\(:id as uuid\) and provider = 'cognito' and provider_subject = :subject and profile_id = cast\(:profile as uuid\)/)
  assert.doesNotMatch(script, /\bupdate public\.|admin-delete-user|admin-disable-user|drop |truncate /i)
  // Output shows only 8-character id prefixes.
  for (const line of script.split('\n').filter((l) => /print\('STALE_SIGN_IN_(CANDIDATE|CLEANUP_DELETED)/.test(l))) {
    assert.match(line, /\[:8\]/)
  }
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /case "\$ACTION" in plan\|delete-once\) ;;/)
})

// ---- Behaviour on a stubbed AWS CLI (Cognito users + identity_accounts rows) ----
const AWS = `#!/usr/bin/env python3
import json, os, sys
db_path = os.environ['STUB_DB']
db = json.load(open(db_path))
args = sys.argv[1:]
def opt(name):
    return args[args.index(name) + 1] if name in args else None
def save(): json.dump(db, open(db_path, 'w'))
if args[0] == 'cognito-idp':
    print(json.dumps({'Users': [{'Username': s, 'Attributes': [{'Name': 'sub', 'Value': s}]} for s in db['cognito']]})); sys.exit()
cmd = args[1]
if cmd == 'begin-transaction': print(json.dumps({'transactionId': 't1'})); sys.exit()
if cmd == 'commit-transaction': db['committed'] = True; save(); print('{}'); sys.exit()
if cmd == 'rollback-transaction': db['rolled_back'] = True; save(); sys.exit()
sql = opt('--sql'); params = {p['name']: p['value']['stringValue'] for p in json.loads(opt('--parameters') or '[]')}
db.setdefault('sql', []).append(sql.split()[0].lower()); save()
if 'from public.identity_accounts ia' in sql:
    rows = [{'id': r['id'], 'profile_id': r['profile'], 'subject': r['subject'], 'status': db['status'].get(r['profile'], 'missing')} for r in db['rows']]
    print(json.dumps({'formattedRecords': json.dumps(rows)}))
elif sql.strip().startswith('delete from public.identity_accounts'):
    hit = [r for r in db['rows'] if r['id'] == params['id'] and r['subject'] == params['subject'] and r['profile'] == params['profile']]
    db['rows'] = [r for r in db['rows'] if r not in hit]; save()
    print(json.dumps({'formattedRecords': json.dumps([{'id': r['id']} for r in hit]), 'numberOfRecordsUpdated': len(hit)}))
elif 'insert into public.audit_events' in sql:
    db.setdefault('ledger', []).append(params['id']); save()
    print(json.dumps({'formattedRecords': '[]', 'numberOfRecordsUpdated': 1}))
else:
    sys.exit(3)
`
const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const P2 = 'bbbbbbbb-0000-0000-0000-000000000002'
const STALE = 'cccccccc-0000-0000-0000-00000000000c'
const baseDb = () => ({
  cognito: ['s-live-1', 's-live-2'],
  status: { [P1]: 'active', [P2]: 'active' },
  rows: [
    { id: 'dddddddd-0000-0000-0000-00000000000d', profile: P1, subject: 's-live-1' },
    { id: STALE, profile: P1, subject: 's-gone' },
    { id: 'eeeeeeee-0000-0000-0000-00000000000e', profile: P2, subject: 's-live-2' },
  ],
})

function run(action, db, pin = ['cccccccc', 'aaaaaaaa']) {
  const root = mkdtempSync(join(tmpdir(), 'stale-sign-in-'))
  try {
    mkdirSync(join(root, 'bin'))
    writeFileSync(join(root, 'bin/aws'), AWS, { mode: 0o755 })
    writeFileSync(join(root, 'db.json'), JSON.stringify(db))
    const r = spawnSync('python3', ['-c', block, action, 'ap-south-1_x', 'ap-south-1', 'arn:c', 'arn:s', 'db', ...pin], {
      encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, STUB_DB: join(root, 'db.json') },
    })
    return { ...r, db: JSON.parse(readFileSync(join(root, 'db.json'), 'utf8')) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('plan lists the one stale row (masked) and counts; changes nothing', () => {
  const r = run('plan', baseDb())
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /STALE_SIGN_IN_CANDIDATE=\{"identity": "cccccccc", "profile": "aaaaaaaa", "profile_working_sign_ins": 1, "status": "active"\}/)
  assert.match(r.stdout, /STALE_SIGN_IN_COUNTS_BEFORE=\{"identity_rows": 3, "profile_rows": 2, "profile_working_sign_ins": 1, "rows_without_cognito_user": 1, "stale_candidates": 1\}/)
  assert.equal(r.db.rows.length, 3)
  assert.deepEqual(r.db.sql, ['select'])
  assert.doesNotMatch(r.stdout, /s-gone|s-live|0000-0000/)
})

test('delete-once removes exactly the pinned row in one transaction, with a ledger row and after-counts', () => {
  const r = run('delete-once', baseDb())
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.db.rows.map((x) => x.id).sort(), ['dddddddd-0000-0000-0000-00000000000d', 'eeeeeeee-0000-0000-0000-00000000000e'])
  assert.equal(r.db.committed, true)
  assert.deepEqual(r.db.ledger, [STALE])
  assert.match(r.stdout, /STALE_SIGN_IN_COUNTS_AFTER=\{"identity_rows": 2, "profile_rows": 1, "profile_working_sign_ins": 1, "rows_without_cognito_user": 0, "stale_candidates": 0\}/)
  assert.match(r.stdout, /STALE_SIGN_IN_CLEANUP_DELETED=\{"identity": "cccccccc", "profile": "aaaaaaaa"\}/)
  // A second run finds nothing to do.
  const again = run('delete-once', r.db)
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /STALE_SIGN_IN_CLEANUP_ALREADY_DONE=true/)
})

test('delete-once refuses anything but the single pinned stale row', () => {
  const refuse = (label, db, reason, pin) => {
    const r = run('delete-once', db, pin)
    assert.notEqual(r.status, 0, label)
    assert.match(r.stderr, reason, label)
    assert.equal(r.db.rows.length, db.rows.length, `${label}: nothing deleted`)
  }
  refuse('another row is pinned', baseDb(), /not the pinned row/, ['ffffffff', 'aaaaaaaa'])
  refuse('another profile is pinned', baseDb(), /not the pinned row/, ['cccccccc', 'bbbbbbbb'])
  const two = baseDb()
  two.rows.push({ id: 'cccccccd-0000-0000-0000-00000000000f', profile: P2, subject: 's-gone-2' })
  refuse('two stale rows', two, /2 stale candidates/)
})

test('rows on deleted/suspended profiles, or the last sign-in of a profile, are never candidates', () => {
  const db = baseDb()
  db.status[P1] = 'deletion_requested'
  const deleted = run('plan', db)
  assert.match(deleted.stdout, /"stale_candidates": 0/)
  const lastSignIn = baseDb()
  lastSignIn.cognito = ['s-live-2']
  const r = run('plan', lastSignIn)
  assert.match(r.stdout, /"stale_candidates": 0/)
  assert.match(r.stdout, /"rows_without_cognito_user": 2/)
})
