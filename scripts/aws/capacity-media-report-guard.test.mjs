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
// Owner (19 Nov): a section runs when it is listed in REPORT_SECTIONS and its function exists (main dispatches by name).
const listed = (remote, name) => new RegExp(`REPORT_SECTIONS = \\([^)]*"${name}"[^)]*\\)`).test(remote) && new RegExp(`^def section_${name}\\(`, "m").test(remote)
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
  // Owner (19 Nov): each command carries only its section's slice, built and checked by capacity-media-report-slice.py.
  assert.match(wrapper, /gzipSync\(Buffer\.from\(sliced\.stdout, 'utf8'\), \{ level: 9 \}\)\.toString\('base64'\)/)
  assert.match(wrapper, /'scripts\/aws\/capacity-media-report-slice\.py', 'scripts\/aws\/capacity-media-report-remote\.py', section\]/)
  assert.match(wrapper, /async function runSection\(section\) \{\n  const encoded = encodedSection\(section\)/)
  assert.match(wrapper, /\| base64 -d \| gunzip > "\$WORK\/report\.py"/)
})

test('owner 19 Nov: every section slice builds, defines what it uses, stays under the SSM limit and runs the right section', async () => {
  const remote = readFileSync(remotePath, 'utf8')
  const list = remote.match(/REPORT_SECTIONS = \(([^)]*)\)/)
  assert.ok(list, 'the remote script lists its sections')
  const sections = [...list[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1])
  // Every section function is listed, and every listed one exists.
  assert.deepEqual([...remote.matchAll(/^def section_([a-z0-9]+)\(/gm)].map((m) => m[1]).sort(), [...sections].sort())
  const { gzipSync } = await import('node:zlib')
  for (const section of sections) {
    const sliced = spawnSync('python3', ['-I', 'scripts/aws/capacity-media-report-slice.py', remotePath, section], { encoding: 'utf8' })
    assert.equal(sliced.status, 0, `${section}: ${sliced.stderr}`)
    assert.ok(gzipSync(Buffer.from(sliced.stdout), { level: 9 }).toString('base64').length < 60_000, `${section} slice too big for SSM`)
    assert.match(sliced.stdout, new RegExp(`^def section_${section}\\(`, 'm'))
    // Only this section's function among the sections, so a slice can never run another section's code.
    assert.deepEqual([...sliced.stdout.matchAll(/^def section_([a-z0-9]+)\(/gm)].map((m) => m[1]), [section])
    // The slice compiles, and loading it runs no section (only main() does).
    const check = spawnSync('python3', ['-I', '-c', `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("s", "/dev/stdin")
src = sys.stdin.read()
code = compile(src, "slice", "exec")
module = {"__name__": "slice"}
exec(code, module)
assert callable(module["section_${section}"]) and callable(module["main"])
print("ok")
`], { input: sliced.stdout, encoding: 'utf8' })
    assert.equal(check.status, 0, `${section}: ${check.stderr}`)
  }
  // A slice whose section uses a helper that is not there is refused before it is ever sent.
  const broken = spawnSync('python3', ['-I', '-c', `
import importlib.util
spec = importlib.util.spec_from_file_location("slicer", "scripts/aws/capacity-media-report-slice.py")
slicer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slicer)
try:
    slicer.slice_source("import os\\ndef main():\\n    section_x()\\ndef section_x():\\n    missing_helper()\\n", "x")
    raise SystemExit("not refused")
except SystemExit as error:
    assert "missing_helper" in str(error), error
print("ok")
`], { encoding: 'utf8' })
  assert.equal(broken.status, 0, broken.stderr || broken.stdout)
})

test('the committed window reads none or one compare window in whole UTC minutes', () => {
  const line = readFileSync(windowPath, 'utf8').trim()
  const minute = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z`
  assert.match(line, new RegExp(String.raw`^(none|checks|compare ${minute} (now|${minute})( split ${minute})?|plans|db ${minute} ${minute}|cap ${minute} ${minute}|legacy ${minute} ${minute} ${minute} ${minute}|sessions ${minute} ${minute})$`))
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
  for (const name of ['db', 'dbwindow', 'dbminutes', 'edgeminutes', 'dbstats', 'dbplans', 'dbhealth', 'cost']) assert.ok(listed(remote, name), name)
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
  assert.match(wrapper, /const CAP_SECTIONS = \['capminutes', 'capwrites', 'cap7d', 'caponline'\]/)
  assert.match(wrapper, /14 \* 24 \* 3600_000/)
  assert.match(wrapper, /export CAP_START=/)
  const remote = readFileSync(remotePath, 'utf8')
  for (const name of ['capminutes', 'capwrites', 'cap7d', 'caponline']) assert.ok(listed(remote, name), name)
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
# Owner (14 Nov): /home pages and its Server Actions are the home feed's own types.
for kind, n in (("home_page", 1), ("rsc_signed_in_route", 1), ("rsc_hash_redirect", 1), ("home_action", 1),
                ("impressions", 1), ("realtime_ticket", 1), ("image", 1)):
    assert "CAP_RATE whole_window %s requests=%d" % (kind, n) in text, (kind, text)
assert "CAP_HOME_SHARE home_requests=2 signed_in_requests=7 share=29% home_action=1 home_page=1" in text, text
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
  // The legacy split's statement timeouts and (owner 15 Nov) the sessions window's ledger failures: both read the web
  // task's log for a count only.
  assert.equal(filters.length, 2)
  for (const filter of filters) assert.match(filter, /"\/ecs\/%s\/web" % PREFIX/)
  assert.match(remote, /"--filter-pattern", '"statement timeout"', "--query", "length\(events\)"/)
  assert.match(remote, /"--filter-pattern", '"auth_refresh_ledger_unavailable"', "--query", "length\(events\)"/)
  assert.equal((remote.match(/"--query", "length\(events\)"/g) ?? []).length, 2)
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

// Owner (14 Nov): each top statement's area (the home feed's share of database time) and the people online over the
// cap window. Read-only, counts only.
test('statements are grouped by area and the cap window prints the people-online peaks per day', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, os
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
area = r.cap_area
assert area("insert into public.post_impressions (viewer_id, post_id) values ($1, $2)") == "home_feed"
assert area("select p.id from public.posts p left join public.post_hides h on h.post_id = p.id") == "home_feed"
assert area("select * from public.posts where id = $1") == "posts_other"
assert area("select count(*) from public.notifications where recipient_id = $1") == "notifications"
assert area("select * from public.jobs j where j.status = $1") == "jobs"
assert area("select 1") == "other"
os.environ["CAP_START"], os.environ["CAP_END"] = "2026-11-14T11:00:00Z", "2026-11-17T11:00:00Z"
seen = []
def fake_rows(statements):
    seen.extend(statements)
    return [[{"day": "2026-11-14", "hour": 10, "members": 99}, {"day": "2026-11-14", "hour": 12, "members": 4},
             {"day": "2026-11-15", "hour": 9, "members": 7}, {"day": "2026-11-17", "hour": 11, "members": 50}]]
r.sql_rows = fake_rows
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_caponline()
text = buf.getvalue()
# Hours before the window (10:00 on the 14th) and at its end (11:00 on the 17th) are left out.
assert "CAP_ONLINE hours_recorded=2 peak=7 avg_hourly_peak=5.5" in text, text
assert "CAP_ONLINE_DAY 2026-11-14 hours=1 peak=4 avg=4.0" in text and "CAP_ONLINE_DAY 2026-11-15 hours=1 peak=7 avg=7.0" in text, text
assert all(s.lower().startswith("select") for s in seen), seen
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Owner (15 Nov): an administrator is signed out when moving between a phone and a laptop. The sessions window counts
// sign-ins across a member's devices, read-only, administrators apart, and prints no member data.
test('the sessions window runs two read-only sections over at most 14 days and prints counts only', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8')
  assert.match(wrapper, /const SESSION_SECTIONS = \['sessdb', 'sessmetric', 'sessstale'\]/)
  assert.match(wrapper, /const SECTIONS = COMPARE\?\.sessions \? SESSION_SECTIONS :/)
  assert.match(wrapper, /at most 14 days, in whole UTC minutes'\)\n    return \{ sessions: true, sessStart: sessions\[1\], sessEnd: sessions\[2\] \}/)
  assert.match(wrapper, /export SESS_START=\$\{quote\(COMPARE\?\.sessStart \?\? ''\)\}\nexport SESS_END=\$\{quote\(COMPARE\?\.sessEnd \?\? ''\)\}/)
  const remote = readFileSync(remotePath, 'utf8')
  for (const name of ['sessdb', 'sessmetric', 'sessstale']) assert.ok(listed(remote, name), name)
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, os
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
os.environ["SESS_START"], os.environ["SESS_END"] = "2026-11-01T00:00:00Z", "2026-11-16T00:00:00Z"
try:
    r.sessions_window()
    raise SystemExit("a window over 14 days must be refused")
except AssertionError:
    pass
os.environ["SESS_START"] = "2026-11-08T00:00:00Z"
seen = []
def fake_rows(statements):
    seen.extend(statements)
    return [
        [{"kind": "started", "day": "2026-11-13", "is_admin": True, "detail": "google", "n": 3},
         {"kind": "reuse_ended", "day": "2026-11-13", "is_admin": False, "detail": "password", "n": 2}],
        [{"day": "2026-11-13", "is_admin": True, "reason": "reuse", "ended": 2, "other_device_active_near": 2, "signed_in_again_30min": 1, "had_parallel_renewal": 2}],
        [{"day": "2026-11-13", "is_admin": True, "sign_ins": 3, "replaced_unended": 1, "replaced_after_other_device": 1}],
        [{"day": "2026-11-13", "is_admin": False, "renewals": 40, "sign_ins": 9, "renewals_in_parallel": 12, "never_used_again": 5}],
        [{"kind": "step_up_ok", "day": "2026-11-13", "n": 4}],
        [{"admins": 2}],
    ]
r.sql_rows = fake_rows
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_sessdb()
text = buf.getvalue()
# Owner (18 Nov): every sessions count leaves the load-test accounts out: each read of auth_sessions s is filtered.
real = "not exists (select 1 from public.profiles lt where lt.id = s.profile_id and lt.is_load_test)"
for statement in seen[:4]:
    reads = statement.count("public.auth_sessions s ")
    assert reads >= 1 and statement.count(real) == reads, statement
assert "SESS_ADMINS count=2" in text, text
assert "SESS_DAY 2026-11-13 started admin google n=3" in text and "SESS_DAY 2026-11-13 reuse_ended member password n=2" in text, text
assert "SESS_END 2026-11-13 admin reuse ended=2 other_device_active_near=2 signed_in_again_30min=1 had_parallel_renewal=2" in text, text
assert "SESS_RESTART 2026-11-13 admin sign_ins=3 replaced_unended=1 replaced_after_other_device=1" in text, text
assert "SESS_RENEW 2026-11-13 member renewals=40 sign_ins=9 renewals_in_parallel=12 never_used_again=5" in text, text
assert "SESS_SECTION" not in text and "SESS_SECURITY 2026-11-13 step_up_ok n=4" in text, text
assert len(seen) == 6 and all(s.lower().startswith(("select", "with")) for s in seen), seen
import re
def drop_calls(sql, names):
    # Removes count(...) and filter (...) with their balanced brackets: a count prints a number, never what it counts.
    for name in names:
        while name in sql:
            i = sql.index(name)
            j, depth = i + len(name), 1
            while depth:
                depth += {"(": 1, ")": -1}.get(sql[j], 0)
                j += 1
            sql = sql[:i] + "n" + sql[j:]
    return sql
for s in seen:
    # Only counts, days, reasons and the administrator flag leave the database: the outer select list names no id,
    # hash, device, place or address (the flag reads profile_id only inside "in (select user_id from admins)").
    outer = s.lower().replace("s.profile_id in (select user_id from admins)", "is_admin_flag")
    outer = drop_calls(outer, ("count(", "filter ("))
    outer = outer.split(" from ")[0] if outer.startswith("select") else re.split(r"\\) select ", outer)[-1].split(" from ")[0]
    for column in ("token_hash", "origin_hash", "user_agent_summary", "ip_hash", "approx_city", "email", "profile_id", ".id"):
        assert column not in outer, (column, outer)
assert "2026-11-08T00:00:00Z" in seen[0] and "2026-11-16T00:00:00Z" in seen[0], seen[0]
print("ok")
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^ok$/m)
})

// Owner (18 Nov): the stale-token look, on fake rows and fake load balancer lines: ages, the request that carried the
// last renewal (and whether the viewer went away, 460), what presented the stale token, device kinds, and nothing that
// identifies anyone.
test('the stale-token section reports ages, renewal requests and device kinds, with no ids or hashes', () => {
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib, os
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
os.environ["SESS_START"], os.environ["SESS_END"] = "2026-11-14T00:00:00Z", "2026-11-18T00:00:00Z"
seen = []
def fake_rows(statements):
    seen.extend(statements)
    return [
        [{"origin_hash": "originAAAA", "at": "2026-11-16 10:00:00"}, {"origin_hash": "originBBBB", "at": "2026-11-16 11:00:00"},
         {"origin_hash": "originCCCC", "at": "2026-11-14 09:00:00"}],
        [{"origin_hash": "originAAAA", "at": "2026-11-16 10:05:00", "summary": "Safari on iPhone", "is_admin": False},
         {"origin_hash": "originBBBB", "at": "2026-11-17 12:00:00", "summary": "Chrome on Windows", "is_admin": True},
         {"origin_hash": "originCCCC", "at": "2026-11-14 09:01:00", "summary": "Home Screen app on iPhone", "is_admin": False}],
    ]
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1"
WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
def line(t, method, url, elb, target, ua):
    return 'h2 %s app/x 1.2.3.4:5 10.0.0.1:3000 0.001 0.010 0.000 %s %s 100 0 "%s https://seanshore.in:443%s HTTP/2.0" "%s"' % (t, elb, target, method, url, ua)
LINES = {
    "2026-11-16": [line("2026-11-16T10:00:01.100000Z", "GET", "/jobs?_rsc=abc", "460", "-", IPHONE),
                   line("2026-11-16T10:05:00.200000Z", "GET", "/home", "200", "200", IPHONE),
                   line("2026-11-16T11:00:02.300000Z", "POST", "/messages/abc123", "200", "200", WINDOWS)],
    "2026-11-17": [line("2026-11-17T12:00:01.000000Z", "POST", "/api/realtime/ticket", "401", "401", WINDOWS)],
}
def fake_days(day, totals, budget):
    return LINES.get(day.isoformat(), [])
r.sql_rows = fake_rows
r.alb_day_lines = fake_days
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_sessstale()
text = buf.getvalue()
print(text)
assert "STALE_ENDS_TOTAL before_fix=1 after_fix=2" in text, text
assert "STALE_END period=after_fix who=member age=2_10m device=phone n=1" in text, text
assert "STALE_END period=after_fix who=admin age=over_24h device=computer n=1" in text, text
assert "STALE_END period=before_fix who=member age=under_2m device=app n=1" in text, text
assert "STALE_END_LAST_RENEWAL period=after_fix who=member kind=rsc route=/jobs elb=460 device=phone n=1" in text, text
assert "STALE_END_LAST_RENEWAL period=after_fix who=admin kind=action route=/messages/:x elb=200 device=computer n=1" in text, text
assert "STALE_PRESENTED_NEAR_END period=after_fix kind=realtime_ticket route=/api/realtime/ticket elb=401 device=computer n=1" in text, text
assert "STALE_RENEWALS_TOTAL" in text and "client_closed_460=1" in text, text
# Real members only, and nothing that identifies anyone reaches the output.
assert all("not p.is_load_test" in st for st in seen), seen
for secret in ("originAAAA", "originBBBB", "originCCCC", "abc123", "1.2.3.4", "Safari on iPhone"):
    assert secret not in text, secret
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr || run.stdout)
})


// Owner (18 Nov): the Aurora platform version, connection churn and what the edge forwards. Versions, settings and
// counts only: no addresses, no queries, nothing a member typed.
test('the dbconn window runs one read-only section that prints versions, connection counts and edge cookie settings', () => {
  const wrapper = readFileSync('scripts/aws/capacity-media-report.cjs', 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(wrapper, /if \(line === 'dbconn'\) return \{ dbconn: true \}/)
  assert.match(wrapper, /COMPARE\?\.dbconn \? \['dbconn', 'budgets'\] :/)
  assert.ok(listed(remote, 'dbconn'))
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
seen = []
def fake_rows(statements):
    seen.extend(statements)
    s = statements[0]
    if "pg_stat_database" in s:
        return [[{"since": "2026-11-11", "seconds": 7200, "backends": 20, "sessions": 1200, "abandoned": 3, "fatal": 1,
                  "killed": 0, "session_s": 60000, "active_s": 900, "idle_tx_s": 2}]]
    if "pg_stat_activity" in s:
        return [[{"role": "app_web", "app": "", "state": "idle", "age_s": 20}, {"role": "app_web", "app": "", "state": "idle", "age_s": 30},
                 {"role": "app_worker", "app": "", "state": "active", "age_s": 4000}]]
    if "aurora_stat_database" in s:
        return [[{"datname": "sea_n_shore", "total_auth_attempts": 1500, "numbackends": 20, "xact_commit": 5}]]
    if "pg_stat_statements" in s:
        return [[{"id": "123", "calls": 900, "total_ms": "450.0", "mean_ms": "0.500", "shape": "insert into public.notifications (recipient_id) values ($1)"}]]
    if "people_suggestions" in s:
        assert "not p.is_load_test" in s
        return [[{"stored": "0", "members": 4}, {"stored": "12+", "members": 30}]]
    return [[{"name": "max_connections", "setting": "450", "unit": None}]]
def fake_aws(service, action, *args, **kw):
    if (service, action) == ("rds", "describe-db-clusters"):
        return {"DBClusters": [{"DBClusterArn": "arn:aws:rds:x:1:cluster:c", "EngineVersion": "16.4", "AutoMinorVersionUpgrade": True,
                "ServerlessV2PlatformVersion": "3", "MasterUserSecret": {"SecretArn": "arn:s"}, "PreferredMaintenanceWindow": "sun:20:00-sun:20:30",
                "DBClusterMembers": [{"DBInstanceIdentifier": "w1", "IsClusterWriter": True}]}]}
    if (service, action) == ("rds", "describe-db-instances"):
        return {"DBInstances": [{"DBInstanceArn": "arn:aws:rds:x:1:db:w1", "DBInstanceClass": "db.serverless", "DBInstanceStatus": "available",
                "PendingModifiedValues": {}, "Endpoint": {"Address": "secret-host.example"}}]}
    if (service, action) == ("rds", "describe-pending-maintenance-actions"):
        return {"PendingMaintenanceActions": [{"ResourceIdentifier": "arn:aws:rds:x:1:db:w1", "PendingMaintenanceActionDetails": [
            {"Action": "system-update", "Description": "Upgrade to serverless platform version 4", "OptInStatus": "pending"}]},
            {"ResourceIdentifier": "arn:aws:rds:x:1:db:someone-else", "PendingMaintenanceActionDetails": [{"Action": "db-upgrade"}]}]}
    if (service, action) == ("rds", "describe-db-engine-versions"):
        return {"DBEngineVersions": [{"ValidUpgradeTarget": [{"EngineVersion": "16.6", "IsMajorVersionUpgrade": False},
                {"EngineVersion": "16.10", "IsMajorVersionUpgrade": False}, {"EngineVersion": "17.4", "IsMajorVersionUpgrade": True}]}]}
    if (service, action) == ("cloudfront", "list-distributions"):
        return {"DistributionList": {"Items": [{"Id": "E1", "DefaultCacheBehavior": {"CachePolicyId": "cp1", "OriginRequestPolicyId": "orp1"},
                "CacheBehaviors": {"Items": [{"PathPattern": "/_next/static/*", "CachePolicyId": "cp2"}]}}]}}
    if (service, action) == ("cloudfront", "get-cache-policy"):
        name = "public-pages" if args[-1] == "cp1" else "CachingOptimized"
        cookies = {"CookieBehavior": "whitelist", "Cookies": {"Items": ["a", "b"]}} if args[-1] == "cp1" else {"CookieBehavior": "none"}
        return {"CachePolicy": {"CachePolicyConfig": {"Name": name, "MinTTL": 0, "DefaultTTL": 0, "MaxTTL": 300,
                "ParametersInCacheKeyAndForwardedToOrigin": {"CookiesConfig": cookies}}}}
    if (service, action) == ("cloudfront", "get-origin-request-policy"):
        return {"OriginRequestPolicy": {"OriginRequestPolicyConfig": {"Name": "AllViewerExceptHostHeader", "CookiesConfig": {"CookieBehavior": "all"}}}}
    return {}
r.sql_rows = fake_rows
r.aws = fake_aws
r.metric_series = lambda *a, **k: [10.0, 20.0]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_dbconn()
text = buf.getvalue()
print(text)
assert "cluster.ServerlessV2PlatformVersion=3" in text, text
assert "PLATFORM_PENDING_MAINTENANCE count=1" in text, text
assert "action=system-update" in text and "platform version 4" in text, text
assert "latest_minor=16.10" in text and "major=1" in text, text
assert "sessions_per_hour=600.0" in text and "avg_session_s=50.0" in text, text
assert "CONN_NOW total=3" in text, text
assert "CONN_NOW_GROUP role=app_web app=\\"\\" state=idle age=<1m n=2" in text, text
assert 'CACHED_TABLE_WRITE {"calls": 900, "id": "123", "mean_ms": "0.500"' in text, text
assert 'PYMK_PREPARED_PER_MEMBER [{"stored": "0", "members": 4}, {"stored": "12+", "members": 30}]' in text, text
assert '"total_auth_attempts": 1500' in text and "xact_commit" not in text, text
assert "path=default cache=public-pages[cookies=whitelist:2 ttl=0/0/300] origin_request=AllViewerExceptHostHeader[cookies=all]" in text, text
assert "path=/_next/static/* cache=CachingOptimized[cookies=none:0" in text, text
for secret in ("secret-host.example", "someone-else", "arn:"):
    assert secret not in text, secret
assert all(st.lstrip().lower().startswith("select") for st in seen), seen
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr || run.stdout)
})

// Owner (18-19 Nov): which AWS budget sent the 18 Nov alert and why. Budget names, amounts, thresholds and states only.
test('the budgets section names each budget, its limit, spend, forecast, alert thresholds and states', () => {
  const remote = readFileSync(remotePath, 'utf8')
  assert.ok(listed(remote, 'budgets'))
  const run = spawnSync('python3', ['-I', '-c', `
import importlib.util, io, contextlib
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
calls = []
def fake_aws(service, action, *args, **kw):
    calls.append((service, action, kw.get("region")))
    if action == "describe-budgets":
        return {"Budgets": [{"BudgetName": "sea-n-shore-mediaconvert", "BudgetType": "COST", "TimeUnit": "MONTHLY",
                "BudgetLimit": {"Amount": "5.0", "Unit": "USD"}, "CalculatedSpend": {"ActualSpend": {"Amount": "4.2"},
                "ForecastedSpend": {"Amount": "6.1"}}, "CostFilters": {"Service": ["AWS Elemental MediaConvert"]}}]}
    if action == "describe-notifications-for-budget":
        return {"Notifications": [{"NotificationType": "FORECASTED", "ComparisonOperator": "GREATER_THAN", "Threshold": 100,
                "ThresholdType": "PERCENTAGE", "NotificationState": "ALARM"}]}
    if action == "describe-budget-performance-history":
        return {"BudgetPerformanceHistory": {"BudgetedAndActualAmountsList": [
            {"TimePeriod": {"Start": "2026-11-01T00:00:00Z"}, "BudgetedAmount": {"Amount": "5.0"}, "ActualAmount": {"Amount": "4.2"}}]}}
    return {}
r.aws = fake_aws
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    r.section_budgets()
text = buf.getvalue()
print(text)
assert 'BUDGET "sea-n-shore-mediaconvert" type=COST unit=MONTHLY limit=5.0 USD actual=4.2 forecast=6.1 filters={"Service": 1}' in text, text
assert 'BUDGET_ALERT "sea-n-shore-mediaconvert" kind=FORECASTED when=GREATER_THAN 100 PERCENTAGE state=ALARM' in text, text
assert 'BUDGET_HISTORY "sea-n-shore-mediaconvert" from=2026-11-01 budgeted=5.0 actual=4.2' in text, text
assert "AWS Elemental MediaConvert" not in text
assert all(region == "us-east-1" for _s, _a, region in calls), calls
`], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr || run.stdout)
})
