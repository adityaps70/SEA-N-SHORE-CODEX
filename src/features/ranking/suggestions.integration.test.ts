import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

let db: TestDatabase
vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createOrganizationWorkspaceRepository } = await import('@/features/organizations/workspace-repository')
const { createCommunityRepository } = await import('@/features/community/repository')
const { createMarketplaceRepository } = await import('@/features/learning/marketplace-repository')
const { calendarEventRepository } = await import('@/features/events/calendar-repository')
const { createActiveMentor, createPublishedCourse } = await import('@/features/learning/learning-test-fixtures')
const { scoreCourses } = await import('./course-suggestions')
const { SUGGESTION_WEIGHTS } = await import('./suggestion-weights')

/**
 * Round G (G5) against the real schema (PGlite, every migration): every suggestion list leaves out
 * what the member already follows, joined, registered for, enrolled in or dismissed; a private
 * community is suggested by name and size only; co-follows need 3 shared followers; and the
 * certificate-expiry reason comes only from the viewer's own credentials. Placeholder data only.
 */
let sequence = 0
const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function member(roleKey: string | null = 'second_officer') {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, profile_type)
     values (gen_random_uuid(), $1, $2, now(), $3, 'seafarer') returning id`,
    [`Placeholder Person ${sequence}`, `placeholder-person-${sequence}`, roleKey],
  )
  return rows[0]!.id as string
}

let creator = ''
async function organization(name: string, input: { verified?: boolean; type?: string } = {}) {
  sequence += 1
  creator ||= await member(null)
  const rows = await db.query(
    `insert into public.companies (name, slug, is_verified, organization_type, created_by) values ($1, $2, $3, $4, $5) returning id`,
    [name, `placeholder-org-${sequence}`, input.verified ?? true, input.type ?? 'shipowner', creator],
  )
  return rows[0]!.id as string
}

async function connect(a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $1, 'accepted')`, [low, high])
}

const orgs = () => createOrganizationWorkspaceRepository({ query: query as never })
const forYouOrgs = (viewer: string) => orgs().listDiscoverOrganizationsForYou(viewer, { limit: 20, departmentKeys: [], rankBandKeys: [], cadet: false, weights: SUGGESTION_WEIGHTS.orgs })

beforeEach(async () => {
  creator = ''
  for (const table of ['suggestion_dismissals', 'event_attendees', 'events', 'learning_enrollments', 'community_group_memberships', 'community_groups', 'organization_follows', 'company_members', 'connections', 'profile_credentials', 'maritime_profiles', 'companies']) {
    await db.query(`delete from public.${table}`)
  }
})

describe('Discover organizations (round G)', () => {
  it('puts where connections work first and never lists followed, member or dismissed organizations', async () => {
    const viewer = await member()
    const friend = await member()
    await connect(viewer, friend)
    const friendsCompany = await organization('Placeholder Friends Lines')
    const followed = await organization('Placeholder Followed Lines')
    const own = await organization('Placeholder Own Lines')
    const dismissed = await organization('Placeholder Dismissed Lines')
    const verified = await organization('Placeholder Verified Lines')
    await db.query(`insert into public.maritime_profiles (user_id, current_company_id) values ($1, $2)`, [friend, friendsCompany])
    await db.query(`insert into public.organization_follows (company_id, follower_id) values ($1, $2)`, [followed, viewer])
    await db.query(`insert into public.company_members (company_id, user_id, approved_at) values ($1, $2, now())`, [own, viewer])
    await db.query(`insert into public.suggestion_dismissals (viewer_id, kind, target_id) values ($1, 'org', $2)`, [viewer, dismissed])

    const list = await forYouOrgs(viewer)
    expect(list[0]).toMatchObject({ id: friendsCompany, reason: '1 connection works here' })
    const ids = list.map((item) => item.id)
    expect(ids).toContain(verified)
    for (const excluded of [followed, own, dismissed]) expect(ids).not.toContain(excluded)
  })

  it('differs between two members (personalised)', async () => {
    const alice = await member()
    const bob = await member()
    const friend = await member()
    await connect(alice, friend)
    const friendsCompany = await organization('Placeholder Crew Lines', { verified: false })
    await db.query(`insert into public.maritime_profiles (user_id, current_company_id) values ($1, $2)`, [friend, friendsCompany])
    expect((await forYouOrgs(alice)).map((item) => item.id)).toContain(friendsCompany)
    expect((await forYouOrgs(bob)).map((item) => item.id)).not.toContain(friendsCompany)
  })

  it('"People who follow this page also follow" needs at least 3 shared followers', async () => {
    const viewer = await member()
    const page = await organization('Placeholder Page')
    const twoShared = await organization('Placeholder Two Shared')
    const threeShared = await organization('Placeholder Three Shared')
    const followers = [await member(), await member(), await member()]
    for (const follower of followers) {
      await db.query(`insert into public.organization_follows (company_id, follower_id) values ($1, $2), ($3, $2)`, [page, follower, threeShared])
    }
    for (const follower of followers.slice(0, 2)) {
      await db.query(`insert into public.organization_follows (company_id, follower_id) values ($1, $2)`, [twoShared, follower])
    }
    const ids = (await orgs().listCoFollowedOrganizations(page, viewer, { limit: 5, minShared: SUGGESTION_WEIGHTS.orgs.coFollowMinShared })).map((item) => item.id)
    expect(ids).toEqual([threeShared])
  })
})

describe('Suggested communities (round G)', () => {
  it('leaves out joined, requested and dismissed communities, and shows a private one by name and size only', async () => {
    const viewer = await member()
    const owner = await member()
    const group = async (name: string, visibility = 'public') => (await db.query(
      `insert into public.community_groups (name, slug, visibility, description, created_by) values ($1, $2, $3, 'Placeholder description', $4) returning id`,
      [name, name.toLowerCase().replace(/\s+/g, '-'), visibility, owner],
    ))[0]!.id as string
    const joined = await group('Placeholder Joined')
    const requested = await group('Placeholder Requested', 'private')
    const dismissed = await group('Placeholder Dismissed')
    const privateGroup = await group('Placeholder Private', 'private')
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status) values ($1, $2, 'member', 'active'), ($3, $2, 'member', 'pending')`, [joined, viewer, requested])
    await db.query(`insert into public.suggestion_dismissals (viewer_id, kind, target_id) values ($1, 'community', $2)`, [viewer, dismissed])
    const author = await member()
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status) values ($1, $2, 'member', 'active')`, [privateGroup, author])
    await db.query(`insert into public.posts (author_id, body, category, group_id) values ($1, 'Private placeholder post text', 'maritime_news', $2)`, [author, privateGroup])

    const list = await createCommunityRepository({ query: query as never }).listSuggestedGroups(viewer, { profileSlugs: [], limit: 20, weights: SUGGESTION_WEIGHTS.communities })
    const ids = list.map((item) => item.id)
    for (const excluded of [joined, requested, dismissed]) expect(ids).not.toContain(excluded)
    const suggestedPrivate = list.find((item) => item.id === privateGroup)!
    expect(suggestedPrivate).toMatchObject({ name: 'Placeholder Private', visibility: 'private', memberCount: 1 })
    expect(JSON.stringify(list)).not.toContain('Private placeholder post text')
  })
})

describe('Events for you (round G)', () => {
  it('leaves out registered, full, cancelled, dismissed and far-off events; connections attending is a count', async () => {
    const viewer = await member()
    const host = await member()
    const friend = await member()
    await connect(viewer, friend)
    const event = async (title: string, input: { days?: number; capacity?: number | null; status?: string } = {}) => (await db.query(
      `insert into public.events (host_user_id, title, summary, description, category, event_type, format, meeting_url, status, start_at, end_at, timezone, capacity)
       values ($1, $2, 'Placeholder summary', 'Placeholder description', 'safety', 'webinar', 'online', 'https://meet.example.invalid/placeholder', $3, now() + make_interval(days => $4::int), now() + make_interval(days => $4::int) + interval '1 hour', 'UTC', $5)
       returning id`,
      [host, title, input.status ?? 'published', input.days ?? 5, input.capacity ?? null],
    ))[0]!.id as string
    const withFriend = await event('Placeholder With Friend')
    const registered = await event('Placeholder Registered')
    const full = await event('Placeholder Full', { capacity: 1 })
    const cancelled = await event('Placeholder Cancelled', { status: 'cancelled' })
    const dismissed = await event('Placeholder Dismissed')
    const farOff = await event('Placeholder Far Off', { days: 90 })
    const plain = await event('Placeholder Plain', { days: 2 })
    await db.query(`insert into public.event_attendees (event_id, user_id) values ($1, $2), ($3, $4), ($5, $2)`, [registered, viewer, full, host, withFriend])
    await db.query(`insert into public.event_attendees (event_id, user_id) values ($1, $2)`, [withFriend, friend])
    await db.query(`delete from public.event_attendees where event_id = $1 and user_id = $2`, [withFriend, viewer])
    await db.query(`insert into public.suggestion_dismissals (viewer_id, kind, target_id) values ($1, 'event', $2)`, [viewer, dismissed])

    const list = await calendarEventRepository.listEventsForYou(viewer, { categories: [], city: null, country: null, limit: 20, weights: SUGGESTION_WEIGHTS.events })
    expect(list.map((item) => item.id)).toEqual([withFriend, plain])
    expect(list[0]!.reason).toBe('1 connection attending')
    for (const excluded of [registered, full, cancelled, dismissed, farOff]) expect(list.map((item) => item.id)).not.toContain(excluded)
  })
})

describe('Recommended courses (round G)', () => {
  it('leaves out enrolled and dismissed courses, and the expiry reason uses only the viewer’s own certificates', async () => {
    const viewer = await member()
    const other = await member()
    const mentor = await createActiveMentor(db.query.bind(db))
    const refresher = await createPublishedCourse(db.query.bind(db), mentor, { slug: 'placeholder-aff' })
    const enrolled = await createPublishedCourse(db.query.bind(db), mentor, { slug: 'placeholder-enrolled' })
    const dismissed = await createPublishedCourse(db.query.bind(db), mentor, { slug: 'placeholder-dismissed' })
    await db.query(`update public.learning_courses set title = 'Advanced Fire Fighting Refresher' where id = $1`, [refresher.courseId])
    // The fixture text carries the synthetic-data marker Learn hides; give these courses neutral text.
    await db.query(`update public.learning_courses set description = 'A placeholder course description for ranking tests.', is_discoverable = true where id = any($1::uuid[])`, [[refresher.courseId, enrolled.courseId, dismissed.courseId]])
    await db.query(`update public.learning_mentor_applications set applicant_name = 'Placeholder Trainer' where user_id = $1`, [mentor.userId])
    await db.query(`insert into public.learning_enrollments (course_id, learner_id, enrollment_source, status) values ($1, $2, 'free', 'completed')`, [enrolled.courseId, viewer])
    await db.query(`insert into public.suggestion_dismissals (viewer_id, kind, target_id) values ($1, 'course', $2)`, [viewer, dismissed.courseId])
    // Someone else's AFF expires; the viewer's does not exist.
    await db.query(`insert into public.profile_credentials (profile_id, name, issuer, expires_on) values ($1, 'Advanced Fire Fighting', 'Placeholder Institute', current_date + 30)`, [other])

    const candidates = await createMarketplaceRepository({ query: query as never }).listCourseCandidates(viewer, { rankBandKeys: [], popularityDays: 90 })
    const ids = candidates.map((entry) => entry.course.id)
    expect(ids).toContain(refresher.courseId)
    expect(ids).not.toContain(enrolled.courseId)
    expect(ids).not.toContain(dismissed.courseId)
    const noCertificates = { persona: 'seafarer' as const, roleKey: 'second_officer', rank: null, sailingExperienceYears: null, vesselTypes: [], tradingAreas: [], availability: null, certificates: [], visas: [], shoreCareerPreference: false, skills: [] }
    expect(String(scoreCourses(candidates, noCertificates).find((entry) => entry.course.id === refresher.courseId)?.reason ?? '')).not.toMatch(/expires/)
    const withOwn = { ...noCertificates, certificates: [{ name: 'Advanced Fire Fighting', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), verified: false }] }
    expect(scoreCourses(candidates, withOwn)[0]).toMatchObject({ course: { id: refresher.courseId }, reason: expect.stringMatching(/^Your Advanced Fire Fighting expires on /) })
  })
})
