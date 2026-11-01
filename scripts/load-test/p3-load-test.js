// Round P3 load test (k6). Signed-out, read-only page fetches only: no sign-in, forms, posts, messages, payments
// or emails. One shard of the run; the workflow starts LOAD_TEST_SHARDS of them on separate runners so each stays
// under the WAF's per-IP limit (2,000 requests per 5 minutes).
//
// Each step of the ramp lasts STEP_SECONDS at a fixed total rate (LOAD_TEST_TOTAL_RPM, requests per minute across
// all shards); this shard sends its share. Every request is tagged with its step and an outcome class, and
// recorded in the lt_req trend (and lt_hit for the CloudFront cache), which scripts/load-test/stop-watch.mjs reads
// from the CSV output to apply the stop rules and build the report.
import http from 'k6/http'
import { Rate, Trend } from 'k6/metrics'

const BASE_URL = __ENV.LOAD_TEST_BASE_URL || ''
const SHARD = Number(__ENV.LOAD_TEST_SHARD || '0')
const SHARDS = Number(__ENV.LOAD_TEST_SHARDS || '8')
const STEP_SECONDS = Number(__ENV.LOAD_TEST_STEP_SECONDS || '300')
const TOTAL_RPM = (__ENV.LOAD_TEST_TOTAL_RPM || '100,300,600,1000,2000,3000').split(',').map(Number)
const JOB_PATH = __ENV.LOAD_TEST_JOB_PATH || ''
const COURSE_PATH = __ENV.LOAD_TEST_COURSE_PATH || ''

if (!/^https?:\/\/[a-z0-9.-]+(:[0-9]+)?$/.test(BASE_URL)) throw new Error('LOAD_TEST_BASE_URL must be an origin')
if (!/^\/jobs\/[0-9a-f-]{36}$/.test(JOB_PATH)) throw new Error('LOAD_TEST_JOB_PATH must be /jobs/<id>')
if (!/^\/learn\/courses\/[a-z0-9-]+$/.test(COURSE_PATH)) throw new Error('LOAD_TEST_COURSE_PATH must be /learn/courses/<slug>')
if (!(SHARDS >= 1 && SHARD >= 0 && SHARD < SHARDS)) throw new Error('bad shard')
if (!TOTAL_RPM.every((rpm) => Number.isInteger(rpm) && rpm > 0)) throw new Error('bad LOAD_TEST_TOTAL_RPM')

const PATHS = ['/', '/jobs', JOB_PATH, COURSE_PATH, '/privacy']

/** This shard's share of a total rate, so the shares add up to exactly the total. */
export function shardRate(total, shard, shards) {
  return Math.floor(total / shards) + (shard < total % shards ? 1 : 0)
}

const stages = []
for (const total of TOTAL_RPM) {
  const rate = Math.max(1, shardRate(total, SHARD, SHARDS))
  stages.push({ target: rate, duration: '5s' }, { target: rate, duration: `${STEP_SECONDS - 5}s` })
}
const peak = Math.max(...TOTAL_RPM.map((total) => shardRate(total, SHARD, SHARDS)))

export const options = {
  discardResponseBodies: true,
  userAgent: 'SeaNShore-LoadTest/1',
  noConnectionReuse: false,
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(1, shardRate(TOTAL_RPM[0], SHARD, SHARDS)),
      timeUnit: '1m',
      // Enough VUs for a 2 s p95 at the top step, with headroom; never more than 100 per shard.
      preAllocatedVUs: Math.min(100, Math.ceil(peak / 20) + 5),
      maxVUs: 100,
      stages,
      gracefulStop: '15s',
    },
  },
  // No k6 thresholds: the stop rules need a minimum sample per step, which stop-watch.mjs applies.
}

const reqTrend = new Trend('lt_req', true)
const hitRate = new Rate('lt_hit')

export function setup() {
  return { startedAt: Date.now() }
}

export default function loadTestIteration(data) {
  const step = Math.min(TOTAL_RPM.length, Math.floor((Date.now() - data.startedAt) / 1000 / STEP_SECONDS) + 1)
  const path = PATHS[Math.floor(Math.random() * PATHS.length)]
  const res = http.get(BASE_URL + path, {
    headers: { 'X-SNS-Load-Test': 'P3' },
    redirects: 0,
    timeout: '20s',
    tags: { name: path === JOB_PATH ? '/jobs/:id' : path === COURSE_PATH ? '/learn/courses/:slug' : path },
  })
  const status = res.status
  const cls = status === 0 ? 'neterr' : status >= 500 ? '5xx' : status === 403 || status === 429 ? 'blocked' : status >= 400 ? 'other' : 'ok'
  reqTrend.add(res.timings.duration, { step: String(step), cls })
  const cache = String((res.headers && (res.headers['X-Cache'] || res.headers['x-cache'])) || '')
  hitRate.add(/^(Hit|RefreshHit)/i.test(cache), { step: String(step) })
}
