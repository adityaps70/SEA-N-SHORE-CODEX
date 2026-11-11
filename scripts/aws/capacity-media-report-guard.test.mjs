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
  assert.match(remote, /finally:\n\s+aws\("rds-data", "rollback-transaction"/)
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
  assert.match(wrapper, /const DB_SECTIONS = \['config', 'db', 'dbstats', 'dbplans', 'dbhealth', 'cost'\]/)
  assert.match(wrapper, /3 \* 3600_000/)
  const remote = readFileSync(remotePath, 'utf8')
  for (const name of ['db', 'dbstats', 'dbplans', 'dbhealth', 'cost']) assert.match(remote, new RegExp(`"${name}": section_${name}`))
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
