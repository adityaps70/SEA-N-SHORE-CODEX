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
  assert.match(line, new RegExp(String.raw`^(none|checks|compare ${minute} (now|${minute})( split ${minute})?|plans|db ${minute} ${minute}|cap ${minute} ${minute}|legacy ${minute} ${minute} ${minute} ${minute})$`))
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
    // logs filter-log-events reads the web task's log; the legacy split prints only how many events matched.
    const allowed = READ_ONLY_ACTION.test(action) || (service === 'rds-data' && DATA_API_READ.has(action)) ||
      (service === 'logs' && action === 'filter-log-events')
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
  assert.match(remote, /SET LOCAL statement_timeout = '30s'/)
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
  assert.match(wrapper, /const DB_SECTIONS = \['config', 'db', 'dbwindow', 'dbminutes', 'edgeminutes', 'dbstats', 'dbhealth', 'cost'\]/)
  // Round CAP (finding 2): the EXPLAIN step runs only in its own "plans" window.
  assert.match(wrapper, /if \(line === 'plans'\) return \{ plans: true \}/)
  assert.match(wrapper, /COMPARE\?\.plans \? \['dbplans'\]/)
  assert.match(wrapper, /3 \* 3600_000/)
  const remote = readFileSync(remotePath, 'utf8')
  for (const name of ['db', 'dbwindow', 'dbminutes', 'edgeminutes', 'dbstats', 'dbplans', 'dbhealth', 'cost']) assert.match(remote, new RegExp(`"${name}": section_${name}`))
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

// Round DB (owner, 12 Nov): what the CloudFront 5xx in the daytime re-test were. Per minute: CloudFront requests and
// error rates, the ALB's own error codes, and from the ALB logs only status-code pairs, 460 (client went away) and counts.
test('the edge section prints status codes and counts per minute, never paths, addresses or agents', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.DB_RUN_START, r.DB_RUN_END = "2026-11-12T11:20:00Z", "2026-11-12T12:00:00Z"
line = lambda t, elb, target, ua: ('h2 %s app/sea-n-shore-staging-alb/1 203.0.113.9:443 10.0.1.5:3000 0.000 0.010 0.000 %s %s 10 20 '
                                   '"GET https://example.test:443/in/asha-singh?x=1 HTTP/2.0" "%s"' % (t, elb, target, ua))
logs = [line("2026-11-12T11:46:12.5Z", "460", "-", "SeaNShore-LoadTest/1 step/4"),
        line("2026-11-12T11:46:13.1Z", "502", "-", "SeaNShore-LoadTest/1 step/4"),
        line("2026-11-12T11:30:00.0Z", "200", "200", "Mozilla/5.0"),
        line("2026-11-12T12:30:00.0Z", "502", "-", "Mozilla/5.0")]
r.alb_day_lines = lambda day, totals, budget: iter(logs)
r.search_dims = lambda *a, **k: []
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_edgeminutes()
text = buf.getvalue()
assert "EDGE_MINUTE 11:46 alb_logged=2 elb_460_target_-=1 elb_502_target_-=1 load_test=2" in text, text
assert "EDGE_MINUTE 11:30 alb_logged=1" in text, text
assert "12:30" not in text, text
for leak in ("asha", "203.0.113", "10.0.1.5", "Mozilla", "example.test"):
    assert leak not in text, (leak, text)
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Round DB (12 Nov): Aurora's captured plans may carry no cost figures (they came back as nodes=0). Node, SubPlan and
// CTE lines are kept; condition and filter lines, which can hold values, never are.
test('captured plans without costs give their nodes and never their values', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
plan = """Nested Loop Anti Join
  ->  Hash Join
        Hash Cond: (c.id = pool.candidate_id)
        ->  Seq Scan on profiles c
              Filter: (full_name ~~ '%Asha Rao%'::text)
  SubPlan 3
    ->  Index Only Scan using post_impressions_pkey on post_impressions i2
          Index Cond: (viewer_id = 'a1b2c3d4'::uuid)
  CTE viewer
    ->  Index Scan using profiles_pkey on profiles p"""
kind, nodes = r.captured_plan_nodes(plan)
text = " ".join(nodes)
assert kind == "text", kind
assert "Asha" not in text and "a1b2" not in text and "Cond" not in text and "Filter" not in text, text
assert "SubPlan 3" in nodes and "CTE viewer" in nodes, nodes
assert any("Seq Scan on profiles" in n for n in nodes) and any("post_impressions_pkey" in n for n in nodes), nodes
assert r.captured_plan_nodes('[{"Plan": {"Node Type": "Seq Scan", "Relation Name": "posts", "Plan Rows": 5, "Total Cost": 3, "Filter": "x = 1"}}]') == ("json", ["Seq Scan on posts rows~5 cost~3"])
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Round DB (Option A, owner 12 Nov): the 24-hour before/after compare also reports the database cost per request.
test('the compare window reports database seconds and ACU-seconds per 1,000 requests for both windows', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8')
  assert.match(wrapper, /COMPARE \? \['compare', 'dbcompare', 'online'\]/)
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, datetime as dt
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
import os
os.environ.update({"COMPARE_START": "2026-11-13T10:00:00Z", "COMPARE_END": "2026-11-13T12:00:00Z", "COMPARE_SPLIT": ""})
r.writer_resource = lambda: "db-TEST"
r.search_dims = lambda *a, **k: [{"LoadBalancer": "app/x/1"}]
after = r.parse_minute("2026-11-13T10:00:00Z")
def points(namespace, name, dims, stat, period, start, end, region=None):
    later = start >= after
    value = {"RequestCount": 50000 if later else 40000, "ServerlessDatabaseCapacity": 1.0 if later else 2.0, "CPUUtilization": 30.0}[name]
    return [(start, value), (start + dt.timedelta(hours=1), value)]
r.metric_points = points
def fake_aws(service, action, *args, **kw):
    start = args[args.index("--start-time") + 1]
    v = 0.05 if start >= "2026-11-13T10:00:00Z" else 0.10
    return {"MetricList": [{"DataPoints": [{"Value": v}, {"Value": v}]}]}
r.aws = fake_aws
r.pi_keys = lambda *a, **k: [{"Total": 0.01, "Dimensions": {"db.sql_tokenized.statement": "select x from t where a = ?"},
                              "AdditionalMetrics": {"db.sql_tokenized.stats.calls_per_sec.avg": 1.0, "db.sql_tokenized.stats.avg_latency_per_call.avg": 2.5}}]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_dbcompare()
text = buf.getvalue()
# Before: 80,000 requests, 0.10 AAS x 7,200 s = 720 DB-s -> 9.00 per 1,000; 2 ACU x 2 h -> 180.00 ACU-s per 1,000.
assert "COMPARE_DB before requests=80000 db_s=720 db_s_per_1k_requests=9.00 acu_hours=4.0 acu_s_per_1k_requests=180.00" in text, text
# After: 100,000 requests, 360 DB-s -> 3.60; 1 ACU x 2 h -> 72.00.
assert "COMPARE_DB after requests=100000 db_s=360 db_s_per_1k_requests=3.60 acu_hours=2.0 acu_s_per_1k_requests=72.00" in text, text
assert "COMPARE_DB_CHANGE requests +25% db_s_per_1k_requests -60% acu_s_per_1k_requests -60%" in text, text
assert "COMPARE_DB_SQL after rank=1 db_s=72 calls=7200 ms_per_call=2.50 sql=select x from t where a = ?" in text, text
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Round CAP Step 0 (owner 13 Nov): requests per active signed-in person-minute by type, writes in the window and the
// 7-day top statements, real traffic only. Read-only, counts only; the load tests are left out.
test('the cap window runs the three read-only Step 0 sections over at most 14 days', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8')
  assert.match(wrapper, /const CAP_SECTIONS = \['capminutes', 'capwrites', 'cap7d'\]/)
  assert.match(wrapper, /14 \* 24 \* 3600_000/)
  assert.match(wrapper, /export CAP_START=/)
  const remote = readFileSync(remotePath, 'utf8')
  for (const name of ['capminutes', 'capwrites', 'cap7d']) assert.match(remote, new RegExp(`"${name}": section_${name}`))
  // The signed-in route list mirrors the app's own.
  const proxy = readFileSync('src/lib/auth/cognito-proxy.ts', 'utf8')
  const appList = [...proxy.match(/const PROTECTED_PREFIXES = \[([\s\S]*?)\] as const/)[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  const reportList = [...remote.match(/CAP_PROTECTED_PREFIXES = \(([\s\S]*?)\)\n/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(reportList, appList)
})

test('the person-minute rates count real signed-in traffic by type and never print paths, addresses or agents', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, os
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
os.environ["CAP_START"], os.environ["CAP_END"] = "2026-11-12T10:00:00Z", "2026-11-12T13:00:00Z"
line = lambda t, method, url, status, ua="Mozilla/5.0": ('h2 %s app/sea-n-shore-staging-alb/1 203.0.113.9:443 10.0.1.5:3000 0.000 0.010 0.000 %s %s 10 20 '
                                   '"%s https://example.test:443%s HTTP/2.0" "%s"' % (t, status, status, method, url, ua))
logs = [line("2026-11-12T10:05:01.0Z", "GET", "/home", "200"),
        line("2026-11-12T10:05:02.0Z", "GET", "/in/asha-singh?_rsc=abc", "200"),
        line("2026-11-12T10:05:03.0Z", "GET", "/messages?_rsc=abc", "200"),
        line("2026-11-12T10:05:04.0Z", "GET", "/messages?_rsc=abc", "307"),
        line("2026-11-12T10:05:05.0Z", "POST", "/home", "200"),
        line("2026-11-12T10:05:06.0Z", "POST", "/api/feed/impressions", "204"),
        line("2026-11-12T10:05:07.0Z", "GET", "/api/realtime/ticket", "200"),
        line("2026-11-12T10:05:08.0Z", "GET", "/_next/image?url=x", "200"),
        line("2026-11-12T10:05:09.0Z", "GET", "/_next/static/chunks/a.js", "200"),
        line("2026-11-12T10:05:10.0Z", "GET", "/about", "200"),
        line("2026-11-12T10:05:11.0Z", "POST", "/api/email/resend/webhook", "200"),
        line("2026-11-12T10:05:12.0Z", "GET", "/api/health/live", "200"),
        line("2026-11-12T11:30:00.0Z", "GET", "/home", "200"),
        line("2026-11-12T11:31:00.0Z", "GET", "/home", "200", "SeaNShore-LoadTest/1"),
        line("2026-11-12T12:10:00.0Z", "GET", "/home", "200", "Googlebot"),
        line("2026-11-12T13:10:00.0Z", "GET", "/home", "200")]
r.alb_day_lines = lambda day, totals, budget: iter(logs)
seen = []
def fake_rows(statements):
    seen.extend(statements)
    return [[{"h": 0, "person_minutes": 4, "peak_minute": 2, "minutes_with_any": 2}], [{"members": 3}]]
r.sql_rows = fake_rows
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_capminutes()
text = buf.getvalue()
assert "CAP_PERSON_MINUTES total=4 distinct_members=3 busiest_minute_people=2" in text, text
# Hour 0: 7 signed-in requests (the public page, public RSC and static file are left out) over 4 person-minutes.
assert "CAP_RATE_TOTAL whole_window person_minutes=4 signed_in_requests=7 per_person_minute=1.75" in text, text
for kind, n in (("page_signed_in_route", 1), ("rsc_signed_in_route", 1), ("rsc_hash_redirect", 1), ("action", 1),
                ("impressions", 1), ("realtime_ticket", 1), ("image", 1)):
    assert "CAP_RATE whole_window %s requests=%d" % (kind, n) in text, (kind, text)
assert '"excluded_load_test_window": 2' in text and '"bot_or_probe": 1' in text, text
# Webhooks and health checks are counted apart and never per person.
assert '"non_person": 2' in text and "CAP_RATE whole_window non_person" not in text, text
for leak in ("asha", "203.0.113", "10.0.1.5", "Mozilla", "example.test"):
    assert leak not in text, (leak, text)
assert all(s.lstrip().lower().startswith("with") for s in seen) and "is_load_test" in seen[0], seen
assert "2026-11-12T11:15:00Z" in seen[0], "the load test window is left out of the person-minutes"
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

test('the writes and 7-day statements leave the load tests out and print counts and shapes only', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, os, datetime as dt
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
os.environ["CAP_START"], os.environ["CAP_END"] = "2026-11-06T00:00:00Z", "2026-11-13T00:00:00Z"
seen = []
def fake_rows(statements):
    seen.extend(statements)
    if statements[0].startswith("select stats_reset"):
        return [[{"since": "2026-11-06", "seconds": 7 * 86400}], [{"id": "1", "calls": 700, "total_s": 3.5, "mean_ms": 5, "q": "insert into public.post_impressions values ($1, $2)"}]]
    return [[{"n": 70}]]
r.sql_rows = fake_rows
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_capwrites()
text = buf.getvalue()
assert "CAP_WRITES post_impressions_new rows=70 per_day=10" in text, text
assert "CAP_WRITE_STATEMENT rank=1 calls=700 per_day=100" in text, text
assert all(s.lower().startswith("select") for s in seen), seen
assert all("2026-11-11T19:50:00Z" in s and "2026-11-12T11:15:00Z" in s for s in seen if "count(*)" in s), seen

r.NOW = dt.datetime(2026, 11, 13, 9, 0, tzinfo=dt.timezone.utc)
r.writer_resource = lambda: "db-X"
calls = []
def fake_pi(resource, start, end, group, limit, extra=None):
    calls.append((start, end))
    return [{"Total": 0.1, "Dimensions": {"db.sql_tokenized.id": "A", "db.sql_tokenized.statement": "select * from public.posts where id = ?"},
             "AdditionalMetrics": {"db.sql_tokenized.stats.calls_per_sec.avg": 2.0, "db.sql_tokenized.stats.avg_latency_per_call.avg": 4.0}},
            {"Total": 0.02, "Dimensions": {"db.sql_tokenized.id": "B", "db.sql_tokenized.statement": "select 1"}, "AdditionalMetrics": {}}]
r.pi_keys = fake_pi
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_cap7d()
text = buf.getvalue()
# The 7 days less the load tests in them: one range before, between and after each cut.
assert len(calls) == 9, calls
# Inside the cap window, and inside the 7 days Performance Insights keeps.
assert calls[0][0] == r.parse_minute("2026-11-06T09:05:00Z") and calls[-1][1] == r.parse_minute("2026-11-13T00:00:00Z"), calls
for a, b in calls:
    for x, y in r.CAP_EXCLUDED:
        x, y = r.parse_minute(x + "Z"), r.parse_minute(y + "Z")
        assert b <= x or a >= y, (a, b)
assert "rank=1" in text and "share=83%" in text and "ms_per_call=4.00" in text, text
assert "CAP_7D_TOP5_SHARE 100%" in text, text
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Round CAP (owner 13 Nov): the admin final-reminder counts split at Deploy B and at the 10-second statement limit.
test('the legacy split reads one log group for a count, labels statement kinds and prints no paths, addresses or messages', () => {
  const remote = readFileSync(remotePath, 'utf8')
  const filters = [...remote.matchAll(/aws\("logs", "filter-log-events",([^\n]*)/g)].map((m) => m[1])
  assert.equal(filters.length, 1)
  assert.match(filters[0], /"\/ecs\/%s\/web" % PREFIX/)
  assert.match(remote, /"--filter-pattern", '"statement timeout"', "--query", "length\(events\)"/)
  const wrapper = readFileSync(wrapperPath, 'utf8')
  assert.match(wrapper, /COMPARE\?\.legacy \? \['legacysplit'\]/)
  assert.match(wrapper, /8 \* 24 \* 3600_000/)
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, os, datetime as dt
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.NOW = dt.datetime(2026, 11, 13, 12, 0, tzinfo=dt.timezone.utc)
os.environ["LEGACY_POINTS"] = "2026-11-06T09:50:00Z,2026-11-11T15:40:00Z,2026-11-11T19:25:00Z,2026-11-13T12:00:00Z"
r.writer_resource = lambda: "db-X"
FINAL = "select reason, count(*) as count from ( select case when invite.status <> ? from public.legacy_profile_invites invite left join public.legacy_profile_invite_final_reminders final"
def fake_pi(resource, start, end, group, limit, extra=None):
    ms = 15000.0 if end <= r.parse_minute("2026-11-11T19:25:00Z") else 10000.0
    return [{"Total": 0.01, "Dimensions": {"db.sql_tokenized.id": "F", "db.sql_tokenized.statement": FINAL},
             "AdditionalMetrics": {"db.sql_tokenized.stats.calls_per_sec.avg": 0.0001, "db.sql_tokenized.stats.avg_latency_per_call.avg": ms}},
            {"Total": 0.5, "Dimensions": {"db.sql_tokenized.id": "P", "db.sql_tokenized.statement": "select * from public.posts"}}]
r.pi_keys = fake_pi
seen = []
def fake_rows(statements):
    seen.extend(statements)
    return [[{"calls": 12, "total_s": 182.8, "mean_ms": 15237, "min_ms": 14000, "max_ms": 16000, "rows": 96, "q": FINAL}], [{"legacy_profile_invites": 9000}]]
r.sql_rows = fake_rows
line = lambda t, method, url, target_s, elb, target: ('h2 %s app/sea-n-shore-staging-alb/1 203.0.113.9:443 10.0.1.5:3000 0.000 %s 0.000 %s %s 10 20 '
                                   '"%s https://example.test:443%s HTTP/2.0" "Mozilla/5.0 Asha"' % (t, target_s, elb, target, method, url))
logs = [line("2026-11-11T10:00:00.0Z", "GET", "/admin/legacy-invites?mode=final", "15.200", "200", "200"),
        line("2026-11-12T10:00:00.0Z", "GET", "/admin/legacy-invites?mode=final", "10.050", "500", "500"),
        line("2026-11-12T10:00:30.0Z", "POST", "/admin/legacy-invites?mode=final", "10.010", "200", "200"),
        line("2026-11-12T10:01:00.0Z", "GET", "/in/asha-singh", "0.100", "200", "200")]
days = []
def fake_days(day, totals, budget):
    days.append(day)
    return iter(logs) if len(days) == 1 else iter([])
r.alb_day_lines = fake_days
calls = []
def fake_aws(service, action, *args, **kw):
    calls.append((service, action))
    return 3
r.aws = fake_aws
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_legacysplit()
text = buf.getvalue()
assert "LEGACY_RANGE before_deploy_b 2026-11-06T12:05:00Z 2026-11-11T15:40:00Z" in text, text
assert "LEGACY_PI before_deploy_b final_counts" in text and "ms_per_call=15000" in text, text
assert "LEGACY_PI with_10s_limit final_counts" in text and "ms_per_call=10000" in text, text
assert "posts" not in text, text
assert "LEGACY_STATEMENT final_counts calls=12" in text, text
assert "LEGACY_ALB before_deploy_b final:page elb=200 target=200=1" in text, text
assert "LEGACY_ALB with_10s_limit final:action elb=200 target=200=1 final:page elb=500 target=500=1" in text, text
assert "LEGACY_ALB_SERVER_S with_10s_limit final:page n=1 p50=10.05" in text, text
assert "LEGACY_WEB_STATEMENT_TIMEOUTS with_10s_limit events=3" in text, text
assert calls == [("logs", "filter-log-events")] * 3, calls
assert all(s.lower().startswith("select") for s in seen), seen
for leak in ("asha", "203.0.113", "10.0.1.5", "Mozilla", "example.test", "invite.status"):
    assert leak not in text.lower(), (leak, text)
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Round CAP (finding 8): the compare also prints the worker's hourly peaks of signed-in members online, counts only.
test('the online section prints each window\'s hourly peaks of members online and nothing about members', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, os
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
os.environ["COMPARE_START"], os.environ["COMPARE_END"] = "2026-11-15T00:00:00Z", "2026-11-15T12:00:00Z"
seen = []
def fake_rows(statements):
    seen.extend(statements)
    return [[{"day": "2026-11-14", "hour": 5, "members": 7}, {"day": "2026-11-15", "hour": 5, "members": 12}, {"day": "2026-11-15", "hour": 6, "members": 20}]]
r.sql_rows = fake_rows
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_online()
text = buf.getvalue()
assert "ONLINE_PEAK before hours_recorded=1 peak=7 avg_hourly_peak=7.0" in text, text
assert "ONLINE_PEAK after hours_recorded=2 peak=20 avg_hourly_peak=16.0" in text, text
assert "ONLINE_PEAK_HOURS after 11-15T05=12 11-15T06=20" in text, text
assert len(seen) == 1 and seen[0].startswith("select") and "online.peak_utc_h" in seen[0], seen
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})
