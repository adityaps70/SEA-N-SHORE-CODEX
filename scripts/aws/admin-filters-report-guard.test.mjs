import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

// Round GP (owner-approved 18 Nov): the read-only Members by country counts. SQL is counts only, from the app's own
// statements (scripts/aws/admin-filters-report.sql.json), each in a rolled-back READ ONLY transaction; the one write is
// a single new object under private-reports/admin-filters/. The repository is public, so the log carries PASS/FAIL and
// the checksum only.
const actionPath = 'scripts/aws/admin-filters-report-action.txt'
const workflowPath = '.github/workflows/aws-admin-filters-report.yml'
const hostPath = 'scripts/aws/admin-filters-report.sh'
const remotePath = 'scripts/aws/admin-filters-report-remote.py'
const sqlPath = 'scripts/aws/admin-filters-report.sql.json'
const read = (path) => readFileSync(path, 'utf8')

const DATA_API_READ = new Set(['begin-transaction', 'execute-statement', 'rollback-transaction'])
const NAMES = ['members', 'members_by_country', 'members_by_phone_code', 'companies', 'organization_applications', 'jobs', 'payments', 'app_country_stats', 'direct_country_counts']

function python(code) {
  const result = spawnSync('python3', ['-I', '-c', `
import importlib.util, json
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
${code}
print("ok")
`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ok\n$/)
}

test('the report is staging-only, exact-head and armed by an owner-merged guard', () => {
  for (const path of [actionPath, workflowPath, hostPath, remotePath, sqlPath]) assert.equal(existsSync(path), true, `${path} must exist`)
  const action = guardAction(read(actionPath))
  assert.ok(['plan', 'report-once'].includes(action), `Unexpected admin filters report action: ${action}`)
  const workflow = read(workflowPath)
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/admin-filters-report-action\.txt/)
  assert.match(workflow, /environment:\s*staging\n/)
  assert.match(workflow, /environment:\s*staging-apply\n/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /node --test scripts\/aws\/admin-filters-report-guard\.test\.mjs/)
  assert.match(workflow, /export ADMIN_FILTERS_REPORT_EXPECTED_SHA=\{sha\}\n\s+bash scripts\/aws\/admin-filters-report\.sh/)
  assert.match(workflow, /if \[\[ "\$ACTION" == report-once \]\]; then\n\s+grep -qx 'ADMIN_FILTERS_REPORT=PASS'/)
  assert.match(workflow, /grep -Eqx 'ADMIN_FILTERS_REPORT_SHA256=\[0-9a-f\]\{64\}'/)
  assert.match(workflow, /grep -qx 'ADMIN_FILTERS_REPORT_PLAN_ONLY_NO_REPORT'/)
  assert.match(workflow, /scripts\/aws\/admin-filters-report\.sql\.json/)
})

test('the host wrapper: plan reads nothing; report-once refuses a moved branch; stderr never reaches the log', () => {
  const host = read(hostPath)
  const plan = host.indexOf('echo "ADMIN_FILTERS_REPORT_PLAN_ONLY_NO_REPORT"')
  assert.ok(plan > 0 && plan < host.indexOf('python3 -I scripts/aws/admin-filters-report-remote.py'), 'plan exits before the report')
  assert.match(host, /plan\)\n\s+echo "ADMIN_FILTERS_REPORT_PLAN_ONLY_NO_REPORT"\n\s+exit 0/)
  assert.match(host, /report-once\)\n(?:\s+#.*\n)*\s+\[\[ "\$\(bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1 \| cut -f1\)" == "\$ADMIN_FILTERS_REPORT_EXPECTED_SHA" \]\]/)
  assert.match(host, /git diff --quiet HEAD -- \\\n(?:\s+\S+ \\\n)*\s+scripts\/aws\/admin-filters-report\.sql\.json \\\n/)
  assert.match(host, /^python3 -I scripts\/aws\/admin-filters-report-remote\.py 2>\/dev\/null$/m)
  const calls = [...host.matchAll(/\baws ([a-z0-9]+) ([a-z-]+)/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(calls)], ['sts get-caller-identity'])
})

test('every AWS call reads (describe, the Data API, head-object); one PutObject under private-reports/admin-filters/ is the only write', () => {
  const remote = read(remotePath)
  const calls = [...remote.matchAll(/aws\("([a-z0-9-]+)", "([a-z0-9-]+)"/g)].map((m) => [m[1], m[2]])
  assert.ok(calls.length >= 6)
  for (const [service, action] of calls) {
    const allowed = (service === 'rds' && action === 'describe-db-clusters') || (service === 'rds-data' && DATA_API_READ.has(action)) ||
      (service === 's3api' && action === 'head-object')
    assert.ok(allowed, `${service} ${action} is not a read-only call`)
  }
  assert.doesNotMatch(remote, /commit-transaction|delete-|put-bucket|create-|update-|secretsmanager|get-secret-value|http/i)
  assert.equal((remote.match(/subprocess\.run\(/g) ?? []).length, 2)
  const raw = [...remote.matchAll(/\["aws", "([a-z0-9]+)", "([a-z-]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(raw, ['s3api put-object'])
  assert.match(remote, /\["aws", "s3api", "put-object", "--bucket", REPORT_BUCKET, "--key", key, "--body", path,\n\s+"--server-side-encryption", "AES256"/)
  assert.match(remote, /^REPORT_BUCKET = "sea-n-shore-staging-310356785722-migration"$/m)
  assert.match(remote, /^REPORT_PREFIX = "private-reports\/admin-filters\/"$/m)
  assert.match(remote, /assert key\.startswith\(REPORT_PREFIX\) and re\.fullmatch/)
  assert.match(remote, /upload\(body, f"\{REPORT_PREFIX\}counts-\{sha\}\.json"\)/)
  assert.match(remote, /if aws\("s3api", "head-object", "--bucket", REPORT_BUCKET, "--key", key, quiet=True\) is not None:\n\s+return "exists"/)
  python(`
for key in ["private-reports/domain-move/x.json", "private-reports/admin-filters/../x.json", "other/x.json", "private-reports/admin-filters/X Y.json"]:
    try:
        r.upload(b"{}", key)
        raise SystemExit("accepted " + key)
    except AssertionError:
        pass
`)
})

test('SQL: the committed app statements only, each one read, READ ONLY and rolled back; 0108 must be applied', () => {
  const remote = read(remotePath)
  assert.match(remote, /"SET TRANSACTION READ ONLY"/)
  assert.match(remote, /"SET LOCAL statement_timeout = '60s'"/)
  assert.match(remote, /assert re\.match\(r"\^\\s\*\(select\|with\)\\b", statement, re\.I\)/)
  assert.match(remote, /finally:\n\s+aws\("rds-data", "rollback-transaction", "--resource-arn", arn, "--secret-arn", secret, "--transaction-id", txid\)/)
  assert.match(remote, /^REQUIRED_MIGRATION = "0108_member_countries"$/m)
  const statements = JSON.parse(read(sqlPath))
  assert.deepEqual(Object.keys(statements), NAMES)
  for (const [name, sql] of Object.entries(statements)) {
    assert.match(sql, /^\s*(select|with)\b/i, name)
    assert.doesNotMatch(sql, /\$[0-9]|;\s*\S/, name)
    assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop|create|grant|copy)\s/i, name)
  }
  python(`
assert r.only_counts({"top15": [{"code": "PH", "members": 3, "source": "profile"}], "unset": 1, "x": None, "INR": 2, "paid/claim": 1})
for bad in [{"name": "Asha Singh"}, {"email": "a@b.c"}, [{"code": "Mumbai, India"}], {"Asha": 1}, {"phone": "+919812345678"}, {"ok": True}]:
    assert not r.only_counts(bad), bad
checks = r.sample_checks(
    [{"code": "IN", "registered": 40, "estimated": 10, "organizations": 3}, {"code": "PH", "registered": 12, "estimated": 2, "organizations": 5},
     {"code": "", "registered": 99, "estimated": 99, "organizations": 1}, {"code": "AE", "registered": 5, "estimated": 0, "organizations": 0},
     {"code": "SG", "registered": 1, "estimated": 0, "organizations": 0}],
    {"chosen_members": {"IN": 30, "PH": 9, "AE": 5}, "organizations": {"IN": 3, "PH": 5}})
assert [c["code"] for c in checks] == ["IN", "PH", "AE"], checks
assert [c["match"] for c in checks] == [True, False, True], checks
`)
})

// A fake aws CLI: answers the Data API from canned JSON by statement name, writes the one upload, records every call.
const FAKE_AWS = String.raw`#!/usr/bin/env python3
import json, os, shutil, sys
args = sys.argv[1:]
with open(os.environ["FAKE_AWS_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")
service, action = args[0], args[1]
def opt(name):
    return args[args.index(name) + 1] if name in args else None
def reply(value):
    print(json.dumps(value)); sys.exit(0)
upload = os.environ["FAKE_AWS_UPLOAD"]
if (service, action) == ("s3api", "head-object"):
    if not os.path.exists(upload):
        sys.stderr.write("An error occurred (404) when calling the HeadObject operation: Not Found\n"); sys.exit(254)
    reply({"ServerSideEncryption": "AES256", "ContentLength": os.path.getsize(upload)})
if (service, action) == ("s3api", "put-object"):
    shutil.copy(opt("--body"), upload)
    reply({"ETag": "x", "ServerSideEncryption": "AES256"})
if (service, action) == ("rds", "describe-db-clusters"):
    reply({"DBClusters": [{"DBClusterArn": "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora", "MasterUserSecret": {"SecretArn": "arn:secret"}}]})
if (service, action) == ("rds-data", "begin-transaction"):
    reply({"transactionId": "tx1"})
if (service, action) == ("rds-data", "execute-statement"):
    sql = opt("--sql")
    if sql.startswith("SET "):
        reply({})
    if "sea_n_shore_applied_migrations" in sql:
        reply({"records": [[{"longValue": int(os.environ.get("FAKE_MIGRATION_APPLIED", "1"))}]]})
    statements = json.load(open("scripts/aws/admin-filters-report.sql.json"))
    name = next(n for n, s in statements.items() if s == sql)
    answers = json.loads(os.environ["FAKE_ANSWERS"])
    reply({"records": [[{"stringValue": json.dumps(answers[name])}]]})
reply({})
`

const ANSWERS = {
  members: { registered: 55, verified: 7, location_filled: 30, time_zone_set: 50, country_of_residence_set: 20, nationality_set: 9, phone_any: 25, phone_verified: 20, signup_country_recorded: 4, session_country_known: 48 },
  members_by_country: { top15: [{ code: 'IN', members: 40, chosen: 30, from_location: 5, from_phone: 4, from_signup: 1 }, { code: 'PH', members: 12, chosen: 10, from_location: 2, from_phone: 0, from_signup: 0 }], countries: 2, unset: 3 },
  members_by_phone_code: { top15: [{ dialling_code: '+91', code: 'IN', members: 20 }], members_with_phone_code: 20 },
  companies: { total: 9, claimed: 7, unclaimed: 2, verified: 5, office_locations_filled: 8, organization_details_filled: 6, country_set: 8, by_country_top15: [{ code: 'IN', organizations: 3 }] },
  organization_applications: { 'pending/registration': 2, 'approved/claim': 1 },
  jobs: { live: 8, live_organization: 7, live_personal: 1 },
  payments: { subscription_payments: { INR: 4 }, event_orders: { 'INR/paid': 2 }, course_orders: {} },
  app_country_stats: [{ code: 'IN', registered: 40, verified: 6, new_week: 2, new_month: 9, estimated: 10, organizations: 3, active_jobs: 7 }, { code: 'PH', registered: 12, verified: 1, new_week: 0, new_month: 1, estimated: 2, organizations: 5, active_jobs: 1 }, { code: '', registered: 3, verified: 0, new_week: 0, new_month: 0, estimated: 0, organizations: 1, active_jobs: 0 }],
  direct_country_counts: { chosen_members: { IN: 30, PH: 10 }, organizations: { IN: 3, PH: 5 } },
}

function runReport(dir, overrides = {}) {
  const env = {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_AWS_LOG: join(dir, 'calls.log'), FAKE_AWS_UPLOAD: join(dir, 'upload.json'),
    ADMIN_FILTERS_REPORT_EXPECTED_SHA: 'b'.repeat(40), FAKE_ANSWERS: JSON.stringify(overrides.answers ?? ANSWERS), ...overrides.env,
  }
  return spawnSync('python3', ['-I', remotePath], { env, encoding: 'utf8' })
}

function fakeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'admin-filters-report-'))
  writeFileSync(join(dir, 'aws'), FAKE_AWS)
  chmodSync(join(dir, 'aws'), 0o755)
  return dir
}

test('end to end against a fake: one new SSE object, PASS and the checksum only on stdout, counts only inside', () => {
  const dir = fakeDir()
  const result = runReport(dir)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stderr, '')
  const lines = result.stdout.trim().split('\n')
  assert.equal(lines.length, 2, result.stdout)
  assert.match(lines[0], /^ADMIN_FILTERS_REPORT_SHA256=[0-9a-f]{64}$/)
  assert.equal(lines[1], 'ADMIN_FILTERS_REPORT=PASS')
  const body = readFileSync(join(dir, 'upload.json'))
  assert.equal(lines[0].split('=')[1], createHash('sha256').update(body).digest('hex'), 'the printed checksum is the uploaded body')
  const report = JSON.parse(body.toString())
  assert.deepEqual(report.counts.members_by_country.top15.map((entry) => entry.code), ['IN', 'PH'])
  assert.deepEqual(report.counts.sample_country_checks.map((check) => [check.code, check.match]), [['IN', true], ['PH', true]])

  const calls = read(join(dir, 'calls.log')).trim().split('\n').map((line) => JSON.parse(line))
  const writes = calls.filter(([service, action]) => !((service === 'rds-data' && DATA_API_READ.has(action)) || action === 'head-object' || action === 'describe-db-clusters'))
  assert.equal(writes.length, 1, JSON.stringify(writes))
  const [put] = writes
  assert.deepEqual(put.slice(0, 2), ['s3api', 'put-object'])
  assert.equal(put[put.indexOf('--bucket') + 1], 'sea-n-shore-staging-310356785722-migration')
  assert.equal(put[put.indexOf('--key') + 1], `private-reports/admin-filters/counts-${'b'.repeat(40)}.json`)
  assert.equal(put[put.indexOf('--server-side-encryption') + 1], 'AES256')
  assert.equal(calls.filter(([s, a]) => s === 'rds-data' && a === 'begin-transaction').length,
    calls.filter(([s, a]) => s === 'rds-data' && a === 'rollback-transaction').length)
  assert.equal(calls.filter(([s, a]) => s === 'rds-data' && a === 'begin-transaction').length, NAMES.length + 1)

  // Never an overwrite.
  const again = runReport(dir)
  assert.equal(again.status, 1)
  assert.equal(again.stdout.trim(), 'ADMIN_FILTERS_REPORT=FAIL stage=put-object result=exists')
})

test('refuses to write when 0108 is not applied, or when an answer holds anything but counts and codes', () => {
  const unapplied = fakeDir()
  const early = runReport(unapplied, { env: { FAKE_MIGRATION_APPLIED: '0' } })
  assert.equal(early.status, 1)
  assert.equal(early.stdout.trim(), 'ADMIN_FILTERS_REPORT=FAIL stage=migration')
  assert.equal(existsSync(join(unapplied, 'upload.json')), false)

  const leaky = fakeDir()
  const answers = { ...ANSWERS, members_by_country: { top15: [{ code: 'IN', members: 1, name: 'Asha Singh' }], countries: 1, unset: 0 } }
  const refused = runReport(leaky, { answers })
  assert.equal(refused.status, 1)
  assert.equal(refused.stdout.trim(), 'ADMIN_FILTERS_REPORT=FAIL stage=content')
  assert.equal(existsSync(join(leaky, 'upload.json')), false)
  assert.ok(!refused.stdout.includes('Asha'))
})
