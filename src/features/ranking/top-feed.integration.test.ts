import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Round G (G1) against the real schema (PGlite, every migration): "Top for you" respects every
 * visibility rule, collapses reposts, never repeats a seen or engaged post after a reload (on any
 * device: the check is server-side), falls back to wider windows, then posts from outside the
 * network, then "caught up", and pages through its snapshot without repeats or gaps.
 * Placeholder data only.
 */
let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createTopFeed } = await import('./top-feed')
const { createFeedCandidateRepository } = await import('./feed-candidates')
const { createFeedSessionRepository } = await import('./feed-sessions')
const { createFeedRepository } = await import('@/features/feed/repository')
const { createFeedQueries } = await import('@/features/feed/queries')
const { createFeedPreferences } = await import('@/features/feed/preferences')
const { createSignalsRepository } = await import('@/features/signals/repository')

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
let sequence = 0
let now = new Date()

async function member(extra: { roleKey?: string; createdDaysAgo?: number } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, created_at)
     values (gen_random_uuid(), $1, $2, now(), $3, now() - make_interval(days => $4)) returning id`,
    [`Placeholder Sailor ${sequence}`, `placeholder-sailor-${sequence}`, extra.roleKey ?? null, extra.createdDaysAgo ?? 365],
  )
  return rows[0]!.id as string
}

async function connect(a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $1, 'accepted')`, [low, high])
}

async function post(authorId: string, options: { hoursAgo?: number; groupId?: string; repostOf?: string; category?: string } = {}) {
  const rows = await db.query(
    `insert into public.posts (author_id, category, body, post_type, created_at, updated_at, group_id, repost_of_post_id)
     values ($1, $2::public.post_category, $3, $4::public.post_type, now() - make_interval(hours => $5), now() - make_interval(hours => $5), $6, $7)
     returning id`,
    [authorId, options.category ?? 'technical_discussion', options.repostOf ? '' : `Placeholder update ${sequence++}`, options.repostOf ? 'repost' : 'standard', options.hoursAgo ?? 1, options.groupId ?? null, options.repostOf ?? null],
  )
  return rows[0]!.id as string
}

function services() {
  const candidates = createFeedCandidateRepository({ query })
  const sessions = createFeedSessionRepository({ query })
  const top = createTopFeed({ candidates, sessions, now: () => now })
  const repository = createFeedRepository({ query: (text, values) => db.query(text, values) })
  return { top, sessions, repository }
}

/** Every post id a viewer is served in one visit, page by page, until the feed reports caught up. */
async function readWholeVisit(viewerId: string, maxPages = 40) {
  const { top } = services()
  const served: string[] = []
  const stages: string[] = []
  let page = await top.page({ viewerId })
  for (let index = 0; index < maxPages; index += 1) {
    served.push(...page.postIds)
    stages.push(page.session.stage)
    if (page.caughtUp || page.nextPosition === null) break
    page = await top.page({ viewerId, sessionId: page.session.id, position: page.nextPosition })
  }
  return { served, stages, last: page }
}

let viewer = ''
let friendA = ''
let friendB = ''
let followed = ''
let stranger = ''
let privateMember = ''
let blocked = ''
let mutedAuthor = ''
let groupId = ''

beforeEach(async () => {
  now = new Date()
  for (const table of ['feed_sessions', 'post_impressions', 'post_reactions', 'post_comments', 'post_hides', 'user_mutes', 'user_blocks', 'follows', 'connections', 'community_group_memberships', 'community_groups', 'posts', 'profiles']) {
    await db.query(`delete from public.${table}`)
  }
  viewer = await member({ roleKey: 'second_officer' })
  friendA = await member({ roleKey: 'chief_officer' })
  friendB = await member()
  followed = await member()
  stranger = await member({ roleKey: 'second_officer' })
  privateMember = await member()
  blocked = await member()
  mutedAuthor = await member()
  await connect(viewer, friendA)
  await connect(viewer, friendB)
  await connect(viewer, blocked)
  await connect(viewer, mutedAuthor)
  await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2)`, [viewer, followed])
  await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [blocked, viewer])
  await db.query(`insert into public.user_mutes (viewer_id, muted_profile_id) values ($1, $2)`, [viewer, mutedAuthor])
  const group = await db.query(`insert into public.community_groups (name, slug, visibility, created_by) values ('Placeholder Crew', 'placeholder-crew', 'private', $1) returning id`, [privateMember])
  groupId = group[0]!.id as string
  for (const memberId of [privateMember, friendA]) {
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at) values ($1, $2, 'member', 'active', now())`, [groupId, memberId])
  }
})

describe('Top for you (round G)', () => {
  it('shows the network and leaves out blocked, muted, hidden and private-community posts', async () => {
    const visible = [await post(friendA), await post(friendB), await post(followed)]
    const blockedPost = await post(blocked)
    const mutedPost = await post(mutedAuthor)
    const hiddenPost = await post(friendA, { hoursAgo: 2 })
    await db.query(`insert into public.post_hides (user_id, post_id) values ($1, $2)`, [viewer, hiddenPost])
    // A connection comments on a private-community post: the 2nd-degree source finds it, the visibility rule drops it.
    const privatePost = await post(privateMember, { groupId })
    await db.query(`insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'Placeholder reply')`, [privatePost, friendA])

    const { served } = await readWholeVisit(viewer)
    for (const id of visible) expect(served).toContain(id)
    for (const id of [blockedPost, mutedPost, hiddenPost, privatePost]) expect(served).not.toContain(id)
  })

  it('collapses an original and its reposts into one card', async () => {
    const original = await post(stranger, { hoursAgo: 5 })
    await post(friendA, { repostOf: original, hoursAgo: 3 })
    await post(friendB, { repostOf: original, hoursAgo: 2 })
    const { top } = services()
    const page = await top.page({ viewerId: viewer })
    const contents = await db.query(`select id, coalesce(repost_of_post_id, id) as content from public.posts where id = any($1::uuid[])`, [page.postIds])
    expect(contents.filter((row) => row.content === original)).toHaveLength(1)
    const entry = page.session.meta.entries[String(contents.find((row) => row.content === original)!.id)]
    expect(entry?.repostedBy).toMatchObject({ others: 1 })
  })

  it('never brings back a seen or engaged post after a reload, on this or another device', async () => {
    // Enough authors that the diversity rules (2 per author in any 10) still fill a page.
    const authors = [friendA, friendB]
    for (let index = 0; index < 6; index += 1) {
      const extra = await member()
      await connect(viewer, extra)
      authors.push(extra)
    }
    for (let index = 0; index < 32; index += 1) await post(authors[index % authors.length]!, { hoursAgo: index + 1 })
    const { top } = services()
    const signals = createSignalsRepository({ query })

    // Scroll: the first page is seen (impressions), one post is reacted to without being "seen".
    const first = await top.page({ viewerId: viewer })
    const seen = first.postIds.slice(0, 8)
    await signals.recordImpressions(viewer, seen)
    const reacted = first.postIds[10]!
    await db.query(`insert into public.post_reactions (post_id, user_id, reaction_type) values ($1, $2, 'like')`, [reacted, viewer])

    // Reload five times (each is a new visit, as on a new tab or device): none of them comes back.
    for (let reload = 0; reload < 5; reload += 1) {
      const { served } = await readWholeVisit(viewer)
      for (const id of [...seen, reacted]) expect(served).not.toContain(id)
      expect(new Set(served).size).toBe(served.length)
    }
  })

  it('counts the original as seen when a repost was seen, and the reverse', async () => {
    const original = await post(stranger, { hoursAgo: 4 })
    const repost = await post(friendA, { repostOf: original, hoursAgo: 2 })
    const other = await post(friendB, { hoursAgo: 1 })
    await createSignalsRepository({ query }).recordImpressions(viewer, [repost])
    const { served } = await readWholeVisit(viewer)
    expect(served).toContain(other)
    expect(served).not.toContain(repost)
    expect(served).not.toContain(original)
  })

  it('falls back from the network to older unseen posts, then posts from outside the network, then caught up', async () => {
    const recent = await post(friendA, { hoursAgo: 2 })
    const older = await post(friendB, { hoursAgo: 24 * 60 })
    const outside = await post(stranger, { hoursAgo: 24 * 100 })
    const signals = createSignalsRepository({ query })

    const visit1 = await readWholeVisit(viewer)
    expect(visit1.served[0]).toBe(recent)
    await signals.recordImpressions(viewer, [recent])

    const visit2 = await readWholeVisit(viewer)
    expect(visit2.served).toContain(older)
    expect(visit2.stages[0]).toBe('wider')
    await signals.recordImpressions(viewer, [older])

    const visit3 = await readWholeVisit(viewer)
    expect(visit3.served).toEqual([outside])
    expect(visit3.stages[0]).toBe('explore')
    await signals.recordImpressions(viewer, [outside])

    const visit4 = await readWholeVisit(viewer)
    expect(visit4.served).toEqual([])
    expect(visit4.last.caughtUp).toBe(true)
  })

  it('gives a member with no connections or follows a feed (cold start)', async () => {
    const newcomer = await member({ roleKey: 'third_officer', createdDaysAgo: 1 })
    const popular = await post(stranger, { hoursAgo: 3 })
    await db.query(`insert into public.post_reactions (post_id, user_id, reaction_type) select $1, id, 'like' from public.profiles where id <> $2 limit 4`, [popular, newcomer])
    const { top } = services()
    const page = await top.page({ viewerId: newcomer })
    expect(page.session.meta.coldStart).toBe(true)
    expect(page.postIds).toContain(popular)
  })

  it('pages through a snapshot without repeating or skipping a post', async () => {
    const authors = [friendA, friendB, followed]
    for (let index = 0; index < 5; index += 1) {
      const extra = await member()
      await connect(viewer, extra)
      authors.push(extra)
    }
    for (let index = 0; index < 40; index += 1) await post(authors[index % authors.length]!, { hoursAgo: index + 1 })
    const { top } = services()
    const first = await top.page({ viewerId: viewer, pageSize: 7 })
    const snapshot = first.session.postIds
    const collected = [...first.postIds]
    let next = first
    while (next.nextPosition !== null && next.nextPosition < snapshot.length) {
      next = await top.page({ viewerId: viewer, sessionId: first.session.id, position: next.nextPosition, pageSize: 7 })
      collected.push(...next.postIds)
    }
    expect(collected).toEqual(snapshot)
  })

  it('pins the member\'s own new post on top for its first minutes', async () => {
    await post(friendA, { hoursAgo: 1 })
    const own = await post(viewer, { hoursAgo: 0 })
    const { top } = services()
    expect((await top.page({ viewerId: viewer })).postIds[0]).toBe(own)
  })
})

describe('Home feed switch', () => {
  it('serves the old newest-first feed when the feed switch is off, and Top for you when on', async () => {
    const older = await post(friendA, { hoursAgo: 10 })
    const newer = await post(stranger, { hoursAgo: 1 })
    const { repository, top } = services()
    const base = {
      requireUser: async () => ({ id: viewer, cognitoSub: 'placeholder', email: null }),
      repository,
      getPreferredAuthorIds: async () => [friendA, friendB],
      resolveMediaUrls: async () => new Map<string, string>(),
      loadAccessContext: async () => ({}) as never,
      listAdministeredGroupIds: async () => [],
      topFeed: top,
      preferences: createFeedPreferences({ query }),
    }
    const off = createFeedQueries({ ...base, ranking: { isEnabled: async () => false, isAdministrator: async () => false } })
    const v1 = await off.getHomeFeed()
    expect(v1.mode).toBe('v1')
    expect(v1.page!.posts.map((item) => item.id)).toEqual(expect.arrayContaining([older, newer]))

    const on = createFeedQueries({ ...base, ranking: { isEnabled: async () => true, isAdministrator: async () => false } })
    expect((await on.getHomeFeed()).mode).toBe('top')
    const page = await on.getTopFeedPage({ debug: true })
    expect(page.posts.map((item) => item.id)).toContain(older)
    expect(page.posts.find((item) => item.id === older)?.rank?.reasons[0]).toMatch(/is your connection/)
    // Debug data is for administrators only.
    expect(page.posts.every((item) => !item.rank?.debug)).toBe(true)
  })
})
