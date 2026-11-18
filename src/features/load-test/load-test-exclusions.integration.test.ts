import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Round ARCH (Phase 1) against the real schema (PGlite, every migration): a load-test account (profiles.is_load_test)
 * never reaches a real member. Its posts stay out of real members' Recent and Top feeds and the signed-out post view;
 * other load-test accounts still see them. Placeholder data only.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createFeedRepository } = await import('@/features/feed/repository')
const { createFeedCandidateRepository } = await import('@/features/ranking/feed-candidates')
const { createSignalsRepository } = await import('@/features/signals/repository')
const { createCommunityRepository } = await import('@/features/community/repository')

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

let sequence = 0
const ids = { real: '', realAuthor: '', testA: '', testB: '' }

async function member(name: string, loadTest = false) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, is_load_test)
     values (gen_random_uuid(), $1, $2, now(), $3) returning id`,
    [name, `fixture-member-${sequence}`, loadTest],
  )
  return rows[0]!.id as string
}

async function post(authorId: string, body: string) {
  const rows = await db.query(
    `insert into public.posts (id, author_id, category, body, post_type, audience)
     values (gen_random_uuid(), $1, 'technical_discussion', $2, 'standard', 'anyone') returning id`,
    [authorId, body],
  )
  return rows[0]!.id as string
}

async function follow(follower: string, following: string) {
  await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2)`, [follower, following])
}

beforeEach(async () => {
  for (const table of ['post_impressions', 'ranking_metrics_daily', 'posts', 'community_groups', 'follows', 'profiles']) await db.query(`delete from public.${table}`)
  ids.real = await member('Placeholder Real Member')
  ids.realAuthor = await member('Placeholder Real Author')
  ids.testA = await member('Load Test A', true)
  ids.testB = await member('Load Test B', true)
  // A real member following a load-test account (it should never happen) still never sees its posts.
  for (const [follower, following] of [[ids.real, ids.realAuthor], [ids.real, ids.testA], [ids.testB, ids.testA]]) await follow(follower!, following!)
})

describe('load-test accounts never reach real members (Round ARCH)', () => {
  it('keeps their posts out of a real member\'s Recent feed, while another load-test account sees them', async () => {
    const realPost = await post(ids.realAuthor, 'Fixture real post')
    const testPost = await post(ids.testA, 'Fixture load-test post')
    const repository = createFeedRepository()
    const realView = (await repository.listFeedRows({ viewerProfileId: ids.real, limit: 20 })).map((row) => row.id)
    expect(realView).toContain(realPost)
    expect(realView).not.toContain(testPost)
    const testView = (await repository.listFeedRows({ viewerProfileId: ids.testB, limit: 20 })).map((row) => row.id)
    expect(testView).toContain(testPost)
  })

  it('keeps their posts out of a real member\'s Top-feed candidates', async () => {
    const realPost = await post(ids.realAuthor, 'Fixture real post')
    const testPost = await post(ids.testA, 'Fixture load-test post')
    const candidates = createFeedCandidateRepository()
    for (const mode of ['network', 'explore'] as const) {
      const realView = (await candidates.listCandidates({ viewerId: ids.real, windowDays: 30, mode })).map((row) => row.id)
      expect(realView, mode).not.toContain(testPost)
      if (mode === 'network') expect(realView).toContain(realPost)
    }
    const testView = (await candidates.listCandidates({ viewerId: ids.testB, windowDays: 30, mode: 'network' })).map((row) => row.id)
    expect(testView).toContain(testPost)
  })

  it('never shows their posts to signed-out visitors', async () => {
    const realPost = await post(ids.realAuthor, 'Fixture real post')
    const testPost = await post(ids.testA, 'Fixture load-test post')
    const repository = createFeedRepository()
    expect(await repository.getPublicPostRow(realPost)).not.toBeNull()
    expect(await repository.getPublicPostRow(testPost)).toBeNull()
  })

  it('records no impressions and counts no metrics for a load-test account, while real members still count', async () => {
    const realPost = await post(ids.realAuthor, 'Fixture real post')
    const signals = createSignalsRepository()
    expect(await signals.recordImpressions(ids.testA, [realPost])).toBe(0)
    expect(await signals.recordImpressions(ids.real, [realPost])).toBe(1)
    await signals.incrementMetric('feed.top_pages', 1, ids.testA)
    await signals.incrementMetric('feed.top_pages', 1, ids.real)
    await signals.incrementMetric('feed.top_pages', 2)
    const rows = await db.query(`select value from public.ranking_metrics_daily where metric = 'feed.top_pages'`)
    expect(Number(rows[0]?.value)).toBe(3)
    // Owner (18 Nov, fix 3d): the batched write leaves load-test accounts out the same way.
    await signals.incrementMetrics([
      { metric: 'feed.batched', amount: 5, actorProfileId: ids.testA },
      { metric: 'feed.batched', amount: 2, actorProfileId: ids.real },
      { metric: 'feed.batched', amount: 1, actorProfileId: null },
    ])
    const batched = await db.query(`select value from public.ranking_metrics_daily where metric = 'feed.batched'`)
    expect(batched.map((row) => Number(row.value))).toEqual([3])
    const impressions = await db.query(`select viewer_id from public.post_impressions`)
    expect(impressions.map((row) => row.viewer_id)).toEqual([ids.real])
  })

  it('keeps the hidden test community out of real members\' community directory and search, but not test accounts\'', async () => {
    const groups = await db.query(
      `insert into public.community_groups (name, slug, visibility, description, created_by, is_load_test)
       values ('Placeholder Real Group', 'placeholder-real-group', 'public', 'Placeholder description', $1, false),
              ('Load Test Group', 'load-test-group', 'private', 'Placeholder description', $2, true)
       returning id, is_load_test`,
      [ids.realAuthor, ids.testA],
    )
    const testGroup = groups.find((row) => row.is_load_test === true)!.id as string
    const realGroup = groups.find((row) => row.is_load_test === false)!.id as string
    const community = createCommunityRepository()
    const realDirectory = (await community.listDirectory(ids.real)).map((group) => group.id)
    expect(realDirectory).toContain(realGroup)
    expect(realDirectory).not.toContain(testGroup)
    const realBrowse = (await community.browseDirectory(ids.real, { search: 'Group' })).groups.map((group) => group.id)
    expect(realBrowse).not.toContain(testGroup)
    expect((await community.listDirectory(ids.testB)).map((group) => group.id)).toContain(testGroup)
  })
})
