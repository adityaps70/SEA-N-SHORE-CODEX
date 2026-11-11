// Round P3 load test contract: read-only signed-out traffic, the approved ramp and stop rules, under the WAF's
// per-IP limit, owner-armed, and no AWS credentials anywhere near the traffic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'
import { createStats, stopReason, percentile, summary, MIN_SAMPLES, P95_LIMIT_MS, ERROR_LIMIT } from '../load-test/stop-watch.mjs'
import { mergeShards, reportLines } from '../load-test/report.mjs'
import { MONITOR_MINUTES, MONITOR_RULES, monitorStopReason } from '../load-test/monitor-stop.mjs'
import { openShard, sealShard, splitSessions, handoffKey } from '../load-test/sessions.mjs'
import { randomBytes } from 'node:crypto'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const workflow = read('../../.github/workflows/aws-load-test.yml')
const script = read('../load-test/p3-load-test.js')
const jobOf = (id) => workflow.slice(workflow.indexOf(`\n  ${id}:\n`) + 1).split(/^(?=  [A-Za-z0-9_-]+:\n)/m)[0]
const envValue = (name) => new RegExp(`\\n  ${name}: "?([^"\\n]+)"?\\n`).exec(workflow)?.[1]

test('the guard reads plan, run-once, run-signed-in-once or sessions-only-once', () => {
  assert.ok(['plan', 'run-once', 'run-signed-in-once', 'sessions-only-once'].includes(guardAction(read('./load-test-action.txt'))))
})

test('the approved ramp, steps and target', () => {
  assert.equal(envValue('LOAD_TEST_TOTAL_RPM'), '100,300,600,1000,2000,3000')
  assert.equal(envValue('LOAD_TEST_STEP_SECONDS'), '300')
  assert.equal(envValue('LOAD_TEST_SHARDS'), '8')
  assert.equal(envValue('LOAD_TEST_BASE_URL'), 'https://seanshore.in')
})

test('every shard stays under the WAF limit of 2,000 requests per 5 minutes per IP', () => {
  const shards = Number(envValue('LOAD_TEST_SHARDS'))
  assert.match(script, /Math\.floor\(total \/ shards\) \+ \(shard < total % shards \? 1 : 0\)/)
  const shardRate = (total, shard) => Math.floor(total / shards) + (shard < total % shards ? 1 : 0)
  for (const total of envValue('LOAD_TEST_TOTAL_RPM').split(',').map(Number)) {
    let sum = 0
    for (let shard = 0; shard < shards; shard += 1) {
      sum += shardRate(total, shard)
      assert.ok(shardRate(total, shard) * 5 < 2000, `${total}/min puts ${shardRate(total, shard)}/min on one shard`)
    }
    assert.equal(sum, total)
  }
  assert.match(read('../../infra/aws/app/edge.tf'), /evaluation_window_sec = 300\n\s+limit\s+= 2000/)
})

test('signed-out: only GETs of public pages; signed-in: reads, plus only the two read-only actions and the realtime ticket', () => {
  assert.equal([...new Set(script.match(/http\.\w+\(/g) ?? [])].sort().join(), 'http.get(,http.post(')
  assert.match(script, /const PATHS = \['\/', '\/jobs', JOB_PATH, COURSE_PATH, '\/privacy'\]/)
  assert.match(script, /userAgent: 'SeaNShore-LoadTest\/1'/)
  assert.equal((script.match(/'X-SNS-Load-Test': 'P3'/g) ?? []).length, 2, 'both mixes mark every request')
  // Requests look like browser page loads, so public pages can be served from the edge cache as for real visitors.
  assert.match(script, /const BROWSER_PAGE_LOAD = \{ Accept: 'text\/html,application\/xhtml\+xml', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' \}/)
  assert.match(script, /headers: \{ 'X-SNS-Load-Test': 'P3', 'User-Agent': stepAgent, \.\.\.BROWSER_PAGE_LOAD \}/)
  // Round DB: both mixes name the ramp step in the User-Agent, so the ALB's server-side times are cut per step.
  assert.match(script, /stepAgent = `SeaNShore-LoadTest\/1 step\/\$\{step\}`/)
  assert.match(script, /const base = \{ 'X-SNS-Load-Test': 'P3', 'User-Agent': stepAgent, Cookie: cookie \}/)
  // Signed in too: page loads are browser page loads; only the realtime state (a fetch) is not.
  assert.match(script, /headers: path\.startsWith\('\/api\/'\) \? base : \{ \.\.\.base, \.\.\.BROWSER_PAGE_LOAD \}/)
  assert.match(script, /redirects: 0/)
  assert.match(script, /discardResponseBodies: true/)
  assert.match(script, /maxVUs: 100/)
  // The only POSTs: the two read-only server actions (ids from the deployed build) and the realtime ticket.
  const posts = [...script.matchAll(/http\.post\(([^,]+),/g)].map((match) => match[1].trim())
  assert.deepEqual(posts, ['`${BASE_URL}/home`', '`${BASE_URL}/api/realtime/ticket`'])
  assert.match(script, /'Next-Action': id/)
  assert.deepEqual([...script.matchAll(/ACTIONS\.(\w+)/g)].map((match) => match[1]).filter((name, i, all) => all.indexOf(name) === i).sort(), ['loadTopFeedPage', 'loadUnreadNotificationCount'])
  // No like, unlike, post, comment, follow or message send until the realtime broadcast fix is live.
  assert.doesNotMatch(script, /setPostLiked|setPostReaction|createPost|addComment|follow|sendMessage|signal/i)
  const actions = read('../../src/features/load-test/accounts.ts')
  assert.match(actions, /loadTopFeedPage: 'src\/features\/feed\/actions\.ts',\n\s+loadUnreadNotificationCount: 'src\/features\/notifications\/actions\.ts',\n\} as const/)
  // Weights follow P3's signed-in routes and add up to 100.
  const weights = [...script.matchAll(/\['([a-z-]+)', (\d+)\]/g)].map((match) => Number(match[2]))
  assert.equal(weights.reduce((sum, w) => sum + w, 0), 100)
})

test('shard stop rules: server errors, WAF blocks or refused sessions over 1%, judged after 30 requests per step; client p95 is reported, not a stop', () => {
  assert.equal(P95_LIMIT_MS, 2000)
  assert.equal(ERROR_LIMIT, 0.01)
  assert.equal(MIN_SAMPLES, 30)
  const csv = (rows) => {
    const stats = createStats()
    stats.add('metric_name,timestamp,metric_value,check,error,error_code,expected_response,group,method,name,proto,scenario,service,status,subproto,tls_version,url,extra_tags,metadata')
    for (const [metric, value, extra] of rows) stats.add(`${metric},1,${value},,,,,,,,,ramp,,,,,,${extra},`)
    return stats
  }
  const fast = Array.from({ length: 40 }, () => ['lt_req', 120, 'cls=ok&step=1'])
  assert.equal(stopReason(csv(fast).steps), null)
  // One slow first request is not judged on its own.
  assert.equal(stopReason(csv([['lt_req', 9000, 'cls=ok&step=2'], ...fast]).steps), null)
  // Round DB (owner, 11 Nov): a slow client p95 (measured from GitHub's US runners) no longer stops the run; the p95
  // stop is the server-side one in the monitor job.
  const slow = Array.from({ length: 40 }, (_, i) => ['lt_req', i < 37 ? 2500 : 100, 'cls=ok&step=2'])
  assert.equal(stopReason(csv([...fast, ...slow]).steps), null)
  assert.match(stopReason(csv([...fast, ...slow, ['lt_req', 100, 'cls=5xx&step=2']]).steps), /^step 2: server errors 1\/41/)
  const errors = [...fast, ['lt_req', 100, 'cls=5xx&step=1']]
  assert.match(stopReason(csv(errors).steps), /^step 1: server errors 1\/41/)
  assert.match(stopReason(csv([...fast, ['lt_req', 100, 'cls=neterr&step=1']]).steps), /server errors/)
  assert.match(stopReason(csv([...fast, ['lt_req', 100, 'cls=blocked&step=1']]).steps), /WAF blocks/)
  assert.match(stopReason(csv([...fast, ['lt_req', 100, 'cls=auth&step=1']]).steps), /signed-in sessions refused 1\/41/)
  // 404s and redirects are reported, not stop reasons; cache samples are counted separately.
  const stats = csv([...fast, ['lt_req', 100, 'cls=other&step=1'], ['lt_hit', 1, 'step=1'], ['lt_hit', 0, 'step=1'], ['http_req_duration', 5, 'step=1']])
  assert.equal(stopReason(stats.steps), null)
  const [step1] = summary(stats.steps)
  assert.deepEqual({ requests: step1.requests, other: step1.other, cache_hits: step1.cache_hits, cache_samples: step1.cache_samples }, { requests: 41, other: 1, cache_hits: 1, cache_samples: 2 })
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10)
})

test('the report merges shards and names the highest step within limits, with aggregates only', () => {
  const shard = (step, ms, server = 0) => ({ step, requests: 50, ok: 50 - server, server_errors: server, blocked: 0, other: 0, cache_hits: 40, cache_samples: 50, durations_ms: Array(50).fill(ms) })
  // Round DB: the monitor's server-side stop names no step, so it marks the last step that ran.
  const monitorStop = 'server-side p95 over 2 s for 3 minutes (2.1, 2.5, 3 s)\n'
  const lines = reportLines(mergeShards([[shard(1, 100), shard(2, 300), shard(3, 2600)], [shard(1, 120), shard(2, 320), shard(3, 2400)]]), [100, 300, 600], 300, [monitorStop])
  // Every client figure says where it was measured from.
  assert.match(lines[0], /^LOAD_TEST_STEP step=1 target_rpm=100 achieved_rpm=20 requests=100 p50_ms=100 p95_ms=120 .* edge_cache_hit_pct=80\.00 within_limits=true measured_from=github_us_runners$/)
  assert.match(lines[2], /step=3 .* within_limits=false measured_from=github_us_runners$/)
  assert.equal(lines[3], 'LOAD_TEST_RESULT highest_step_within_limits=2 highest_rpm_within_limits=300 stopped=true')
  assert.equal(lines[4], 'LOAD_TEST_STOP_REASON server-side p95 over 2 s for 3 minutes (2.1, 2.5, 3 s)')
  // The client yardstick, kept alongside the server-side one: the highest step from the first within limits with p95 under 1 s.
  assert.equal(lines[5], 'LOAD_TEST_P95_UNDER_1S_CLIENT highest_step=2 highest_rpm=300 measured_from=github_us_runners')
  // A shard's stop names its step; that step is not within limits even if a later step ran.
  const shardStop = reportLines(mergeShards([[shard(1, 100), shard(2, 300, 5), shard(3, 300)]]), [100, 300, 600], 300, ['step 2: server errors 5/50 over 1%'])
  assert.match(shardStop.join('\n'), /^LOAD_TEST_RESULT highest_step_within_limits=1 highest_rpm_within_limits=100 stopped=true$/m)
  // A slow client p95 alone is not over a limit any more (no stop, within limits); it only ends the under-1 s count.
  const slower = reportLines(mergeShards([[shard(1, 400), shard(2, 1200), shard(3, 2500)]]), [100, 300, 600], 300)
  assert.match(slower.join('\n'), /^LOAD_TEST_RESULT highest_step_within_limits=3 highest_rpm_within_limits=600 stopped=false$/m)
  assert.equal(slower.at(-1), 'LOAD_TEST_P95_UNDER_1S_CLIENT highest_step=1 highest_rpm=100 measured_from=github_us_runners')
  assert.equal(reportLines(mergeShards([[shard(1, 1000)]]), [100], 300).at(-1), 'LOAD_TEST_P95_UNDER_1S_CLIENT highest_step=0 highest_rpm=0 measured_from=github_us_runners')
  assert.doesNotMatch(lines.join('\n'), /https?:|\/jobs\/|@/)
})

test('owner-armed, started only by the nightly schedule inside 01:00-01:45 IST, once per arm, no AWS credentials in the traffic', () => {
  assert.match(jobOf('apply-gate'), /GUARD_FILE: scripts\/aws\/load-test-action\.txt\n\s+shell: bash\n\s+run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(jobOf('apply-approval'), /environment: staging-apply/)
  const window = jobOf('window')
  assert.match(window, /needs\.apply-approval\.result == 'success'/)
  // Merging a traffic arm (a push) sends no traffic: only the nightly start reaches the window with one. The only push
  // that reaches it is the sessions-only proof's own arm, which sends no traffic.
  assert.match(window, /\(github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'push' && needs\.apply-gate\.outputs\.action == 'sessions-only-once'\)\) \}\}/)
  assert.match(window, /\[\[ "\$MIX" == sessions-only && "\$GITHUB_EVENT_NAME" == push \]\]/)
  assert.match(window, /\[\[ "\$GITHUB_RUN_ATTEMPT" == 1 \]\]/)
  assert.ok(window.indexOf('exit 0\n          fi\n          [[ "$TRIGGERING_ACTOR"') > 0, 'every other start still needs the nightly start')
  assert.match(window, /\[\[ "\$TRIGGERING_ACTOR" == "github-actions\[bot\]" \]\]/)
  assert.match(window, /\$\(date -u \+%F\) 19:30:00/)
  assert.match(window, /NOW < START \|\| NOW > START \+ 2700/)
  assert.doesNotMatch(window, /sleep/)
  assert.match(window, /event=workflow_dispatch&head_sha=\$GITHUB_SHA/)
  assert.match(window, /select\(\.id != \$GITHUB_RUN_ID\)\] \| length/)
  assert.match(window, /\[\[ "\$EARLIER" == 0 \]\]/)
  assert.match(window, /run-once\) echo "mix=signed-out"/)
  assert.match(window, /run-signed-in-once\) echo "mix=signed-in"/)
  assert.match(window, /\*\) echo "Not armed for a run." >&2; exit 1 ;;/)
  assert.match(window, /Branch moved after the load test was approved/)
  for (const id of ['plan', 'window', 'load']) assert.doesNotMatch(jobOf(id), /configure-aws-credentials|AWS_ROLE_TO_ASSUME/, id)
  // Signed in: the sessions job seals everything; shards only ever open their own sealed part with the GitHub secret.
  const sessions = jobOf('sessions')
  assert.match(sessions, /node scripts\/load-test\/sessions\.mjs keypair "\$WORK"/)
  // The S3 hand-off: the task wrote the run's one object; this job reads it, checks its KMS key, deletes it and
  // proves the prefix is empty, then checks the opened count. Nothing comes from a log or a link any more.
  assert.match(sessions, /LOAD_TEST_HANDOFF_BUCKET: sea-n-shore-staging-310356785722-load-test-handoff\n/)
  assert.match(sessions, /LOAD_TEST_HANDOFF_OBJECT: sessions\/\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\.sealed\n/)
  assert.match(sessions, /load-test-host-command\.sh sessions "\$GITHUB_SHA" "\$GITHUB_RUN_ID" "\$PUBLIC_KEY" "\$LOAD_TEST_HANDOFF_OBJECT"/)
  assert.match(sessions, /aws s3api get-object --bucket "\$LOAD_TEST_HANDOFF_BUCKET" --key "\$LOAD_TEST_HANDOFF_OBJECT" "\$WORK\/sealed" > "\$WORK\/object\.json"/)
  assert.match(sessions, /\.ServerSideEncryption == "aws:kms" and \.BucketKeyEnabled == true/)
  assert.match(sessions, /\[\[ "\$LEFT" == 0 \]\] \|\| \{ echo "The hand-off bucket still holds sessions objects\." >&2; exit 1; \}/)
  assert.match(sessions, /length == 50/)
  assert.doesNotMatch(workflow, /curl [^\n]*\$URL|LOAD_TEST_SESSIONS_URL|ci-checkouts\/load-test-sessions|SEALED_PART/)
  // The get-object metadata and the object itself stay in files: never printed.
  assert.doesNotMatch(sessions, /cat "\$WORK\/(sealed|object\.json)"|jq [^\n]*object\.json[^\n]*\| tee/)
  assert.match(sessions, /LOAD_TEST_HANDOFF_KEY: \$\{\{ secrets\.LOAD_TEST_HANDOFF_KEY \}\}/)
  // The opened sessions only ever go from one file into seal-shards: never printed, never an output.
  assert.doesNotMatch(sessions, /cat "\$WORK|echo "\$\(cat|tee [^|]*sessions/)
  assert.deepEqual([...sessions.matchAll(/[^\n]*\$WORK\/sessions\.json[^\n]*/g)].map((m) => m[0].trim().split(' ').slice(0, 3).join(' ')), [
    'node scripts/load-test/sessions.mjs open', "jq -e 'type", 'SEALED="$(node scripts/load-test/sessions.mjs seal-shards',
  ])
  assert.match(sessions, /jq -e '[^']*' "\$WORK\/sessions\.json" >\/dev\/null \|\|/)
  assert.match(jobOf('load'), /node scripts\/load-test\/sessions\.mjs open-shard "\$LOAD_TEST_SESSIONS_FILE"/)
  assert.match(jobOf('load'), /rm -f "\$LOAD_TEST_SESSIONS_FILE"/)
  assert.match(jobOf('report'), /load-test-host-command\.sh sign-out/)
  // Accounts exist only for the run: created before the sessions, deleted (with counts) after the sign-out.
  assert.match(sessions, /load-test-host-command\.sh create-once[\s\S]*sessions\.mjs keypair/)
  assert.match(jobOf('report'), /sign-out[\s\S]*load-test-host-command\.sh delete-once[\s\S]*DELETE_ONCE_VERIFIED=true/)
  // Run 42479008102: when the run stops before any traffic, the report step fails on missing shards; the sign-out and
  // deletion must still get AWS credentials, so both credential steps run whatever happened above.
  const report = jobOf('report')
  assert.match(report, /- name: Configure AWS credentials with GitHub OIDC\n\s+if: always\(\)\n\s+uses: aws-actions\/configure-aws-credentials/)
  assert.match(report, /- name: Verify staging AWS account\n\s+if: always\(\)\n/)
  assert.ok(report.indexOf('Verify staging AWS account') < report.indexOf('Sign out and delete every test account'))
  // A failed accounts task shows its own count and failure lines instead of nothing.
  for (const mode of ['create-once', 'sessions']) {
    assert.match(sessions, new RegExp(`load-test-host-command\\.sh ${mode} [^\\n]*\\|\\| \\{ grep -E '\\^LOAD_TEST_ACCOUNTS_' [^\\n]*>&2 \\|\\| true; exit 1; \\}`))
  }
  // Round DB stop rules (owner, 11 Nov), judged server-side by the monitor every minute: Aurora CPU >= 90% or DB load
  // >= 1.5 sessions or ALB p95 > 2 s, each for 3 minutes. Aurora at its maximum ACU is logged as information only.
  const monitor = jobOf('monitor')
  assert.match(monitor, /LOAD_TEST_AURORA_CLUSTER: sea-n-shore-staging-aurora\n/)
  assert.match(monitor, /LOAD_TEST_AURORA_WRITER: sea-n-shore-staging-aurora-writer\n/)
  assert.match(monitor, /ALB="\$\(bash scripts\/aws\/alb-metric-dimension\.sh\)"/)
  assert.match(monitor, /series AWS\/RDS CPUUtilization "Name=DBClusterIdentifier,Value=\$LOAD_TEST_AURORA_CLUSTER" "--statistics Maximum" \.Maximum/)
  assert.match(monitor, /series AWS\/RDS DBLoad "Name=DBInstanceIdentifier,Value=\$LOAD_TEST_AURORA_WRITER" "--statistics Average" \.Average/)
  assert.match(monitor, /series AWS\/ApplicationELB TargetResponseTime "Name=LoadBalancer,Value=\$ALB" "--extended-statistics p95" '\.ExtendedStatistics\.p95'/)
  assert.match(monitor, /--period 60/)
  assert.match(monitor, /aurora_acu_info=\$ACU/)
  assert.match(monitor, /if REASON="\$\(node scripts\/load-test\/monitor-stop\.mjs "\$\(jq -nc [^\n]*'\{cpu: \$cpu, dbLoad: \$dbLoad, p95: \$p95\}'\)"\)"; then/)
  assert.doesNotMatch(monitor, /aurora-stop|LOAD_TEST_AURORA_MAX_ACU/)
  // The stop counts in the report (stopped=true and its reason): the monitor uploads it, the report waits for it.
  assert.match(monitor, /echo "\$REASON" > \/tmp\/monitor\/stop-monitor\.txt\n\s+curl -fsS -X POST [^\n]*"\$API\/cancel"/)
  assert.match(monitor, /name: load-test-monitor\n\s+path: \/tmp\/monitor\n/)
  assert.match(jobOf('report'), /needs:\n(\s+(#[^\n]*|- [a-z-]+)\n)*\s+- monitor\n/)
  assert.match(jobOf('report'), /pattern: load-test-\*\n/)
  assert.match(jobOf('report'), /find \/tmp\/shards -name 'stop-\*\.txt'/)
  // Server-side p95 per step (the owner's yardstick), from the ALB logs, next to the client figures.
  assert.match(jobOf('report'), /LOAD_TEST_STEP_RPM: \$\{\{ env\.LOAD_TEST_TOTAL_RPM \}\}/)
  assert.match(jobOf('report'), /grep -E '\^LOAD_TEST_\(STEP_SERVER\|P95_UNDER_1S_SERVER\) ' \/tmp\/site-metrics\.txt/)
  // Run 42486602879: the monitor must keep watching while the signed-in sessions job runs, before any shard exists.
  assert.match(jobOf('monitor'), /select\(\.name == "sessions" or \(\.name \| startswith\("load"\)\)\) \| select\(\.status != "completed"\)/)
  assert.match(jobOf('monitor'), /\[\[ "\$LEFT" == 0 && "\$SHARDS" -gt 0 && \$minute -gt 2 \]\]/)
  assert.match(jobOf('load'), /needs\.window\.result == 'success'/)
  assert.match(jobOf('report'), /needs\.apply-gate\.result == 'success'/)
  assert.match(jobOf('report'), /REPORT_SECTIONS: usage/)
  // The plan run never touches the site: it runs the pipeline against a local server.
  assert.match(jobOf('plan'), /LOAD_TEST_BASE_URL: http:\/\/127\.0\.0\.1:8099/)
  assert.match(jobOf('plan'), /LOAD_TEST_PLAN_ONLY_NO_TRAFFIC/)
})

test('the nightly start fires at 01:05 IST from the default branch and starts only an unused run-once or run-signed-in-once arm', () => {
  const nightly = read('../../.github/workflows/load-test-nightly.yml')
  assert.match(nightly, /\non:\n  schedule:\n    - cron: "35 19 \* \* \*"\n/)
  // Also started by hand at 01:05 IST (the schedule fires 3-5 hours late), the same as the copy on main; the start
  // passes the same checks here and in AWS Load Test. Never by a push or a pull request.
  assert.match(nightly, /\n  workflow_dispatch:\n\npermissions:/)
  assert.doesNotMatch(nightly, /push:|pull_request/)
  assert.match(nightly, /permissions:\n  contents: read\n  actions: write\n\n/)
  assert.match(nightly, /timeout-minutes: 5\n/)
  assert.doesNotMatch(nightly, /configure-aws-credentials|AWS_ROLE_TO_ASSUME|secrets\./)
  assert.match(nightly, /BRANCH: feat\/aws-native-phase-0-1\n/)
  assert.match(nightly, /contents\/\$GUARD_FILE\?ref=\$HEAD/)
  assert.match(nightly, /if \[\[ ! "\$GUARD" =~ \^\(run-once\|run-signed-in-once\)\\ \[0-9a-f\]\{40\}\$ \]\]; then\n.*\n\s+exit 0\n/)
  assert.match(nightly, /event=workflow_dispatch&head_sha=\$HEAD/)
  // It starts exactly one thing: AWS Load Test on the feature branch, after both checks.
  assert.deepEqual(nightly.match(/gh workflow run [^\n]+/g), ['gh workflow run aws-load-test.yml --repo "$GITHUB_REPOSITORY" --ref "$BRANCH"'])
  assert.ok(nightly.indexOf('gh workflow run') > nightly.indexOf('already started once'))
})

test('the page picker finds a job and a course link with or without a query string', () => {
  const window = jobOf('window')
  const job = new RegExp(/grep -oE '(href="\/jobs\/[^']+)' <<<"\$JOBS_HTML"/.exec(window)[1])
  const course = new RegExp(/grep -oE '(href="\/learn\/courses\/[^']+)' <<<"\$LEARN_HTML"/.exec(window)[1])
  const strip = (m) => m.replace(/^href="/, '').replace(/["?]$/, '')
  const id = '8fed15f6-552d-4896-9717-656718a77b58'
  for (const html of [`<a href="/jobs/${id}?src=jobs">`, `<a href="/jobs/${id}">`]) assert.equal(strip(job.exec(html)[0]), `/jobs/${id}`)
  for (const html of ['<a href="/learn/courses/oil-record-book?x=1">', '<a href="/learn/courses/oil-record-book">']) assert.equal(strip(course.exec(html)[0]), '/learn/courses/oil-record-book')
  assert.equal(job.exec('<a href="/jobs/new">'), null)
  assert.match(window, /s\/\^href="\/\/; s\/\["\?\]\$\/\/' \|\| true\)/)
})

test('k6 is a pinned package checked against its SHA-256 before it runs', () => {
  assert.match(workflow, /K6_DEB_URL: https:\/\/dl\.k6\.io\/deb\/dists\/stable\/main\/binary-amd64\/k6-v2\.2\.0-amd64\.deb/)
  assert.match(workflow, /K6_DEB_SHA256: [0-9a-f]{64}\n/)
  assert.equal((workflow.match(/echo "\$K6_DEB_SHA256  \/tmp\/k6\.deb" \| sha256sum -c -\n\s+sudo dpkg -i \/tmp\/k6\.deb/g) ?? []).length, 2)
})

test('sessions move from the sessions job to the shards sealed end to end', () => {
  // The accounts worker seals to the run's public key and the runner opens it with the private key (the round trip
  // is tested in src/features/load-test/accounts.integration.test.ts); here, the shard handoff.
  const sessions = Array.from({ length: 50 }, (_, i) => ({ index: i + 1, accessToken: `access-${i + 1}`, refreshToken: null }))
  const parts = splitSessions(sessions, 8)
  assert.deepEqual(parts.map((part) => part.length), [7, 7, 6, 6, 6, 6, 6, 6])
  const key = randomBytes(32)
  const sealedShard = sealShard(parts[3], key)
  assert.doesNotMatch(sealedShard, /access-/)
  assert.deepEqual(openShard(sealedShard, key), parts[3])
  assert.throws(() => openShard(sealedShard, randomBytes(32)))
  assert.throws(() => handoffKey('short'), /32 random bytes/)
})

test('the monitor stop rules need 3 one-minute values all over one limit: CPU >= 90%, DB load >= 1.5, server p95 > 2 s', () => {
  assert.equal(MONITOR_MINUTES, 3)
  assert.deepEqual(MONITOR_RULES.map((rule) => [rule.key, rule.limit]), [['cpu', 90], ['dbLoad', 1.5], ['p95', 2]])
  assert.match(monitorStopReason({ cpu: [91, 92, 95] }), /^Aurora CPU at or above 90% for 3 minutes/)
  assert.match(monitorStopReason({ cpu: [40, 90, 90, 90] }), /CPU/, 'exactly 90% counts')
  assert.match(monitorStopReason({ dbLoad: [1.6, 1.7, 1.5] }), /^DB load at or above 1\.5 sessions/)
  assert.match(monitorStopReason({ p95: [2.1, 2.5, 3] }), /^server-side p95 over 2 s/)
  assert.equal(monitorStopReason({ p95: [2, 2, 2] }), null, 'exactly 2 s is not over 2 s')
  assert.equal(monitorStopReason({ cpu: [95, 95, 89] }), null, 'the last 3 minutes must all hold')
  assert.equal(monitorStopReason({ cpu: [90, 90] }), null, 'fewer than 3 datapoints never stop')
  assert.equal(monitorStopReason({ cpu: [95, 95], dbLoad: [1, 1, 1], p95: [0.2, 0.3, 0.2] }), null)
  assert.equal(monitorStopReason('nope'), null)
  assert.equal(monitorStopReason({ cpu: ['x', null, 95, 95] }), null, 'non-numbers are dropped, not counted')
  // Aurora at its maximum ACU is information, never a stop.
  assert.equal(monitorStopReason({ acu: [2, 2, 2, 2, 2] }), null)
})

test('the sessions-only proof sends no traffic and cleans up everything, whatever happens', () => {
  const window = jobOf('window')
  assert.match(window, /sessions-only-once\) echo "mix=sessions-only"/)
  // No page lookup, no Aurora monitor, no k6, no site metrics wait.
  assert.match(window, /id: pages\n\s+if: steps\.mix\.outputs\.mix != 'sessions-only'/)
  assert.match(jobOf('monitor'), /needs\.window\.outputs\.mix != 'sessions-only' \}\}/)
  const load = jobOf('load')
  assert.match(load, /- name: Install the pinned k6\n\s+if: env\.LOAD_TEST_MIX != 'sessions-only'/)
  assert.match(load, /- name: Run this shard with the stop rules\n\s+if: env\.LOAD_TEST_MIX != 'sessions-only'/)
  assert.equal((load.match(/k6 run/g) || []).length, 1)
  // Each shard opens its own part (the real path) and keeps only a count; the proof deletes the opened file.
  assert.match(load, /if: env\.LOAD_TEST_MIX == 'signed-in' \|\| env\.LOAD_TEST_MIX == 'sessions-only'/)
  assert.match(load, /jq 'length' "\$LOAD_TEST_SESSIONS_FILE" > "\/tmp\/shard\/handoff-count-\$LOAD_TEST_SHARD\.txt"/)
  assert.match(load, /- name: Sessions-only proof \(no traffic\)\n\s+if: env\.LOAD_TEST_MIX == 'sessions-only'\n[\s\S]*?rm -f "\$LOAD_TEST_SESSIONS_FILE"/)
  const report = jobOf('report')
  assert.match(report, /- name: Site metrics during the test \(read-only\)\n\s+if: needs\.window\.outputs\.mix != 'sessions-only'/)
  assert.match(report, /\[\[ "\$\{#COUNTS\[@\]\}" == "\$LOAD_TEST_SHARDS" && "\$SUM" == 50 \]\]/)
  // Sign-out, deletion (with what is left), the hand-off object and the host bundle: always, for both mixes.
  for (const name of ['Sign out and delete every test account (signed-in mix)', 'Delete the hand-off object and count what is left', 'Delete the host checkout bundle']) {
    assert.match(report, new RegExp(`- name: ${name.replace(/[()]/g, '\\$&')}\\n\\s+if: always\\(\\) && \\(needs\\.window\\.outputs\\.mix == 'signed-in' \\|\\| needs\\.window\\.outputs\\.mix == 'sessions-only'\\)`), name)
  }
  assert.match(jobOf('sessions'), /- name: Delete the hand-off object and count what is left\n\s+if: always\(\)\n/)
  for (const job of [jobOf('sessions'), report]) {
    assert.match(job, /aws s3api delete-object --bucket "\$LOAD_TEST_HANDOFF_BUCKET" --key "\$LOAD_TEST_HANDOFF_OBJECT" >\/dev\/null\n\s+LEFT="\$\(aws s3api list-objects-v2 --bucket "\$LOAD_TEST_HANDOFF_BUCKET" --prefix sessions\/ --query 'length\(Contents \|\| `\[\]`\)' --output text\)"/)
    // Run 42980081657: KeyCount reads None on an empty bucket, so "0 left" must count the listed objects.
    assert.doesNotMatch(job, /--query KeyCount/)
  }
  // The nightly start never starts the proof.
  assert.doesNotMatch(read('../../.github/workflows/load-test-nightly.yml'), /sessions-only/)
})

test('the monitor reads the ALB metric dimension read-only through the bootstrap host and prints only that value', () => {
  const lookup = read('./alb-metric-dimension.sh')
  assert.match(lookup, /^set -euo pipefail$/m)
  // One running bootstrap host, one read-only describe, nothing else sent.
  assert.match(lookup, /"Name=tag:Name,Values=sea-n-shore-bootstrap" "Name=instance-state-name,Values=running"/)
  assert.match(lookup, /\[\[ "\$\(jq 'length' <<<"\$IDS"\)" -eq 1 \]\]/)
  assert.match(lookup, /LOOKUP="aws elbv2 describe-load-balancers --region \$AWS_REGION --names sea-n-shore-staging-alb --query 'LoadBalancers\[0\]\.LoadBalancerArn' --output text"/)
  assert.equal((lookup.match(/aws ssm send-command/g) ?? []).length, 1)
  assert.doesNotMatch(lookup, /elbv2 (modify|create|delete|set|add|remove|register|deregister)-|aws (s3|rds|ecs|iam) /)
  // The printed value must be exactly the dimension shape, or the monitor fails instead of watching the wrong thing.
  assert.match(lookup, /\[\[ "\$DIMENSION" =~ \^app\/sea-n-shore-staging-alb\/\[0-9a-f\]\{16\}\$ \]\] \|\| \{ echo "Could not read the ALB's metric dimension\." >&2; exit 1; \}/)
  assert.match(lookup, /printf '%s\\n' "\$DIMENSION"$/m)
  assert.match(jobOf('monitor'), /sparse-checkout: \|\n\s+scripts\/load-test\n\s+scripts\/aws\/alb-metric-dimension\.sh\n/)
})
