import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

let db: TestDatabase
vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { buildDigest, createWeeklyDigest, digestItemCount } = await import('./weekly-digest')
const { createRankingEmailRepository, createRankingEmailWorker } = await import('./ranking-email-sending')

/**
 * Round G (G6) against the real schema (PGlite, every migration): the weekly digest holds public
 * posts only, never a blocked member, is never sent to someone who turned it off, is skipped when
 * there are fewer than 3 items, and a re-run never queues a second one. Placeholder data only.
 */
const monday = new Date('2026-10-19T05:00:00.000Z') // 10:30 IST, after everyone's 08:00–08:59 slot
let sequence = 0
const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function member(input: { email?: boolean; admin?: boolean } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, profile_type, time_zone)
     values (gen_random_uuid(), $1, $2, now(), 'second_officer', 'seafarer', 'Asia/Kolkata') returning id`,
    [`Placeholder Sailor ${sequence}`, `placeholder-sailor-${sequence}`],
  )
  const id = rows[0]!.id as string
  if (input.email !== false) {
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
      [id, `digest-sub-${sequence}`, `digest-${sequence}@example.invalid`],
    )
  }
  return id
}

async function connect(a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $1, 'accepted')`, [low, high])
}

async function post(authorId: string, body: string, input: { audience?: string; groupId?: string | null } = {}) {
  const rows = await db.query(
    `insert into public.posts (author_id, body, category, audience, group_id) values ($1, $2, 'maritime_news', $3, $4) returning id`,
    [authorId, body, input.audience ?? 'anyone', input.groupId ?? null],
  )
  return rows[0]!.id as string
}

const digest = (mode: 'admins' | 'everyone' = 'everyone', build?: NonNullable<Parameters<typeof createWeeklyDigest>[0]>['build']) =>
  createWeeklyDigest({ query, modeFor: async () => mode, now: () => monday, ...(build ? { build } : {}) })

beforeEach(async () => {
  for (const table of ['ranking_emails', 'member_email_topics', 'post_impressions', 'posts', 'community_group_memberships', 'community_groups', 'user_blocks', 'connections', 'people_suggestions', 'identity_accounts', 'profiles']) {
    await db.query(`delete from public.${table}`)
  }
})

describe('weekly digest (round G)', () => {
  it('holds public posts only and never a blocked member', async () => {
    const viewer = await member()
    const friend = await member()
    const blocked = await member()
    await connect(viewer, friend)
    await connect(viewer, blocked)
    const [group] = await db.query(`insert into public.community_groups (name, slug, visibility, created_by) values ('Placeholder Group', 'placeholder-group', 'public', $1) returning id`, [friend])
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'member', 'active')`, [group!.id, friend, viewer])
    const publicPost = await post(friend, 'Placeholder public post\nSecond line')
    await post(friend, 'Placeholder members-only post', { audience: 'members' })
    await post(friend, 'Placeholder community post', { groupId: group!.id as string, audience: 'members' })
    await post(blocked, 'Placeholder post by a blocked member')
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [viewer, blocked])

    const payload = await buildDigest(viewer, '2026-W43')
    expect(payload.posts).toEqual([{ id: publicPost, authorName: expect.any(String), firstLine: 'Placeholder public post' }])
    expect(JSON.stringify(payload)).not.toContain('Placeholder Sailor 3')
    expect(payload.people.map((person) => person.name)).not.toContain('Placeholder Sailor 3')
  })

  it('queues once per member per week: a re-run never sends twice', async () => {
    const viewer = await member()
    const full = async () => ({ weekKey: '2026-W43', posts: [{ id: 'p', authorName: 'A', firstLine: 'x' }], jobs: [{ id: 'j', title: 'T', companyName: 'C', label: 'Good match' }], people: [{ slug: 's', name: 'N', headline: null, reason: null }], events: [], courses: [] })
    expect(await digest('everyone', full).run()).toMatchObject({ due: 1, queued: 1 })
    expect(await digest('everyone', full).run()).toBeUndefined()
    const rows = await db.query(`select status from public.ranking_emails where recipient_id = $1`, [viewer])
    expect(rows).toEqual([{ status: 'pending' }])
  })

  it('skips the empty digest (fewer than 3 items) and records the skip so it is not rebuilt', async () => {
    const viewer = await member()
    const thin = async () => ({ weekKey: '2026-W43', posts: [{ id: 'p', authorName: 'A', firstLine: 'x' }], jobs: [], people: [], events: [], courses: [] })
    expect(digestItemCount(await thin())).toBe(1)
    expect(await digest('everyone', thin).run()).toMatchObject({ due: 1, empty: 1, queued: 0 })
    expect(await db.query(`select status from public.ranking_emails where recipient_id = $1`, [viewer])).toEqual([{ status: 'skipped' }])
    const sent: string[] = []
    const worker = createRankingEmailWorker({
      repository: createRankingEmailRepository({ query: query as never, transaction: ((work: (run: typeof query) => Promise<unknown>) => work(query)) as never }),
      resend: { sendEmail: async (input) => { sent.push(input.subject); return { messageId: 'placeholder' } } },
    })
    await worker.runSweep()
    expect(sent).toEqual([])
  })

  it('never goes to members who turned it off, have no verified email, or outside Monday morning', async () => {
    const off = await member()
    await member({ email: false })
    await db.query(`insert into public.member_email_topics (profile_id, topic, email_enabled) values ($1, 'weekly_digest', false)`, [off])
    const build = async () => ({ weekKey: '2026-W43', posts: [], jobs: [], people: [], events: [], courses: [] })
    expect(await digest('everyone', build).run()).toBeUndefined()
    const on = await member()
    const sunday = createWeeklyDigest({ query, modeFor: async () => 'everyone', now: () => new Date('2026-10-18T05:00:00.000Z'), build })
    expect(await sunday.run()).toBeUndefined()
    expect(await digest('everyone', build).run()).toMatchObject({ due: 1 })
    expect((await db.query(`select recipient_id from public.ranking_emails`)).map((row) => row.recipient_id)).toEqual([on])
  })
})
