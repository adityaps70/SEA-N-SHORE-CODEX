// Sea N Shore load test (k6), one shard of the run; the workflow starts LOAD_TEST_SHARDS of them on separate runners so
// each stays under the WAF's per-IP limit (2,000 requests per 5 minutes).
//
// LOAD_TEST_MIX=signed-out (Round P3): read-only page fetches, no sign-in, forms, posts, messages, payments or emails.
// LOAD_TEST_MIX=signed-in (Round ARCH, Phase 1): the hidden load-test accounts (1,000 since 18 Nov, one per simulated
// member; each shard has its own share and spreads its requests evenly over them, so every session stays far under
// the WAF's 1,000 requests per 5 minutes), weighted by P3's real traffic: home
// and 3 feed pages, notifications, messages (opened, nothing sent), jobs list and a job page, a test profile, PYMK and
// the realtime ticket. Reads only, except the feed's own per-visit bookkeeping. No like or unlike until the realtime
// broadcast fix is live.
//
// Each step of the ramp lasts STEP_SECONDS at a fixed total rate (LOAD_TEST_TOTAL_RPM, requests per minute across
// all shards); this shard sends its share. Every request is tagged with its step and an outcome class, and
// recorded in the lt_req trend (and lt_hit for the CloudFront cache), which scripts/load-test/stop-watch.mjs reads
// from the CSV output to apply the stop rules and build the report.
import http from 'k6/http'
import exec from 'k6/execution'
import { Rate, Trend } from 'k6/metrics'

const BASE_URL = __ENV.LOAD_TEST_BASE_URL || ''
const SHARD = Number(__ENV.LOAD_TEST_SHARD || '0')
const SHARDS = Number(__ENV.LOAD_TEST_SHARDS || '16')
const STEP_SECONDS = Number(__ENV.LOAD_TEST_STEP_SECONDS || '300')
const TOTAL_RPM = (__ENV.LOAD_TEST_TOTAL_RPM || '100,300,600,1000,2000,3000').split(',').map(Number)
const JOB_PATH = __ENV.LOAD_TEST_JOB_PATH || ''
const COURSE_PATH = __ENV.LOAD_TEST_COURSE_PATH || ''

if (!/^https?:\/\/[a-z0-9.-]+(:[0-9]+)?$/.test(BASE_URL)) throw new Error('LOAD_TEST_BASE_URL must be an origin')
if (!/^\/jobs\/[0-9a-f-]{36}$/.test(JOB_PATH)) throw new Error('LOAD_TEST_JOB_PATH must be /jobs/<id>')
if (!/^\/learn\/courses\/[a-z0-9-]+$/.test(COURSE_PATH)) throw new Error('LOAD_TEST_COURSE_PATH must be /learn/courses/<slug>')
if (!(SHARDS >= 1 && SHARD >= 0 && SHARD < SHARDS)) throw new Error('bad shard')
if (!TOTAL_RPM.every((rpm) => Number.isInteger(rpm) && rpm > 0)) throw new Error('bad LOAD_TEST_TOTAL_RPM')

const MIX = __ENV.LOAD_TEST_MIX || 'signed-out'
if (MIX !== 'signed-out' && MIX !== 'signed-in') throw new Error('LOAD_TEST_MIX must be signed-out or signed-in')
const PATHS = ['/', '/jobs', JOB_PATH, COURSE_PATH, '/privacy']

// Signed-in: this shard's sessions (from the sessions job) and the build's ids for the two read-only actions.
const SESSIONS = MIX === 'signed-in' ? JSON.parse(open(__ENV.LOAD_TEST_SESSIONS_FILE)) : []
const ACTIONS = MIX === 'signed-in' ? JSON.parse(__ENV.LOAD_TEST_ACTIONS || '{}') : {}
if (MIX === 'signed-in') {
  if (!SESSIONS.length || !SESSIONS.every((s) => Number.isInteger(s.index) && typeof s.accessToken === 'string')) throw new Error('no sessions')
  if (!/^[0-9a-f]{40,44}$/.test(ACTIONS.loadTopFeedPage || '') || !/^[0-9a-f]{40,44}$/.test(ACTIONS.loadUnreadNotificationCount || '')) throw new Error('no action ids')
}

/** P3's real signed-in traffic shares (ALB routes over 14 days), as weights per request. */
export const SIGNED_IN_WEIGHTS = [
  ['feed-page', 28], ['profile', 14], ['home', 10], ['network', 10], ['jobs', 9], ['messages', 7],
  ['messaging-state', 5], ['job', 5], ['notifications', 4], ['notification-count', 4], ['realtime-ticket', 4],
]
const WEIGHT_TOTAL = SIGNED_IN_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0)

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
      // Enough VUs for a 2 s p95 at the top step, with headroom; never more than 150 per shard.
      preAllocatedVUs: Math.min(150, Math.ceil(peak / 20) + 5),
      maxVUs: 150,
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

function classify(res) {
  const status = res.status
  const location = String((res.headers && (res.headers.Location || res.headers.location)) || '')
  if (MIX === 'signed-in' && status >= 300 && status < 400 && location.includes('/auth/sign-in')) return 'auth'
  return status === 0 ? 'neterr' : status >= 500 ? '5xx' : status === 403 || status === 429 ? 'blocked' : status >= 400 ? 'other' : 'ok'
}

function record(res, step) {
  reqTrend.add(res.timings.duration, { step: String(step), cls: classify(res) })
  const cache = String((res.headers && (res.headers['X-Cache'] || res.headers['x-cache'])) || '')
  hitRate.add(/^(Hit|RefreshHit)/i.test(cache), { step: String(step) })
}

// A browser's page load: without these the site treats the fetch as a non-page request, so it is never
// cacheable and the run measures only the uncached path (the 7 Nov morning run did exactly that).
const BROWSER_PAGE_LOAD = { Accept: 'text/html,application/xhtml+xml', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' }

// Signed-in mix: each iteration takes this shard's next account in turn (not one fixed account per VU, which would
// pile a quiet step's requests onto a few sessions). A Top-for-you "visit" stays on one VU and its account: its next
// pages go out with the same account and the visit's session, as a member scrolling home does. Owner (18 Nov): the
// visit used to live in a per-VU map keyed by the round-robin account, and response bodies were thrown away, so a
// visit almost never continued and every feed page built a fresh snapshot (about 3x a member's feed cost).
let visit = null
// Round DB: each request names its ramp step in the User-Agent, so the report can cut the ALB's server-side times
// per step exactly (the shards start a few seconds apart). Set per iteration.
let stepAgent = 'SeaNShore-LoadTest/1'

/** The shard's account for this iteration: round robin over the shard's iterations, the same for every VU count. */
export function sessionSlot(iteration, sessions) {
  return iteration % sessions
}

function signedInRequest(name) {
  const slot = sessionSlot(exec.scenario.iterationInInstance, SESSIONS.length)
  // Three pages per visit, then a new visit starts (a new snapshot) on this iteration's account.
  const continuing = name === 'feed-page' && visit !== null && visit.sessionId !== null && visit.pages < 3
  const session = SESSIONS[continuing ? visit.slot : slot]
  const cookie = `sns_cognito_access=${session.accessToken}${session.refreshToken ? `; sns_cognito_refresh=${session.refreshToken}` : ''}`
  const base = { 'X-SNS-Load-Test': 'P3', 'User-Agent': stepAgent, Cookie: cookie }
  // Page loads look like a browser's (as in the signed-out mix); the realtime state is a fetch, not a page.
  const page = (path, tag) => http.get(BASE_URL + path, {
    headers: path.startsWith('/api/') ? base : { ...base, ...BROWSER_PAGE_LOAD }, redirects: 0, timeout: '20s', tags: { name: tag || path },
  })
  const action = (id, args, tag, keepBody = false) => http.post(`${BASE_URL}/home`, JSON.stringify(args), {
    headers: { ...base, 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component', Origin: BASE_URL },
    redirects: 0, timeout: '20s', tags: { name: tag },
    // Only the feed page's body is read (for its session and next position); every other body is discarded.
    ...(keepBody ? { responseType: 'text' } : {}),
  })
  switch (name) {
    case 'home':
      // A home load starts that account's next visit afresh.
      if (visit !== null && visit.slot === slot) visit = null
      return page('/home')
    case 'feed-page': {
      const current = continuing ? visit : { slot, sessionId: null, position: null, pages: 0 }
      const args = current.sessionId ? [{ sessionId: current.sessionId, ...(current.position !== null ? { position: current.position } : {}) }] : [{}]
      const res = action(ACTIONS.loadTopFeedPage, args, 'action:loadTopFeedPage', true)
      const body = String(res.body || '')
      const sessionId = /"sessionId":"([0-9a-f-]{36})"/.exec(body)
      const position = /"nextPosition":(\d+|null)/.exec(body)
      visit = {
        slot: current.slot,
        sessionId: sessionId ? sessionId[1] : null,
        position: position && position[1] !== 'null' ? Number(position[1]) : null,
        pages: current.pages + 1,
      }
      return res
    }
    case 'profile':
      return page(`/people/sns-load-test-${String(1 + Math.floor(Math.random() * 1000)).padStart(4, '0')}`, '/people/:slug')
    case 'network': return page('/network')
    case 'jobs': return page('/jobs')
    case 'job': return page(JOB_PATH, '/jobs/:id')
    case 'messages': return page('/messages')
    case 'messaging-state': return page('/api/realtime/messaging-state')
    case 'notifications': return page('/notifications')
    case 'notification-count': return action(ACTIONS.loadUnreadNotificationCount, [], 'action:loadUnreadNotificationCount')
    case 'realtime-ticket':
      return http.post(`${BASE_URL}/api/realtime/ticket`, null, { headers: { ...base, Origin: BASE_URL }, redirects: 0, timeout: '20s', tags: { name: '/api/realtime/ticket' } })
    default: throw new Error(`unknown request ${name}`)
  }
}

function pickSignedIn() {
  let roll = Math.random() * WEIGHT_TOTAL
  for (const [name, weight] of SIGNED_IN_WEIGHTS) {
    roll -= weight
    if (roll < 0) return name
  }
  return SIGNED_IN_WEIGHTS[0][0]
}

export default function loadTestIteration(data) {
  const step = Math.min(TOTAL_RPM.length, Math.floor((Date.now() - data.startedAt) / 1000 / STEP_SECONDS) + 1)
  stepAgent = `SeaNShore-LoadTest/1 step/${step}`
  if (MIX === 'signed-in') {
    record(signedInRequest(pickSignedIn()), step)
    return
  }
  const path = PATHS[Math.floor(Math.random() * PATHS.length)]
  const res = http.get(BASE_URL + path, {
    headers: { 'X-SNS-Load-Test': 'P3', 'User-Agent': stepAgent, ...BROWSER_PAGE_LOAD },
    redirects: 0,
    timeout: '20s',
    tags: { name: path === JOB_PATH ? '/jobs/:id' : path === COURSE_PATH ? '/learn/courses/:slug' : path },
  })
  record(res, step)
}
