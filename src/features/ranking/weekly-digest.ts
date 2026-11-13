import { query as databaseQuery } from '@/lib/db/client'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { jobsRepository } from '@/features/jobs/repository'
import { jobMatchDisplay } from '@/features/jobs/match-display'
import { marketplaceRepository } from '@/features/learning/marketplace-repository'
import { parseJobSearchParams } from '@/features/jobs/search'
import { rankDepartmentGroup } from '@/features/taxonomy/maritime-taxonomy'
import { scoreCourses } from './course-suggestions'
import { feedCandidateRepository } from './feed-candidates'
import { scoreFeedCandidate } from './feed-scorer'
import { jobPoolOptions } from './job-pool'
import { scoreJobForMember } from './job-match'
import { compareRankedJobs } from './job-scorer'
import { peopleSuggestions } from './people-suggestions'
import { EVENT_CATEGORY_DEPARTMENTS, SUGGESTION_WEIGHTS } from './suggestion-weights'
import { rankingSwitches } from './switches'

/**
 * Round G (G6): the weekly digest email. Monday from 08:00 in the member's time zone (IST when we
 * do not know it), spread over the hour by a fixed per-member offset, from the outbox worker.
 * Contents, each section skipped when empty and the whole email skipped below 3 items:
 * - up to 5 posts the member has not seen, ranked by the G1 scorer, PUBLIC posts only (audience
 *   "anyone", not in a community), the first line and a link, no images;
 * - up to 5 eligible job matches (G3), 3 people you may know (G2), 2 events and 1 course (G5).
 * Links carry ?src=digest. No tracking pixel. One per member per week: the queue's dedupe key is
 * the member and the week, and a skipped week is recorded too, so a re-run never sends twice.
 * Members who turned the digest off, or whose address is suppressed, are skipped.
 */
type Row = Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

export const DIGEST_MIN_ITEMS = 3
const DEFAULT_TIME_ZONE = 'Asia/Kolkata'
const SEND_HOUR = 8

export type DigestPayload = {
  weekKey: string
  posts: Array<{ id: string; authorName: string; firstLine: string }>
  jobs: Array<{ id: string; title: string; companyName: string; label: string }>
  people: Array<{ slug: string; name: string; headline: string | null; reason: string | null }>
  events: Array<{ id: string; title: string; when: string }>
  courses: Array<{ slug: string; title: string; reason: string | null }>
  test?: boolean
}

export function digestItemCount(payload: Omit<DigestPayload, 'weekKey'>) {
  return payload.posts.length + payload.jobs.length + payload.people.length + payload.events.length + payload.courses.length
}

/** Local weekday, hour and minute, and the ISO week key (YYYY-Www) in a time zone. */
export function localWeekTime(at: Date, timeZone: string) {
  let zone = timeZone
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
  } catch {
    zone = DEFAULT_TIME_ZONE
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((part) => [part.type, part.value]))
  const local = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
  const dayNumber = (local.getUTCDay() + 6) % 7
  local.setUTCDate(local.getUTCDate() - dayNumber + 3)
  const firstThursday = new Date(Date.UTC(local.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((local.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return {
    weekday: String(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekKey: `${local.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
  }
}


/** How long the list of valid time-zone names is reused before it is read again. */
export const ZONE_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function createWeeklyDigest(input: {
  query?: Query
  modeFor?: () => Promise<'off' | 'admins' | 'everyone'>
  build?: (memberId: string, weekKey: string) => Promise<DigestPayload>
  now?: () => Date
  batchSize?: number
} = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values) as Promise<Row[]>)
  const modeFor = input.modeFor ?? (async () => (await rankingSwitches.listModes()).weekly_digest)
  const now = input.now ?? (() => new Date())
  const batchSize = input.batchSize ?? 100
  // Round CAP (finding 6): pg_timezone_names reads every zone file (about 0.4 s a call), so the list of valid zone
  // names is read once a day per process and passed in, instead of on every pass. Same zones, same answers.
  let zoneCache: { names: string[]; readAt: number } | null = null
  async function validZones(at: Date) {
    if (!zoneCache || at.getTime() - zoneCache.readAt >= ZONE_LIST_MAX_AGE_MS || at.getTime() < zoneCache.readAt) {
      const rows = await queryRows(`select name from pg_catalog.pg_timezone_names`)
      zoneCache = { names: rows.map((row) => String(row.name)), readAt: at.getTime() }
    }
    return zoneCache.names
  }

  /**
   * Members due now: Monday in their time zone (IST when unknown or invalid), at or after 08:00
   * plus their fixed 0–59 minute offset; with a verified email; digest not turned off; and no
   * digest (sent or skipped) in the last 6 days.
   */
  async function candidates(mode: 'admins' | 'everyone', at: Date) {
    return queryRows(
      `with members as (
         select p.id, coalesce(case when p.time_zone = any($4::text[]) then p.time_zone end, 'Asia/Kolkata') as zone
         from public.profiles p
         where p.account_status = 'active' and p.onboarding_completed_at is not null
       )
       select m.id, m.zone as time_zone
       from members m
       join public.profiles p on p.id = m.id
       where extract(isodow from $3::timestamptz at time zone m.zone) = 1
         and extract(hour from $3::timestamptz at time zone m.zone) * 60 + extract(minute from $3::timestamptz at time zone m.zone)
             >= ${SEND_HOUR * 60} + (abs(hashtext(p.id::text)) % 60)
         and exists (select 1 from public.identity_accounts a where a.profile_id = p.id and a.email_verified = true and a.email is not null)
         and not exists (select 1 from public.member_email_topics t where t.profile_id = p.id and t.topic = 'weekly_digest' and t.email_enabled = false)
         and not exists (
           select 1 from public.ranking_emails e
           where e.recipient_id = p.id and e.topic = 'weekly_digest' and e.created_at > now() - interval '6 days'
             and e.dedupe_key not like 'test/%'
         )
         and ($1::text = 'everyone' or exists (select 1 from public.user_roles r where r.user_id = p.id and r.role::text = 'administrator'))
       order by p.id
       limit $2`,
      [mode, batchSize, at.toISOString(), await validZones(at)],
    )
  }

  async function enqueue(memberId: string, payload: DigestPayload, dedupeKey: string) {
    const enough = digestItemCount(payload) >= DIGEST_MIN_ITEMS
    const rows = await queryRows(
      `insert into public.ranking_emails (dedupe_key, recipient_id, topic, payload, status, last_error)
       values ($1, $2, 'weekly_digest', $3::jsonb, $4, $5)
       on conflict (dedupe_key) do nothing
       returning id`,
      [dedupeKey, memberId, JSON.stringify(enough ? payload : { weekKey: payload.weekKey }), enough ? 'pending' : 'skipped', enough ? null : 'fewer_than_3_items'],
    )
    return rows.length ? (enough ? 'queued' as const : 'empty' as const) : 'duplicate' as const
  }

  async function run() {
    const mode = await modeFor()
    if (mode === 'off') return { off: true }
    const at = now()
    const due = await candidates(mode, at)
    const counts = { due: due.length, queued: 0, empty: 0, duplicate: 0, failed: 0 }
    for (const row of due) {
      const memberId = String(row.id)
      try {
        const weekKey = localWeekTime(at, (row.time_zone as string | null) ?? DEFAULT_TIME_ZONE).weekKey
        const payload = await (input.build ?? buildDigest)(memberId, weekKey)
        counts[await enqueue(memberId, payload, `weekly_digest/${memberId}/${weekKey}`)] += 1
      } catch (error) {
        counts.failed += 1
        console.warn('[weekly_digest_failed]', { code: (error as { code?: string })?.code ?? null })
      }
    }
    return counts.due ? counts : undefined
  }

  /** Admin › Ranking: a test digest to the signed-in administrator now, marked [Test], sent even below 3 items. */
  async function queueTest(adminId: string) {
    const at = now()
    const payload = { ...await (input.build ?? buildDigest)(adminId, localWeekTime(at, DEFAULT_TIME_ZONE).weekKey), test: true }
    await queryRows(
      `insert into public.ranking_emails (dedupe_key, recipient_id, topic, payload) values ($1, $2, 'weekly_digest', $3::jsonb)`,
      [`test/weekly_digest/${adminId}/${at.getTime()}`, adminId, JSON.stringify(payload)],
    )
    return { items: digestItemCount(payload) }
  }

  return { run, queueTest, enqueue, candidates }
}

/** Public posts only: audience "anyone", not in a community, an original (not a repost), not deleted. */
async function publicFirstLines(postIds: readonly string[]) {
  if (!postIds.length) return []
  const rows = await databaseQuery(
    `select p.id, coalesce(c.name, author.full_name) as author_name, p.body
     from public.posts p
     join public.profiles author on author.id = p.author_id and author.account_status = 'active'
     left join public.companies c on c.id = p.company_id
     where p.id = any($1::uuid[]) and p.deleted_at is null and p.audience = 'anyone' and p.group_id is null and p.post_type <> 'repost'`,
    [[...postIds]],
  )
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  return postIds.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    const firstLine = String(row.body ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 160) ?? ''
    return firstLine ? [{ id, authorName: String(row.author_name ?? ''), firstLine }] : []
  })
}

/** Builds one member's digest from the G1, G2, G3 and G5 rankers. */
export async function buildDigest(memberId: string, weekKey: string): Promise<DigestPayload> {
  const [viewer, profile] = await Promise.all([
    feedCandidateRepository.getViewerProfile(memberId).catch(() => null),
    jobsRepository.getCandidateProfile(memberId).catch(() => null),
  ])
  const at = new Date()

  const posts = await (async () => {
    if (!viewer) return []
    const list = await feedCandidateRepository.listCandidates({ viewerId: memberId, windowDays: 14, limit: 200 })
    const ranked = list
      .filter((candidate) => !candidate.groupId && candidate.postType !== 'repost' && !candidate.isSelf)
      .map((candidate) => scoreFeedCandidate(candidate, { viewer, now: at }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 15)
    return (await publicFirstLines(ranked.map((entry) => entry.item.id))).slice(0, 5)
  })().catch(() => [])

  const jobs = await (async () => {
    if (!profile) return []
    const found = await jobsRepository.searchJobs(parseJobSearchParams({ mode: 'for-you' }), 300, 0, jobPoolOptions(memberId, profile))
    const applied = new Set(await jobsRepository.getAppliedJobIds(memberId, found.map((job) => job.id)))
    return found
      .filter((job) => !applied.has(job.id))
      .map((job) => ({ job, match: scoreJobForMember(job, profile, at).match }))
      .filter(({ match }) => match.eligible && match.score !== null && (match.band === 'strong' || match.band === 'good'))
      .sort((left, right) => compareRankedJobs(left, right, at))
      .slice(0, 5)
      .map(({ job, match }) => ({ id: job.id, title: job.title, companyName: job.companyName, label: jobMatchDisplay(match)?.label ?? 'Match' }))
  })().catch(() => [])

  const people = await (async () => {
    const picked = await peopleSuggestions.list(memberId, { limit: 3 })
    if (!picked.length) return []
    const rows = await databaseQuery(
      `select id, slug, full_name, headline from public.profiles where id = any($1::uuid[]) and account_status = 'active'`,
      [picked.map((item) => item.candidateId)],
    )
    const byId = new Map(rows.map((row) => [String(row.id), row]))
    return picked.flatMap((item) => {
      const row = byId.get(item.candidateId)
      return row?.slug ? [{ slug: String(row.slug), name: String(row.full_name), headline: (row.headline as string | null) ?? null, reason: item.reason }] : []
    })
  })().catch(() => [])

  const events = await (async () => {
    const department = rankDepartmentGroup(profile?.roleKey ?? null)
    const parts = (profile?.location ?? '').split(',').map((part) => part.trim()).filter(Boolean)
    const list = await calendarEventRepository.listEventsForYou(memberId, {
      categories: Object.entries(EVENT_CATEGORY_DEPARTMENTS).filter(([, departments]) => department && departments.includes(department)).map(([category]) => category),
      city: parts[0] ?? null,
      country: parts.length > 1 ? parts[parts.length - 1]! : null,
      limit: 2,
      weights: SUGGESTION_WEIGHTS.events,
    })
    return list.map((event) => ({
      id: event.id,
      title: event.title,
      when: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: event.timezone || DEFAULT_TIME_ZONE }).format(new Date(event.startAt)),
    }))
  })().catch(() => [])

  const courses = await (async () => {
    const candidates = await marketplaceRepository.listCourseCandidates(memberId, { rankBandKeys: jobPoolOptions(memberId, profile).rankBandKeys, popularityDays: SUGGESTION_WEIGHTS.courses.popularityDays })
    return scoreCourses(candidates, profile, at).slice(0, 1).map(({ course, reason }) => ({ slug: course.slug, title: course.title, reason }))
  })().catch(() => [])

  return { weekKey, posts, jobs, people, events, courses }
}

/** The outbox worker's sweep: every 15 minutes, one batch of due members. */
export function createWeeklyDigestSweep(digest = createWeeklyDigest()) {
  return { name: 'weekly_digest', everyMs: 15 * 60_000, requiresTable: 'ranking_emails', run: () => digest.run() }
}
