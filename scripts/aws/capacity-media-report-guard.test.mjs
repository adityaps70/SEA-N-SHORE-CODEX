import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

// Round P3: the capacity and media report reads production. These checks keep it read-only and aggregate-only.
const actionPath = 'scripts/aws/capacity-media-report-action.txt'
const workflowPath = '.github/workflows/aws-capacity-media-report.yml'
const wrapperPath = 'scripts/aws/capacity-media-report.cjs'
const remotePath = 'scripts/aws/capacity-media-report-remote.py'
const windowPath = 'scripts/aws/capacity-media-report-window.txt'

const READ_ONLY_ACTION = /^(describe|get|list)-[a-z-]+$/
const DATA_API_READ = new Set(['begin-transaction', 'execute-statement', 'rollback-transaction'])

test('the report is staging-only, exact-head and armed by an owner-merged guard', () => {
  for (const path of [actionPath, workflowPath, wrapperPath, remotePath]) assert.equal(existsSync(path), true, `${path} must exist`)
  const action = guardAction(readFileSync(actionPath, 'utf8'))
  assert.ok(['plan', 'report-once'].includes(action), `Unexpected capacity report action: ${action}`)
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment:\s*staging\n/)
  assert.match(workflow, /environment:\s*staging-apply\n/)
  assert.match(workflow, /Guard against a moved branch/)
  assert.match(workflow, /310356785722/)
  assert.match(workflow, /node --test scripts\/aws\/capacity-media-report-guard\.test\.mjs/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /report-once\)\n\s+\[\[ "\$GITHUB_EVENT_NAME" == push \]\]/)
})

test('the SSM wrapper only sends the report and reads its result', async () => {
  const wrapper = readFileSync(wrapperPath, 'utf8')
  const calls = [...wrapper.matchAll(/'(ssm|ecs|rds|s3|s3api|ec2|lambda|iam)', '([a-z-]+)'/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(calls)].sort(), ['ssm get-command-invocation', 'ssm send-command'])
  assert.match(wrapper, /capacity-media-report-remote\.py/)
  assert.match(wrapper, /\['config', 'usage', 'media'\]/)
  // The load test's usage report (REPORT_SECTIONS set) never turns into the compare.
  assert.match(wrapper, /const COMPARE = process\.env\.REPORT_SECTIONS \? null : compareWindow\(\)/)
  // Run 43017998127: plain base64 passed SSM's 97 KB limit, so the script goes gzipped, and stays well under it.
  assert.match(wrapper, /gzipSync\(Buffer\.from\(remoteScript, 'utf8'\), \{ level: 9 \}\)\.toString\('base64'\)/)
  assert.match(wrapper, /\| base64 -d \| gunzip > "\$WORK\/report\.py"/)
  const { gzipSync } = await import('node:zlib')
  assert.ok(gzipSync(readFileSync(remotePath), { level: 9 }).toString('base64').length < 60_000, 'the encoded script is too big for SSM')
})

test('the committed window reads none or one compare window in whole UTC minutes', () => {
  const line = readFileSync(windowPath, 'utf8').trim()
  const minute = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z`
  assert.match(line, new RegExp(String.raw`^(none|checks|compare ${minute} (now|${minute})( split ${minute})?|db ${minute} ${minute})$`))
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /- scripts\/aws\/capacity-media-report-window\.txt\n/)
  assert.match(workflow, /RUNNER_FILES: "scripts\/aws\/capacity-media-report-window\.txt /)
})

test('the compare runs on the last 24 hours at most and never overlaps the day before', () => {
  const run = (window, env = {}) => spawnSync('python3', ['-I', '-c', `
import datetime as dt, importlib.util, os
os.environ.update(${JSON.stringify(env)})
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
(b, bs, be), (a, as_, ae) = r.compare_windows()[0]
assert (b, a) == ("before", "after")
assert as_ - bs == dt.timedelta(hours=24) and ae - be == dt.timedelta(hours=24) and be <= as_
print("ok", r.iso(bs), r.iso(be))
`], { encoding: 'utf8', env: { ...process.env, COMPARE_START: window[0], COMPARE_END: window[1], COMPARE_SPLIT: window[2] ?? '' } })
  const ok = run(['2026-11-09T15:25:00Z', '2026-11-10T05:30:00Z', '2026-11-09T17:29:00Z'])
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /ok 2026-11-08T15:25:00Z 2026-11-09T05:30:00Z/)
  assert.notEqual(run(['2026-11-09T15:25:00Z', '2026-11-10T15:26:00Z']).status, 0, 'a window over 24 hours is refused')
  assert.notEqual(run(['2026-11-09T15:25:00Z', '2026-11-10T05:30:00Z', '2026-11-10T06:00:00Z']).status, 0, 'a split outside is refused')
})

test('every AWS call in the remote script describes, gets or lists (or reads through the Data API)', () => {
  const remote = readFileSync(remotePath, 'utf8')
  const calls = [...remote.matchAll(/aws\("([a-z0-9-]+)", "([a-z-]+)"/g)].map((m) => [m[1], m[2]])
  assert.ok(calls.length > 30, 'the report makes its AWS calls through aws()')
  for (const [service, action] of calls) {
    const allowed = READ_ONLY_ACTION.test(action) || (service === 'rds-data' && DATA_API_READ.has(action))
    assert.ok(allowed, `${service} ${action} is not a read-only call`)
  }
  assert.doesNotMatch(remote, /commit-transaction/)
  assert.equal((remote.match(/subprocess\.run\(/g) ?? []).length, 2, 'only aws() and the ALB log download run commands')
  // The only other AWS CLI use downloads ALB access logs to a temporary directory.
  const raw = [...remote.matchAll(/\["aws", "([a-z0-9]+)", "([a-z-]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(raw)], ['s3 cp'])
  assert.match(remote, /\["aws", "s3", "cp", "s3:\/\/%s\/%s" % \(bucket, prefix\), tmp, "--recursive"/)
})

test('SQL runs read-only and is rolled back; output carries shapes and counts, not member data', () => {
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(remote, /SET TRANSACTION READ ONLY/)
  assert.match(remote, /assert re\.match\(r"\^\\s\*\(select\|show\|with\)\\b", statement, re\.I\) or statement\.startswith\(EXPLAIN_PREFIX\)/)
  // Round DB: EXPLAIN only plans (GENERIC_PLAN, never ANALYZE), so nothing it explains is ever run.
  assert.match(remote, /^EXPLAIN_PREFIX = "explain \(generic_plan, costs, format json\) "$/m)
  assert.doesNotMatch(remote, /explain \([^)]*analyze/i)
  // Round DB: rollback-transaction takes no --database (with it, every rollback failed and the transaction stayed open).
  assert.match(remote, /finally:\n(\s+#[^\n]*\n)*\s+if aws\("rds-data", "rollback-transaction", "--resource-arn", arn, "--secret-arn", secret, "--transaction-id", txid\) is None:/)
  assert.doesNotMatch(remote, /"rollback-transaction", \*base/)
  // Object keys and request paths are only printed through the shape functions.
  assert.doesNotMatch(remote, /out\([^)]*obj\["Key"\]/)
  assert.match(remote, /route_shape\(path\)/)
  assert.match(remote, /shape_key\(obj\["Key"\]\)/)
  // No column that holds personal data is selected.
  assert.doesNotMatch(remote, /select[^"]*\b(email|full_name|phone|slug|username|ip_hash|approx_city)\b/i)
})

test('the remote script compiles and its shapes never print member data', () => {
  const compiled = spawnSync('python3', ['-I', '-c', `
import importlib.util
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
assert r.route_shape("/in/asha-singh") == "/:x/:x"
assert r.route_shape("/ashasingh") == "/:x"
assert r.route_shape("/jobs/3f2a1c9e-1111-4111-8111-111111111111") == "/jobs/:x"
assert r.route_shape("/api/media/image/profiles/x/y.webp") == "/api/media/image"
k = r.shape_key("private/verification/u1/passport scan Asha Rao.pdf")
assert "asha" not in k.lower() and "rao" not in k.lower() and "passport" not in k.lower(), k
k = r.shape_key("organizations/acme-shipping/logo-1729000000000.png")
assert "acme" not in k, k
print("ok")
`], { encoding: 'utf8' })
  assert.equal(compiled.status, 0, compiled.stderr)
  assert.match(compiled.stdout, /ok/)
})

// Round DB (Part 1 and Part 3): the db window runs five read-only sections; plans and statements print shapes only.
test('the db window runs the read-only Round DB sections over one load test window', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8')
  assert.match(wrapper, /const DB_SECTIONS = \['config', 'db', 'dbwindow', 'dbminutes', 'dbstats', 'dbplans', 'dbhealth', 'cost'\]/)
  assert.match(wrapper, /3 \* 3600_000/)
  const remote = readFileSync(remotePath, 'utf8')
  for (const name of ['db', 'dbwindow', 'dbminutes', 'dbstats', 'dbplans', 'dbhealth', 'cost']) assert.match(remote, new RegExp(`"${name}": section_${name}`))
  // Text plans keep node lines only; condition and filter lines, which can hold values, never come out.
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
plan = """Limit  (cost=0.42..8.44 rows=1 width=16)
  ->  Nested Loop  (cost=0.42..8.44 rows=20 width=16)
        ->  Index Scan using posts_author_idx on posts p  (cost=0.42..8.44 rows=1 width=16)
              Index Cond: (author_id = 'a1b2c3d4'::uuid)
              Filter: (body ~~ '%Asha Rao%'::text)
        ->  Seq Scan on profiles  (cost=0.00..120.00 rows=4850 width=40)
              Filter: (email = 'someone@example.com'::text)"""
nodes = r.text_plan_nodes(plan)
text = " ".join(nodes)
assert "Asha" not in text and "example" not in text and "a1b2" not in text, text
assert nodes == ["Limit rows~1 cost~8", "Nested Loop rows~20 cost~8", ">Index Scan on posts using posts_author_idx rows~1 cost~8",
                 ">Seq Scan on profiles rows~4850 cost~120"], nodes
assert r.plan_flags(nodes) == ["NESTED_LOOP", "SEQ_SCAN"]
g = r.plan_nodes({"Node Type": "Sort", "Sort Key": ["created_at"], "Plan Rows": 5, "Total Cost": 9.5, "Filter": "x = 'secret'",
                  "Plans": [{"Node Type": "Seq Scan", "Relation Name": "posts", "Plan Rows": 50, "Total Cost": 4}]})
assert g == ["Sort sort(1 keys) rows~5 cost~9", ">Seq Scan on posts rows~50 cost~4"], g
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  // Statements are printed only as normalised shapes from pg_stat_statements and Performance Insights.
  assert.match(remote, /left\(regexp_replace\(query, '\\\\s\+', ' ', 'g'\), 420\) as q from pg_stat_statements/)
  assert.match(remote, /"db\.sql_tokenized\.statement"/)
})

// Round DB (owner, 11 Nov): "p95 under 1 s" is judged on the ALB's server-side time per ramp step. The load test names
// its step in the User-Agent; the report cuts the ALB logs by it and prints aggregates only.
test('the server-side per-step lines judge p95 under 1 s from the ALB target times, counting up from step 1', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
assert r.LOAD_TEST_STEP.search("SeaNShore-LoadTest/1 step/3").group(1) == "3"
assert r.LOAD_TEST_STEP.search("SeaNShore-LoadTest/1") is None
assert r.LOAD_TEST_STEP.search("Mozilla/5.0 step/2") is None
def step(times, errors=0):
    return {"n": len(times), "times": times, "5xx": errors}
fast = [0.1] * 95 + [0.4] * 5
lines = r.server_step_lines({1: step(fast), 2: step([0.2] * 90 + [1.5] * 10), 3: step(fast)}, ["100", "300", "600"])
assert lines[0] == "LOAD_TEST_STEP_SERVER step=1 target_rpm=100 requests=100 p50_s=0.100 p95_s=0.100 p99_s=0.400 server_5xx_pct=0.00 within_1s=true measured_at=alb_target", lines[0]
assert "within_1s=false" in lines[1] and "p95_s=1.500" in lines[1], lines[1]
# Step 3 is fast again, but the count stops at the first step over 1 s.
assert "within_1s=true" in lines[2], lines[2]
assert lines[3] == "LOAD_TEST_P95_UNDER_1S_SERVER highest_step=1 highest_rpm=100 measured_at=alb_target", lines[3]
# Server errors over 1% also break it; a step with no requests is skipped; no steps means no lines.
errs = r.server_step_lines({1: step(fast, errors=2)}, ["100"])
assert "server_5xx_pct=2.00 within_1s=false" in errs[0] and errs[-1].startswith("LOAD_TEST_P95_UNDER_1S_SERVER highest_step=0 highest_rpm=0"), errs
assert r.server_step_lines({1: step([])}, ["100"]) == []
assert r.server_step_lines({}, []) == []
text = "\\n".join(lines)
assert "http" not in text and "@" not in text
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Round DB (owner, 12 Nov): the night re-test window in detail. Database time by process kind, role, host kind and
// statement shape, with calls and execution time; background work as counts; minute-by-minute metrics. Host
// addresses are only used to label hosts (web, worker, bootstrap) and are never printed.
test('the db window detail labels hosts without printing addresses and prints counts and shapes only', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, json
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.DB_RUN_START, r.DB_RUN_END = "2026-11-11T19:55:00Z", "2026-11-11T20:45:00Z"
r.writer_resource = lambda: "db-TEST"
statements = []
def fake_sql(qs):
    statements.extend(qs)
    return [[{"sent": 0, "attempted": 0, "queued_now": 0}] for _ in qs]
r.sql_rows = fake_sql
def fake_aws(service, action, *args, **kw):
    if (service, action) == ("ecs", "list-clusters"):
        return {"clusterArns": ["arn:aws:ecs:x:1:cluster/sea-n-shore-staging"]}
    if (service, action) == ("ecs", "list-services"):
        return {"serviceArns": ["arn:aws:ecs:x:1:service/c/sea-n-shore-staging-web", "arn:aws:ecs:x:1:service/c/sea-n-shore-staging-worker"]}
    if (service, action) == ("ecs", "list-tasks"):
        return {"taskArns": ["t-" + args[-1]]}
    if (service, action) == ("ecs", "describe-tasks"):
        ip = "10.0.1.11" if args[-1].endswith("web") else "10.0.2.22"
        return {"tasks": [{"attachments": [{"details": [{"name": "privateIPv4Address", "value": ip}]}]}]}
    if (service, action) == ("ec2", "describe-instances"):
        return {"Reservations": [{"Instances": [{"PrivateIpAddress": "10.0.3.33", "Tags": [{"Key": "Name", "Value": "sea-n-shore-bootstrap"}]}]}]}
    if (service, action) == ("pi", "describe-dimension-keys"):
        group = json.loads(args[args.index("--group-by") + 1])["Group"]
        if group == "db.host":
            return {"Keys": [{"Total": 0.2, "Dimensions": {"db.host.name": "10.0.1.11", "db.host.id": "h1"}},
                             {"Total": 0.05, "Dimensions": {"db.host.name": "10.0.2.22", "db.host.id": "h2"}},
                             {"Total": 0.01, "Dimensions": {"db.host.name": "10.0.9.99", "db.host.id": "h3"}}]}
        if group == "db.sql_tokenized":
            return {"Keys": [{"Total": 0.1, "Dimensions": {"db.sql_tokenized.statement": "select x from t where a = ?"},
                              "AdditionalMetrics": {"db.sql_tokenized.stats.calls_per_sec.avg": 2.0,
                                                    "db.sql_tokenized.stats.total_time_per_sec.avg": 50.0,
                                                    "db.sql_tokenized.stats.avg_latency_per_call.avg": 25.0}}]}
        if group == "db.session_type":
            return {"Keys": [{"Total": 0.02, "Dimensions": {"db.session_type.name": "autovacuum worker"}}]}
        return {"Keys": []}
    return {}
r.aws = fake_aws
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_dbwindow()
text = buf.getvalue()
for ip in ("10.0.1.11", "10.0.2.22", "10.0.9.99", "10.0.3.33"):
    assert ip not in text, text
assert "PI_BY_HOST_KIND load_AAS=0.2000 db_s=600 ecs:web" in text, text
assert "PI_BY_HOST_KIND load_AAS=0.0500 db_s=150 ecs:worker" in text, text
assert "not_running_now" in text, text
assert "PI_BY_PROCESS_KIND load_AAS=0.0200 db_s=60 autovacuum worker" in text, text
# 50 minutes: 2 calls/s is 6000 calls, 50 ms of execution per second is 150 s.
assert "WINDOW_SQL_BY_TIME rank=1 db_s=300 share=100% calls=6000 exec_s=150.0 ms_per_call=25.00" in text, text
assert len(statements) == 3 and all(q.lower().startswith("select") for q in statements)
assert not any(c in " ".join(statements).lower() for c in ("recipient", "email,", "resend_email_id", "full_name"))
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})
