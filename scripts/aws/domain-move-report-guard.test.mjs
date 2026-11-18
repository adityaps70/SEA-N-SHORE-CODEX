import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

// Domain move (seanshore.net), Phase 0 (owner-approved 17 Nov): one read-only inventory. Every AWS call describes,
// gets or lists; SQL is counts only in a rolled-back READ ONLY transaction; Resend is GET only; the one write is a
// single new object under private-reports/domain-move/. The repository is public, so the log carries PASS/FAIL and the
// checksum only.
const actionPath = 'scripts/aws/domain-move-report-action.txt'
const workflowPath = '.github/workflows/aws-domain-move-report.yml'
const hostPath = 'scripts/aws/domain-move-report.sh'
const remotePath = 'scripts/aws/domain-move-report-remote.py'
const read = (path) => readFileSync(path, 'utf8')

const READ_ONLY_ACTION = /^(describe|get|list)-[a-z-]+$/
const DATA_API_READ = new Set(['begin-transaction', 'execute-statement', 'rollback-transaction'])
const ZONES = ['seanshore.net', 'seanshore.in', 'seaandshore.in', 'seanshore.ph', 'seanshore.nl', 'seanshore.si', 'seaandshore.si']
const OUT_OF_SCOPE = ['snsit.si', 'nilobs.com', 'selfstreak.com', 'seanshore.com']

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
  return result.stdout
}

test('the report is staging-only, exact-head and armed by an owner-merged guard', () => {
  for (const path of [actionPath, workflowPath, hostPath, remotePath]) assert.equal(existsSync(path), true, `${path} must exist`)
  const action = guardAction(read(actionPath))
  assert.ok(['plan', 'report-once'].includes(action), `Unexpected domain move report action: ${action}`)
  const workflow = read(workflowPath)
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/domain-move-report-action\.txt/)
  assert.match(workflow, /environment:\s*staging\n/)
  assert.match(workflow, /environment:\s*staging-apply\n/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /node --test scripts\/aws\/domain-move-report-guard\.test\.mjs/)
  assert.match(workflow, /export DOMAIN_MOVE_REPORT_EXPECTED_SHA=\{sha\}\n\s+bash scripts\/aws\/domain-move-report\.sh/)
  // The run passes only on its own evidence lines.
  assert.match(workflow, /if \[\[ "\$ACTION" == report-once \]\]; then\n\s+grep -qx 'DOMAIN_MOVE_REPORT=PASS'/)
  assert.match(workflow, /grep -Eqx 'DOMAIN_MOVE_REPORT_SHA256=\[0-9a-f\]\{64\}'/)
  assert.match(workflow, /grep -qx 'DOMAIN_MOVE_REPORT_PLAN_ONLY_NO_REPORT'/)
  assert.doesNotMatch(workflow, /resend-delivery-webhook|RESEND_DELIVERY/)
})

test('the host wrapper: plan reads nothing; report-once refuses a moved branch; stderr never reaches the log', () => {
  const host = read(hostPath)
  const plan = host.indexOf('echo "DOMAIN_MOVE_REPORT_PLAN_ONLY_NO_REPORT"')
  assert.ok(plan > 0 && plan < host.indexOf('python3 -I scripts/aws/domain-move-report-remote.py'), 'plan exits before the report')
  assert.match(host, /plan\)\n\s+echo "DOMAIN_MOVE_REPORT_PLAN_ONLY_NO_REPORT"\n\s+exit 0/)
  assert.match(host, /report-once\)\n(?:\s+#.*\n)*\s+\[\[ "\$\(bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1 \| cut -f1\)" == "\$DOMAIN_MOVE_REPORT_EXPECTED_SHA" \]\]/)
  assert.match(host, /^python3 -I scripts\/aws\/domain-move-report-remote\.py 2>\/dev\/null$/m)
  const calls = [...host.matchAll(/\baws ([a-z0-9]+) ([a-z-]+)/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(calls)], ['sts get-caller-identity'])
})

test('every AWS call in the report describes, gets or lists (or reads through the Data API); one PutObject is the only write', () => {
  const remote = read(remotePath)
  const calls = [...remote.matchAll(/aws\("([a-z0-9-]+)", "([a-z0-9-]+)"/g)].map((m) => [m[1], m[2]])
  assert.ok(calls.length > 40, `the report makes its AWS calls through aws(), found ${calls.length}`)
  for (const [service, action] of calls) {
    const allowed = READ_ONLY_ACTION.test(action) || (service === 'rds-data' && DATA_API_READ.has(action)) ||
      (service === 's3api' && action === 'head-object')
    assert.ok(allowed, `${service} ${action} is not a read-only call`)
  }
  assert.doesNotMatch(remote, /commit-transaction|delete-|put-bucket|create-|update-|import-|request-certificate|change-resource-record-sets/)
  // Exactly two commands run: aws() and the single upload.
  assert.equal((remote.match(/subprocess\.run\(/g) ?? []).length, 2)
  const raw = [...remote.matchAll(/\["aws", "([a-z0-9]+)", "([a-z-]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(raw, ['s3api put-object'])
  assert.match(remote, /\["aws", "s3api", "put-object", "--bucket", REPORT_BUCKET, "--key", key, "--body", path,\n\s+"--server-side-encryption", "AES256"/)
  assert.match(remote, /^REPORT_BUCKET = "sea-n-shore-staging-310356785722-migration"$/m)
  assert.match(remote, /^REPORT_PREFIX = "private-reports\/domain-move\/"$/m)
  assert.match(remote, /assert key\.startswith\(REPORT_PREFIX\)/)
  // Never an overwrite.
  assert.match(remote, /if aws\("s3api", "head-object", "--bucket", REPORT_BUCKET, "--key", key, quiet=True\) is not None:\n\s+return "exists"/)
  // Resend: GET only.
  assert.match(remote, /method="GET"/)
  assert.doesNotMatch(remote, /method="(POST|PUT|PATCH|DELETE)"|\/verify/)
})

test('SQL is counts only, read-only and rolled back', () => {
  const remote = read(remotePath)
  assert.match(remote, /"SET TRANSACTION READ ONLY"/)
  assert.match(remote, /"SET LOCAL statement_timeout = '30s'"/)
  assert.match(remote, /assert re\.match\(r"\^\\s\*\(select\|with\)\\b", statement, re\.I\)/)
  assert.match(remote, /finally:\n\s+aws\("rds-data", "rollback-transaction", "--resource-arn", arn, "--secret-arn", secret, "--transaction-id", txid\)/)
  assert.doesNotMatch(remote, /select[^"\n]*\b(email|full_name|phone|slug|username|body|content)\b/i)
  python(`
s = r.count_statement("posts")
assert s == "select count(*), count(*) filter (where t::text ~* 'seanshore\\\\.in([^a-z0-9]|$)'), count(*) filter (where t::text ~* 'seaandshore\\\\.in([^a-z0-9]|$)') from public.posts t", s
try:
    r.count_statement("posts; drop table x")
    raise SystemExit("unsafe table name accepted")
except AssertionError:
    pass
`)
})

test('the seven zones of the move are described; other businesses are only counted', () => {
  const remote = read(remotePath)
  python(`assert r.IN_SCOPE_ZONES == ${JSON.stringify(ZONES)}, r.IN_SCOPE_ZONES`)
  for (const name of OUT_OF_SCOPE) assert.ok(!remote.includes(name), `${name} must not appear in the report code`)
  assert.match(remote, /if name not in IN_SCOPE_ZONES:\n\s+out\["out_of_scope_zone_count"\] \+= 1\n\s+continue/)
})

test('secrets and member data never enter the report', () => {
  python(`
c = r.strip_custom_headers({"Origins": {"Items": [{"Id": "a", "CustomHeaders": {"Quantity": 2, "Items": [
    {"HeaderName": "X-Origin-Verify", "HeaderValue": "s3cr3tvalue"}, {"HeaderName": "X-Forwarded-Host", "HeaderValue": "x"}]}}]}})
assert "s3cr3tvalue" not in json.dumps(c), c
assert c["Origins"]["Items"][0]["CustomHeaders"] == {"Quantity": 2, "Names": ["X-Forwarded-Host", "X-Origin-Verify"]}
e = r.picked_env({"NEXT_PUBLIC_SITE_URL": "https://seanshore.in", "AURORA_PASSWORD": "pw", "RESEND_API_KEY": "re_x seanshore.in",
                  "OTHER": "https://seanshore.in/x", "PLAIN": "1"})
assert e == {"NEXT_PUBLIC_SITE_URL": "https://seanshore.in", "OTHER": "https://seanshore.in/x"}, e
s = r.extract_state({"serial": 9, "resources": [
    {"mode": "managed", "type": "aws_route53_record", "name": "x", "instances": [{"attributes": {"zone_id": "Z1", "name": "a.seanshore.in", "type": "A", "fqdn": "a.seanshore.in", "records": ["1.2.3.4"]}}]},
    {"mode": "managed", "type": "random_password", "name": "origin_verify", "instances": [{"attributes": {"result": "TOPSECRET"}}]},
    {"mode": "managed", "type": "aws_cloudfront_distribution", "name": "app", "instances": [{"attributes": {"id": "E1", "aliases": ["seanshore.in"], "origin": [{"custom_header": [{"value": "TOPSECRET"}]}]}}]}]})
assert "TOPSECRET" not in json.dumps(s), s
assert s["resources"][0] == {"address": "aws_route53_record.x", "zone_id": "Z1", "name": "a.seanshore.in", "type": "A", "fqdn": "a.seanshore.in", "set_identifier": None}
assert r.scrub("AccessDenied for arn:aws:iam::310356785722:role/x key re_abc123") == "AccessDenied for [arn] key [key]"
`)
})

test('untracked records, WAF host rules and the receiving MX are worked out correctly', () => {
  python(`
live = [{"Name": "seanshore.in.", "Type": "NS"}, {"Name": "seanshore.in.", "Type": "SOA"},
        {"Name": "seanshore.in.", "Type": "A", "AliasTarget": {}}, {"Name": "_dmarc.seanshore.in.", "Type": "TXT"},
        {"Name": "send.mail.seanshore.in.", "Type": "MX"}, {"Name": "\\\\052.seanshore.in.", "Type": "CNAME"}]
state = [{"address": "aws_route53_record.a", "zone_id": "Z1", "name": "seanshore.in", "type": "A", "fqdn": "seanshore.in"},
         {"address": "aws_route53_record.d", "zone_id": "Z1", "name": "_dmarc.seanshore.in", "type": "TXT", "fqdn": "_dmarc.seanshore.in"},
         {"address": "aws_route53_record.o", "zone_id": "Z2", "name": "send.mail.seanshore.in", "type": "MX"}]
u = r.untracked_records("Z1", "seanshore.in", live, state)
assert u == [{"name": "send.mail.seanshore.in", "type": "MX", "alias": False}, {"name": "*.seanshore.in", "type": "CNAME", "alias": False}], u
k = r.match_kinds({"OrStatement": {"Statements": [{"ByteMatchStatement": {"FieldToMatch": {"UriPath": {}}}},
                   {"ByteMatchStatement": {"FieldToMatch": {"SingleHeader": {"Name": "Host"}}}}]}})
assert sorted(k) == ["SingleHeader:host", "UriPath"], k
rep = {"route53": {"in_scope": {"seanshore.in": [{"records": [{"Name": "send.mail.seanshore.in.", "Type": "MX"}]}]}},
       "resend": {"domains": {"mail.seanshore.in": {"records": [{"record": "SPF", "type": "MX"}, {"record": "DKIM", "type": "TXT"}]}}}}
assert r.receiving_mx(rep) == {"route53": False, "resend": False}
rep["resend"]["domains"]["mail.seanshore.in"]["records"].append({"record": "Receiving", "type": "MX"})
assert r.receiving_mx(rep) == {"route53": False, "resend": True}
`)
})

// A fake aws CLI: answers from canned JSON, writes the files the real one writes, records every call, and keeps the
// one uploaded body. The report then runs end to end against it and a local fake of Resend and the DNS resolvers.
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
if (service, action) == ("s3api", "get-object"):
    with open(args[args.index("--key") + 2], "w") as f:
        json.dump({"lineage": "197a6fae-9997-636e-e52b-c3ac6da85d90", "serial": 7, "resources": [
            {"mode": "managed", "type": "aws_route53_zone", "name": "seanshore", "instances": [{"attributes": {"zone_id": "ZIN", "name": "seanshore.in"}}]},
            {"mode": "managed", "type": "aws_cloudfront_distribution", "name": "app", "instances": [{"attributes": {"id": "EAPP", "aliases": ["seanshore.in"]}}]},
            {"mode": "managed", "type": "random_password", "name": "origin_verify", "instances": [{"attributes": {"result": "STATESECRET"}}]}]}, f)
    reply({})
if (service, action) == ("s3api", "head-object"):
    if not os.path.exists(upload):
        sys.stderr.write("An error occurred (404) when calling the HeadObject operation: Not Found\n"); sys.exit(254)
    reply({"ServerSideEncryption": "AES256", "ContentLength": os.path.getsize(upload)})
if (service, action) == ("s3api", "put-object"):
    shutil.copy(opt("--body"), upload)
    reply({"ETag": "x", "ServerSideEncryption": "AES256"})
if (service, action) == ("cloudfront", "get-function"):
    with open(args[args.index("LIVE") + 1], "w") as f:
        f.write("function handler(event) { return event.request }")
    reply({"ContentType": "application/javascript"})
if (service, action) == ("secretsmanager", "get-secret-value"):
    reply("re_fakeAdminKey123")
canned = {
    "route53 list-hosted-zones": {"HostedZones": [
        {"Id": "/hostedzone/ZNET", "Name": "seanshore.net.", "Config": {"Comment": "Primary domain", "PrivateZone": False}, "ResourceRecordSetCount": 2},
        {"Id": "/hostedzone/ZIN", "Name": "seanshore.in.", "Config": {"PrivateZone": False}, "ResourceRecordSetCount": 3},
        {"Id": "/hostedzone/ZOTHER", "Name": "elsewhere.example.", "Config": {"PrivateZone": False}}]},
    "route53 get-hosted-zone": {"DelegationSet": {"NameServers": ["ns-1.awsdns-01.org", "ns-2.awsdns-02.com"]}},
    "route53 list-resource-record-sets": {"ResourceRecordSets": [
        {"Name": "seanshore.in.", "Type": "NS"}, {"Name": "seanshore.in.", "Type": "SOA"},
        {"Name": "mail.seanshore.in.", "Type": "TXT", "ResourceRecords": [{"Value": "\"v=spf1\""}]}]},
    "cloudfront list-distributions": {"DistributionList": {"Items": [{"Id": "EAPP", "DomainName": "d1.cloudfront.net"}, {"Id": "ECONSOLE", "DomainName": "d2.cloudfront.net"}]}},
    "cloudfront get-distribution-config": {"DistributionConfig": {"Aliases": {"Quantity": 1, "Items": ["seanshore.in"]},
        "Origins": {"Items": [{"Id": "alb", "CustomHeaders": {"Quantity": 1, "Items": [{"HeaderName": "X-Origin-Verify", "HeaderValue": "ORIGINSECRET"}]}}]}}},
    "cloudfront list-functions": {"FunctionList": {"Items": [{"Name": "canonical", "FunctionConfig": {"Comment": "c", "Runtime": "cloudfront-js-2.0"}}]}},
    "cognito-idp list-user-pools": {"UserPools": [{"Id": "pool1", "Name": "sea-n-shore-staging-users"}]},
    "cognito-idp describe-user-pool": {"UserPool": {"Domain": "prefix", "CustomDomain": "auth.seanshore.in", "LambdaConfig": {"PreSignUp": "x"}}},
    "cognito-idp list-user-pool-clients": {"UserPoolClients": [{"ClientId": "c1"}]},
    "cognito-idp describe-user-pool-client": {"UserPoolClient": {"ClientName": "web", "ClientSecret": "CLIENTSECRET", "CallbackURLs": ["https://seanshore.in/auth/google/callback"]}},
    "cognito-idp list-identity-providers": {"Providers": [{"ProviderName": "Google"}]},
    "cognito-idp describe-identity-provider": {"IdentityProvider": {"ProviderName": "Google", "ProviderType": "Google",
        "ProviderDetails": {"client_id": "id", "client_secret": "GOOGLESECRET", "authorize_scopes": "openid email profile"}}},
    "lambda list-functions": {"Functions": [{"FunctionName": "sea-n-shore-staging-realtime-authorizer"}]},
    "lambda get-function-configuration": {"Environment": {"Variables": {"REALTIME_ALLOWED_ORIGINS": "https://seanshore.in", "TICKET_SECRET": "LAMBDASECRET"}}},
    "rds describe-db-clusters": {"DBClusters": [{"DBClusterArn": "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora", "MasterUserSecret": {"SecretArn": "arn:secret"}}]},
    "rds-data begin-transaction": {"transactionId": "tx1"},
    "rds-data execute-statement": {"records": [[{"longValue": 3}, {"longValue": 1}, {"longValue": 0}]]},
}
if (service, action) == ("rds-data", "execute-statement") and "information_schema" in (opt("--sql") or ""):
    reply({"records": [[{"stringValue": "messages,posts,site_settings"}]]})
key = service + " " + action
if key in canned:
    reply(canned[key])
if (service, action) == ("s3api", "get-bucket-cors"):
    sys.stderr.write("NoSuchCORSConfiguration\n"); sys.exit(254)
reply({})
`

function startFakes() {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? '' })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/domains') return res.end(JSON.stringify({ data: [{ id: 'd-net', name: 'mail.seanshore.net', status: 'not_started', region: 'ap-northeast-1' }, { id: 'd-in', name: 'mail.seanshore.in', status: 'verified', region: 'ap-northeast-1' }] }))
    if (req.url === '/domains/d-net') return res.end(JSON.stringify({ status: 'not_started', region: 'ap-northeast-1', records: [{ record: 'DKIM', name: 'resend._domainkey.mail', type: 'TXT', value: 'p=MIGf', status: 'not_started', ttl: 'Auto' }, { record: 'SPF', name: 'send.mail', type: 'MX', value: 'feedback-smtp.ap-northeast-1.amazonses.com', priority: 10, status: 'not_started' }] }))
    if (req.url === '/domains/d-in') return res.end(JSON.stringify({ status: 'verified', records: [{ record: 'SPF', name: 'send.mail', type: 'MX', value: 'x', priority: 10 }] }))
    if (req.url.startsWith('/dns-query') || req.url.startsWith('/resolve')) return res.end(JSON.stringify({ Status: 0, Answer: [{ type: 2, data: 'ns-2.awsdns-02.com.' }, { type: 2, data: 'ns-1.awsdns-01.org.' }] }))
    res.statusCode = 404
    res.end('{}')
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })))
}

test('end to end against fakes: one new SSE object, PASS and the checksum only on stdout, nothing secret inside', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'domain-move-report-'))
  writeFileSync(join(dir, 'aws'), FAKE_AWS)
  chmodSync(join(dir, 'aws'), 0o755)
  const { server, seen, port } = await startFakes()
  const local = `http://127.0.0.1:${port}`
  const sha = 'a'.repeat(40)
  const env = {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_AWS_LOG: join(dir, 'calls.log'), FAKE_AWS_UPLOAD: join(dir, 'upload.json'),
    DOMAIN_MOVE_REPORT_EXPECTED_SHA: sha, DOMAIN_MOVE_REPORT_TEST_RESEND_API: local,
    DOMAIN_MOVE_REPORT_TEST_DOH_CLOUDFLARE: local, DOMAIN_MOVE_REPORT_TEST_DOH_GOOGLE: local,
  }
  const result = await new Promise((resolve) => {
    const child = spawn('python3', ['-I', remotePath], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
  server.close()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stderr, '')
  const lines = result.stdout.trim().split('\n')
  assert.equal(lines.length, 2, result.stdout)
  assert.match(lines[0], /^DOMAIN_MOVE_REPORT_SHA256=[0-9a-f]{64}$/)
  assert.equal(lines[1], 'DOMAIN_MOVE_REPORT=PASS')

  const body = readFileSync(join(dir, 'upload.json'))
  const { createHash } = await import('node:crypto')
  assert.equal(lines[0].split('=')[1], createHash('sha256').update(body).digest('hex'), 'the printed checksum is the uploaded body')
  const text = body.toString()
  for (const secret of ['STATESECRET', 'ORIGINSECRET', 'CLIENTSECRET', 'GOOGLESECRET', 'LAMBDASECRET', 're_fakeAdminKey123']) {
    assert.ok(!text.includes(secret), `${secret} leaked into the report`)
  }
  const report = JSON.parse(text)
  assert.deepEqual(Object.keys(report.route53.in_scope).sort(), ['seanshore.in', 'seanshore.net'])
  assert.equal(report.route53.out_of_scope_zone_count, 1)
  assert.ok(!text.includes('elsewhere.example'), 'an out-of-scope zone is counted, not named')
  assert.equal(report.summary.seanshore_net_zone_count, 1)
  assert.equal(report.summary.zones['seanshore.in'].in_terraform, true)
  assert.equal(report.summary.zones['seanshore.net'].in_terraform, false)
  assert.deepEqual(report.summary.zones['seanshore.in'].delegation_matches, { cloudflare: true, google: true })
  assert.deepEqual(report.summary.zones['seanshore.in'].untracked_records, [{ name: 'mail.seanshore.in', type: 'TXT', alias: false }])
  assert.deepEqual(report.summary.distributions_not_in_terraform.map((d) => d.id), ['ECONSOLE'])
  assert.deepEqual(report.resend.domains['mail.seanshore.net'].records.map((r) => `${r.record} ${r.type} ${r.name}`), ['DKIM TXT resend._domainkey.mail', 'SPF MX send.mail'])
  assert.equal(report.resend.domains['mail.seanshore.net'].region, 'ap-northeast-1')
  assert.deepEqual(report.summary.mail_seanshore_in_receiving_mx, { route53: false, resend: false })
  assert.deepEqual(report.database_counts.tables.posts, { rows: 3, seanshore_in: 1, seaandshore_in: 0 })
  assert.equal(report.database_counts.tables.jobs, 'absent')
  assert.equal(report.cognito.clients[0].ClientSecret, undefined)

  // Resend: GET only, with the key in the header (never in the URL).
  assert.ok(seen.length > 0 && seen.every((r) => r.method === 'GET'), JSON.stringify(seen))
  assert.ok(seen.filter((r) => r.url.startsWith('/domains')).every((r) => r.auth === 'Bearer re_fakeAdminKey123'))
  assert.ok(seen.every((r) => !r.url.includes('re_fake')))

  // Every call read, except exactly one put-object to the report key with SSE-S3.
  const calls = read(join(dir, 'calls.log')).trim().split('\n').map((line) => JSON.parse(line))
  const writes = calls.filter(([service, action]) => !(READ_ONLY_ACTION.test(action) || (service === 'rds-data' && DATA_API_READ.has(action)) || action === 'head-object'))
  assert.equal(writes.length, 1, JSON.stringify(writes))
  const [put] = writes
  assert.deepEqual(put.slice(0, 2), ['s3api', 'put-object'])
  assert.equal(put[put.indexOf('--bucket') + 1], 'sea-n-shore-staging-310356785722-migration')
  assert.equal(put[put.indexOf('--key') + 1], `private-reports/domain-move/phase0-${sha}.json`)
  assert.equal(put[put.indexOf('--server-side-encryption') + 1], 'AES256')
  assert.ok(calls.every((args) => !args.includes('re_fakeAdminKey123')), 'the key is never on a command line')
  // SQL: read only, rolled back, nothing committed.
  const statements = calls.filter(([s, a]) => s === 'rds-data' && a === 'execute-statement').map((args) => args[args.indexOf('--sql') + 1])
  assert.ok(statements.includes('SET TRANSACTION READ ONLY'))
  assert.equal(calls.filter(([s, a]) => s === 'rds-data' && a === 'begin-transaction').length,
    calls.filter(([s, a]) => s === 'rds-data' && a === 'rollback-transaction').length)

  // A second run never overwrites: the object exists, so it fails at the upload and writes nothing.
  const again = spawnSync('python3', ['-I', remotePath], { env, encoding: 'utf8' })
  assert.equal(again.status, 1)
  assert.equal(again.stdout.trim(), 'DOMAIN_MOVE_REPORT=FAIL stage=put-object result=exists')
})
