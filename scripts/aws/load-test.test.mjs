// Round P3 load test contract: read-only signed-out traffic, the approved ramp and stop rules, under the WAF's
// per-IP limit, owner-armed, and no AWS credentials anywhere near the traffic.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  assert.ok(['plan', 'run-once', 'run-signed-in-once', 'sessions-only-once', 'smoke-signed-in-once', 'run-signed-in-day-once'].includes(guardAction(read('./load-test-action.txt'))))
})

test('the approved ramp, steps and target', () => {
  assert.equal(envValue('LOAD_TEST_TOTAL_RPM'), '100,300,600,1000,2000,3000')
  assert.equal(envValue('LOAD_TEST_STEP_SECONDS'), '300')
  assert.equal(envValue('LOAD_TEST_SHARDS'), '16')
  assert.equal(envValue('LOAD_TEST_ACCOUNTS'), '1000')
  // Owner (18 Nov): 25 -> 50 -> 100 -> 250 -> 500 -> 750 -> 1,000 members at once, 32 requests a minute each, 5 minutes
  // a step; the smoke run is 10 members for 2 minutes.
  assert.deepEqual(envValue('LOAD_TEST_DAY_RPM').split(',').map(Number), [25, 50, 100, 250, 500, 750, 1000].map((members) => members * 32))
  assert.equal(envValue('LOAD_TEST_DAY_STEP_SECONDS'), '300')
  assert.equal(envValue('LOAD_TEST_SMOKE_RPM'), String(10 * 32))
  assert.equal(envValue('LOAD_TEST_SMOKE_STEP_SECONDS'), '120')
  assert.equal(jobOf('load').match(/shard: \[([0-9, ]+)\]/)[1], Array.from({ length: 16 }, (_, i) => i).join(', '))
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
  // Signed in, the per-address limit does not count requests with a session; the ceiling of 20,000 per 5 minutes per
  // address does: every shard stays at or under half of it at the daytime run's top step, and the smoke run's.
  assert.match(read('../../infra/aws/app/edge.tf'), /evaluation_window_sec = 300\n\s+limit\s+= 20000/)
  for (const name of ['LOAD_TEST_DAY_RPM', 'LOAD_TEST_SMOKE_RPM']) {
    for (const total of envValue(name).split(',').map(Number)) {
      for (let shard = 0; shard < shards; shard += 1) assert.ok(shardRate(total, shard) * 5 <= 10000, `${name} ${total}/min on one shard`)
    }
  }
  // And every session stays far under the WAF's 1,000 requests per 5 minutes per session: each shard spreads its
  // requests evenly over its share of the 1,000 accounts.
  assert.match(read('../../infra/aws/app/edge.tf'), /aggregate_key_type    = "CUSTOM_KEYS"\n\s+evaluation_window_sec = 300\n\s+limit                 = 1000/)
  const topPerSession = Math.max(...envValue('LOAD_TEST_DAY_RPM').split(',').map(Number)) / Number(envValue('LOAD_TEST_ACCOUNTS'))
  assert.ok(topPerSession * 5 <= 1000 / 4, `${topPerSession}/min per session`)
  assert.match(script, /const slot = sessionSlot\(exec\.scenario\.iterationInInstance, SESSIONS\.length\)/)
  assert.doesNotMatch(script, /SESSIONS\[\(__VU/)
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
  assert.match(script, /maxVUs: 150/)
  // Profiles visited are the test accounts' own (four digits, 1-1000).
  assert.match(script, /\/people\/sns-load-test-\$\{String\(1 \+ Math\.floor\(Math\.random\(\) \* 1000\)\)\.padStart\(4, '0'\)\}/)
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
  assert.match(window, /\(github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'push' && contains\(fromJSON\('\["sessions-only-once","smoke-signed-in-once","run-signed-in-day-once"\]'\), needs\.apply-gate\.outputs\.action\)\)\) \}\}/)
  // Owner (18 Nov): the merge-started arms (proof, smoke, daytime) start only from their own merge, once; the nightly
  // arms never from a merge.
  assert.match(window, /\[\[ "\$START" == merge && "\$GITHUB_EVENT_NAME" == push \]\]/)
  assert.match(window, /\[\[ "\$GITHUB_RUN_ATTEMPT" == 1 \]\]/)
  for (const action of ['run-once', 'run-signed-in-once']) assert.match(window, new RegExp(`${action}\\) MIX=[a-z-]+ RPM="\\$LOAD_TEST_TOTAL_RPM" STEP="\\$LOAD_TEST_STEP_SECONDS" START=nightly ;;`))
  assert.match(window, /smoke-signed-in-once\) MIX=signed-in RPM="\$LOAD_TEST_SMOKE_RPM" STEP="\$LOAD_TEST_SMOKE_STEP_SECONDS" START=merge ;;/)
  assert.match(window, /run-signed-in-day-once\) MIX=signed-in RPM="\$LOAD_TEST_DAY_RPM" STEP="\$LOAD_TEST_DAY_STEP_SECONDS" START=merge ;;/)
  // The shards and the report use the armed action's ramp.
  for (const id of ['load', 'report']) {
    assert.match(jobOf(id), /LOAD_TEST_TOTAL_RPM: \$\{\{ needs\.window\.outputs\.rpm \}\}\n\s+LOAD_TEST_STEP_SECONDS: \$\{\{ needs\.window\.outputs\.step_seconds \}\}/, id)
  }
  // The nightly start knows only the two nightly arms, and is disabled for now (owner, 18 Nov).
  assert.match(read('../../.github/workflows/load-test-nightly.yml'), /\^\(run-once\|run-signed-in-once\)\\ \[0-9a-f\]\{40\}\$/)
  assert.ok(window.indexOf('exit 0\n          fi\n          [[ "$TRIGGERING_ACTOR"') > 0, 'every other start still needs the nightly start')
  assert.match(window, /\[\[ "\$TRIGGERING_ACTOR" == "github-actions\[bot\]" \]\]/)
  // 19:30 UTC today by arithmetic (Ubuntu 26.04's Rust date is not relied on to parse a date string).
  assert.match(window, /START=\$\(\( NOW - NOW % 86400 \+ 70200 \)\)/)
  assert.match(window, /NOW < START \|\| NOW > START \+ 2700/)
  assert.doesNotMatch(window, /sleep/)
  assert.match(window, /event=workflow_dispatch&head_sha=\$GITHUB_SHA/)
  assert.match(window, /select\(\.id != \$GITHUB_RUN_ID\)\] \| length/)
  assert.match(window, /\[\[ "\$EARLIER" == 0 \]\]/)
  assert.match(window, /run-once\) MIX=signed-out /)
  assert.match(window, /run-signed-in-once\) MIX=signed-in /)
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
  assert.match(sessions, /jq -e --argjson n "\$LOAD_TEST_ACCOUNTS" 'type == "array" and length == \$n and all/)
  assert.match(sessions, /grep -E "\^LOAD_TEST_SESSIONS_STORED count=\$LOAD_TEST_ACCOUNTS bytes=\[0-9\]\+\\\$" <<<"\$OUTPUT"/)
  assert.doesNotMatch(workflow, /curl [^\n]*\$URL|LOAD_TEST_SESSIONS_URL|ci-checkouts\/load-test-sessions|SEALED_PART/)
  // The get-object metadata and the object itself stay in files: never printed.
  assert.doesNotMatch(sessions, /cat "\$WORK\/(sealed|object\.json)"|jq [^\n]*object\.json[^\n]*\| tee/)
  assert.match(sessions, /LOAD_TEST_HANDOFF_KEY: \$\{\{ secrets\.LOAD_TEST_HANDOFF_KEY \}\}/)
  // The opened sessions only ever go from one file into seal-shards: never printed, never an output.
  assert.doesNotMatch(sessions, /cat "\$WORK|echo "\$\(cat|tee [^|]*sessions/)
  assert.deepEqual([...sessions.matchAll(/[^\n]*\$WORK\/sessions\.json[^\n]*/g)].map((m) => m[0].trim().split(' ').slice(0, 3).join(' ')), [
    'node scripts/load-test/sessions.mjs open', 'jq -e --argjson', 'node scripts/load-test/sessions.mjs seal-shards',
  ])
  assert.match(sessions, /jq -e --argjson n "\$LOAD_TEST_ACCOUNTS" '[^']*' "\$WORK\/sessions\.json" >\/dev\/null \|\|/)
  assert.match(jobOf('load'), /node scripts\/load-test\/sessions\.mjs open-shard "\/tmp\/sealed-handoff\/shard-\$LOAD_TEST_SHARD\.sealed" "\$LOAD_TEST_SESSIONS_FILE"/)
  assert.match(jobOf('load'), /rm -f "\$LOAD_TEST_SESSIONS_FILE"/)
  assert.match(jobOf('report'), /load-test-host-command\.sh sign-out/)
  // Accounts exist only for the run: created before the sessions, deleted (with counts) after the sign-out.
  assert.match(sessions, /load-test-host-command\.sh create-once[\s\S]*sessions\.mjs keypair/)
  assert.match(jobOf('report'), /sign-out[\s\S]*load-test-host-command\.sh delete-once[\s\S]*DELETE_ONCE_VERIFIED=true/)
  // Run 44328902760: a failed sign-out must not skip the deletion, and a failed task shows its own failure line.
  assert.match(jobOf('report'), /OUTPUT="\$\(bash scripts\/aws\/load-test-host-command\.sh sign-out "\$GITHUB_SHA" "\$GITHUB_RUN_ID"\)" \|\| FAILED=1\n/)
  assert.match(jobOf('report'), /DELETED="\$\(bash scripts\/aws\/load-test-host-command\.sh delete-once "\$GITHUB_SHA" "\$GITHUB_RUN_ID"\)" \|\| FAILED=1\n/)
  assert.match(jobOf('report'), /grep -E '\^LOAD_TEST_ACCOUNTS_' <<<"\$\{OUTPUT:-\}" >&2 \|\| true/)
  assert.match(jobOf('report'), /exit "\$FAILED"/)
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

test('public repository: no sealed session, k6 log or relative date in the run; the hand-off artifact is deleted', () => {
  // Ubuntu 26.04 (ubuntu-latest) ships the Rust coreutils: no date string parsing anywhere in the run.
  assert.doesNotMatch(workflow, /date (-u )?-d |date --date/)
  // A job output or an environment value is printed in the public log: the sealed parts never travel that way.
  assert.doesNotMatch(workflow, /outputs\.sealed|LOAD_TEST_SHARD_SEALED|sealed=\$|echo "sealed=/)
  const sessions = jobOf('sessions')
  assert.match(sessions, /node scripts\/load-test\/sessions\.mjs seal-shards "\$WORK\/sessions\.json" "\$LOAD_TEST_SHARDS" \/tmp\/sealed-handoff\n/)
  assert.match(sessions, /- name: Hand the sealed parts to the shards\n\s+uses: actions\/upload-artifact@[0-9a-f]{40} # v4\.6\.2\n\s+with:\n\s+name: sealed-handoff\n\s+path: \/tmp\/sealed-handoff\n\s+retention-days: 1\n\s+if-no-files-found: error\n/)
  assert.match(sessions, /- name: Delete the sealed parts from this runner\n\s+if: always\(\)\n\s+shell: bash\n\s+run: rm -rf \/tmp\/sealed-handoff\n/)
  const load = jobOf('load')
  assert.match(load, /uses: actions\/download-artifact@[0-9a-f]{40} # v4\.3\.0\n\s+with:\n\s+name: sealed-handoff\n\s+path: \/tmp\/sealed-handoff\n/)
  assert.match(load, /open-shard [^\n]*\n\s+rm -rf \/tmp\/sealed-handoff\n/)
  // The monitor deletes it once every shard has opened its part; the report job again, whatever happened.
  const monitor = jobOf('monitor')
  assert.match(monitor, /"\$SHARDS" == "\$LOAD_TEST_SHARDS" && "\$OPENED" == "\$SHARDS"[^\n]*\n\s+bash scripts\/load-test\/delete-handoff-artifact\.sh/)
  const report = jobOf('report')
  assert.match(report, /permissions:\n\s+id-token: write\n\s+contents: read\n\s+actions: write\n/)
  assert.match(report, /- name: Delete the sealed hand-off artifact and count what is left\n\s+if: always\(\) && \(needs\.window\.outputs\.mix == 'signed-in' \|\| needs\.window\.outputs\.mix == 'sessions-only'\)\n[\s\S]*?run: bash scripts\/load-test\/delete-handoff-artifact\.sh/)
  // The report downloads only the numbers (load-test-*), never the sealed hand-off.
  assert.match(report, /pattern: load-test-\*\n/)
  assert.ok(!'sealed-handoff'.startsWith('load-test-'))
  const remover = read('../load-test/delete-handoff-artifact.sh')
  assert.match(remover, /actions\/runs\/\$\{GITHUB_RUN_ID\}\/artifacts\?name=sealed-handoff/)
  assert.match(remover, /\[\[ "\$LEFT" == 0 \]\]$/m)
  assert.equal((remover.match(/-X DELETE/g) ?? []).length, 1)
  // k6's own log and summary (they name request URLs) stay on the runner: only their counts are printed.
  assert.match(load, /k6 run --quiet --summary-mode=disabled --log-output=file=\/tmp\/k6\.log --out csv=\/tmp\/k6\.csv scripts\/load-test\/p3-load-test\.js &/)
  assert.match(load, /echo "LOAD_TEST_K6_LOG warnings=\$\(grep -c 'level=warning' \/tmp\/k6\.log/)
  assert.doesNotMatch(load, /cat \/tmp\/k6\.log|tee [^\n]*k6\.log/)
})

test('seal-shards and open-shard hand sessions over as 0600 files and print counts only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-'))
  try {
    const key = randomBytes(32).toString('base64')
    const sessions = Array.from({ length: 50 }, (_, i) => ({ index: i + 1, accessToken: `access-${i + 1}`, refreshToken: `refresh-${i + 1}` }))
    const input = join(dir, 'sessions.json')
    execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(input)}, ${JSON.stringify(JSON.stringify(sessions))})`])
    const sealedDir = join(dir, 'sealed')
    execFileSync('mkdir', [sealedDir])
    const cli = new URL('../load-test/sessions.mjs', import.meta.url).pathname
    const env = { ...process.env, LOAD_TEST_HANDOFF_KEY: key }
    const sealedOut = execFileSync('node', [cli, 'seal-shards', input, '8', sealedDir], { env, encoding: 'utf8' })
    assert.equal(sealedOut, 'LOAD_TEST_SESSIONS_SEALED shards=8\n')
    assert.deepEqual(readdirSync(sealedDir).sort(), Array.from({ length: 8 }, (_, i) => `shard-${i}.sealed`).sort())
    const opened = []
    for (let i = 0; i < 8; i += 1) {
      const file = join(sealedDir, `shard-${i}.sealed`)
      assert.equal(statSync(file).mode & 0o777, 0o600)
      assert.doesNotMatch(readFileSync(file, 'utf8'), /access-|refresh-/)
      const out = join(dir, `open-${i}.json`)
      const printed = execFileSync('node', [cli, 'open-shard', file, out], { env, encoding: 'utf8' })
      // Every token is masked in the job log before anything else; the only other line is the count.
      const lines = printed.trim().split('\n')
      assert.ok(lines.slice(0, -1).every((line) => line.startsWith('::add-mask::')))
      assert.match(lines.at(-1), /^LOAD_TEST_SHARD_SESSIONS count=[67]$/)
      assert.equal(statSync(out).mode & 0o777, 0o600)
      opened.push(...JSON.parse(readFileSync(out, 'utf8')))
    }
    assert.deepEqual(opened.map((s) => s.index).sort((a, b) => a - b), sessions.map((s) => s.index))
    assert.throws(() => execFileSync('node', [cli, 'open-shard', join(sealedDir, 'shard-0.sealed'), join(dir, 'x.json')], {
      env: { ...process.env, LOAD_TEST_HANDOFF_KEY: randomBytes(32).toString('base64') }, stdio: 'pipe',
    }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
  assert.match(window, /sessions-only-once\) MIX=sessions-only [^\n]* START=merge ;;/)
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
  assert.match(report, /\[\[ "\$\{#COUNTS\[@\]\}" == "\$LOAD_TEST_SHARDS" && "\$SUM" == "\$LOAD_TEST_ACCOUNTS" \]\]/)
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
