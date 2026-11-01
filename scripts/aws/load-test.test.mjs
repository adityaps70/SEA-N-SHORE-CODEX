// Round P3 load test contract: read-only signed-out traffic, the approved ramp and stop rules, under the WAF's
// per-IP limit, owner-armed, and no AWS credentials anywhere near the traffic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'
import { createStats, stopReason, percentile, summary, MIN_SAMPLES, P95_LIMIT_MS, ERROR_LIMIT } from '../load-test/stop-watch.mjs'
import { mergeShards, reportLines } from '../load-test/report.mjs'
import { openShard, sealShard, splitSessions, handoffKey } from '../load-test/sessions.mjs'
import { randomBytes } from 'node:crypto'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const workflow = read('../../.github/workflows/aws-load-test.yml')
const script = read('../load-test/p3-load-test.js')
const jobOf = (id) => workflow.slice(workflow.indexOf(`\n  ${id}:\n`) + 1).split(/^(?=  [A-Za-z0-9_-]+:\n)/m)[0]
const envValue = (name) => new RegExp(`\\n  ${name}: "?([^"\\n]+)"?\\n`).exec(workflow)?.[1]

test('the guard reads plan or run-once', () => {
  assert.ok(['plan', 'run-once'].includes(guardAction(read('./load-test-action.txt'))))
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

test('stop rules: p95 over 2 s, server errors or WAF blocks over 1%, judged after 30 requests per step', () => {
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
  const slow = Array.from({ length: 40 }, (_, i) => ['lt_req', i < 37 ? 2500 : 100, 'cls=ok&step=2'])
  assert.match(stopReason(csv([...fast, ...slow]).steps), /^step 2: p95 2500 ms/)
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
  const lines = reportLines(mergeShards([[shard(1, 100), shard(2, 300), shard(3, 2600)], [shard(1, 120), shard(2, 320), shard(3, 2400)]]), [100, 300, 600], 300, ['step 3: p95 2600 ms over 2000 ms (50 requests)\n'])
  assert.match(lines[0], /^LOAD_TEST_STEP step=1 target_rpm=100 achieved_rpm=20 requests=100 p50_ms=100 p95_ms=120 .* edge_cache_hit_pct=80\.00 within_limits=true$/)
  assert.match(lines[2], /step=3 .* within_limits=false$/)
  assert.equal(lines[3], 'LOAD_TEST_RESULT highest_step_within_limits=2 highest_rpm_within_limits=300 stopped=true')
  assert.equal(lines[4], 'LOAD_TEST_STOP_REASON step 3: p95 2600 ms over 2000 ms (50 requests)')
  assert.doesNotMatch(lines.join('\n'), /https?:|\/jobs\/|@/)
})

test('owner-armed, approved, inside 01:00-03:00 IST, and the traffic never holds AWS credentials', () => {
  assert.match(jobOf('apply-gate'), /GUARD_FILE: scripts\/aws\/load-test-action\.txt\n\s+shell: bash\n\s+run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(jobOf('apply-approval'), /environment: staging-apply/)
  const window = jobOf('window')
  assert.match(window, /needs\.apply-approval\.result == 'success'/)
  assert.match(window, /\$\(date -u \+%F\) 19:30:00/)
  assert.match(window, /NOW > START \+ 900/)
  assert.match(window, /WAIT > 330 \* 60/)
  assert.match(window, /run-once\) echo "mix=signed-out"/)
  assert.match(window, /run-signed-in-once\) echo "mix=signed-in"/)
  assert.match(window, /\*\) echo "Not armed for a run." >&2; exit 1 ;;/)
  assert.match(window, /Branch moved after the load test was approved/)
  for (const id of ['plan', 'window', 'load']) assert.doesNotMatch(jobOf(id), /configure-aws-credentials|AWS_ROLE_TO_ASSUME/, id)
  // Signed in: the sessions job seals everything; shards only ever open their own sealed part with the GitHub secret.
  const sessions = jobOf('sessions')
  assert.match(sessions, /node scripts\/load-test\/sessions\.mjs keypair "\$WORK"/)
  assert.match(sessions, /aws s3 rm --only-show-errors/)
  assert.match(sessions, /LOAD_TEST_HANDOFF_KEY: \$\{\{ secrets\.LOAD_TEST_HANDOFF_KEY \}\}/)
  // The opened sessions only ever go from one file into seal-shards: never printed, never an output.
  assert.doesNotMatch(sessions, /cat "\$WORK|echo "\$\(cat|tee [^|]*sessions/)
  assert.deepEqual([...sessions.matchAll(/[^\n]*\$WORK\/sessions\.json[^\n]*/g)].map((m) => m[0].trim().split(' ').slice(0, 3).join(' ')), [
    'node scripts/load-test/sessions.mjs open', 'SEALED="$(node scripts/load-test/sessions.mjs seal-shards',
  ])
  assert.match(jobOf('load'), /node scripts\/load-test\/sessions\.mjs open-shard "\$LOAD_TEST_SESSIONS_FILE"/)
  assert.match(jobOf('load'), /rm -f "\$LOAD_TEST_SESSIONS_FILE"/)
  assert.match(jobOf('report'), /load-test-host-command\.sh sign-out/)
  // Accounts exist only for the run: created before the sessions, deleted (with counts) after the sign-out.
  assert.match(sessions, /load-test-host-command\.sh create-once[\s\S]*sessions\.mjs keypair/)
  assert.match(jobOf('report'), /sign-out[\s\S]*load-test-host-command\.sh delete-once[\s\S]*DELETE_ONCE_VERIFIED=true/)
  // Stop rule 3: the monitor cancels the run when Aurora sits at its maximum ACU for 5 minutes.
  assert.match(jobOf('monitor'), /node scripts\/load-test\/aurora-stop\.mjs "\$VALUES" "\$LOAD_TEST_AURORA_MAX_ACU"/)
  assert.match(jobOf('monitor'), /LOAD_TEST_AURORA_MAX_ACU: "2"/)
  assert.match(read('../../infra/aws/app/aws-native-variables.tf'), /variable "aurora_max_acu" \{[^}]*default\s+= 2/)
  assert.match(jobOf('load'), /needs\.window\.result == 'success'/)
  assert.match(jobOf('report'), /needs\.apply-gate\.result == 'success'/)
  assert.match(jobOf('report'), /REPORT_SECTIONS: usage/)
  // The plan run never touches the site: it runs the pipeline against a local server.
  assert.match(jobOf('plan'), /LOAD_TEST_BASE_URL: http:\/\/127\.0\.0\.1:8099/)
  assert.match(jobOf('plan'), /LOAD_TEST_PLAN_ONLY_NO_TRAFFIC/)
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

test('the Aurora stop rule needs 5 one-minute maximums all at the maximum ACU', async () => {
  const { auroraAtMax } = await import('../load-test/aurora-stop.mjs')
  assert.equal(auroraAtMax([2, 2, 2, 2, 2], 2), true)
  assert.equal(auroraAtMax([1.5, 2, 2, 2, 2, 2], 2), true)
  assert.equal(auroraAtMax([2, 2, 2, 1.5, 2], 2), false)
  assert.equal(auroraAtMax([2, 2, 2, 2], 2), false)
  assert.equal(auroraAtMax('nope', 2), false)
})
