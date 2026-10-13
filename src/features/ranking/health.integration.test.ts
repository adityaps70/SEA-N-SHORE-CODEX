import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createRankingHealth, per100 } from './health'

/**
 * Round G (MEASURE): feed engagement on Ranking health counts reactions and comments by the member
 * who was shown the post, after it was shown, so the rate is never site-wide activity divided by
 * tracked views. Placeholder data only.
 */
let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function member(index: number) {
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at) values (gen_random_uuid(), $1, $2, now()) returning id`,
    [`Placeholder Health ${index}`, `placeholder-health-${index}`],
  )
  return rows[0]!.id as string
}

describe('ranking health feed rates (round G)', () => {
  it('counts engagement by the shown member after the post was shown, not site-wide activity', async () => {
    const [author, viewer, other] = [await member(1), await member(2), await member(3)]
    const posts: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const rows = await db.query(`insert into public.posts (author_id, body, category) values ($1, $2, 'maritime_news') returning id`, [author, `Placeholder health post ${index}`])
      posts.push(rows[0]!.id as string)
    }
    await db.query(`insert into public.post_impressions (viewer_id, post_id, first_seen_at) select $1, unnest($2::uuid[]), now() - interval '1 hour'`, [viewer, posts])
    // Shown, then reacted: counts.
    await db.query(`insert into public.post_reactions (post_id, user_id, reaction_type) values ($1, $2, 'like')`, [posts[0], viewer])
    // Someone who was never shown it: does not count.
    await db.query(`insert into public.post_reactions (post_id, user_id, reaction_type) values ($1, $2, 'like')`, [posts[1], other])
    // Shown, then commented: counts.
    await db.query(`insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'Placeholder comment')`, [posts[2], viewer])

    const health = await createRankingHealth({ query: (text, values) => db.query(text, values) as Promise<Array<Record<string, unknown>>> }).load()
    expect(health[7]).toMatchObject({ postsSeen: 4, seenThenReacted: 1, seenThenCommented: 1 })
    expect(per100(health[7].seenThenReacted, health[7].postsSeen)).toBe('25.0')
  })
})
