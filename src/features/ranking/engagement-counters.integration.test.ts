import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createFeedRepository } from '@/features/feed/repository'
import { COUNTER_RECONCILE_START_UTC, createCounterReconcileSweep } from './engagement-counters-reconcile'

/**
 * Round CAP (feed counters, owner-approved 13 Nov) against the real schema (PGlite, every migration). Shadow proof:
 * after every kind of write (react, change type, unreact, comment reactions, vote, change vote, comment and post
 * deletes, a member's rows deleted), the counters of migration 0102 and the feed reads that use them give exactly
 * what the previous per-read counts gave, for every post, poll option and comment. The backfill rebuilds them from
 * nothing, and the nightly reconcile repairs drift and reports how many it fixed. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0
const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const TYPES = ['like', 'support', 'respect', 'on_point'] as const

// The previous SQL, frozen: what the feed counted on every read before migration 0102.
const PREVIOUS_POST_REACTIONS = `select p.id::text as id, json_build_object(
    'like', (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction_type = 'like')::int,
    'support', (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction_type = 'support')::int,
    'respect', (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction_type = 'respect')::int,
    'on_point', (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction_type = 'on_point')::int) as counts
  from public.posts p order by p.id`
const PREVIOUS_COMMENT_REACTIONS = PREVIOUS_POST_REACTIONS
  .replaceAll('public.post_reactions r where r.post_id = p.id', 'public.comment_reactions r where r.comment_id = p.id')
  .replace('from public.posts p', 'from public.post_comments p')
const PREVIOUS_POLL_VOTES = `select o.id::text as id, (select count(*) from public.post_poll_votes v where v.option_id = o.id)::int as votes
  from public.post_poll_options o order by o.id`
const PREVIOUS_PREVIEW_ORDER = `select c.post_id::text as post_id, c.id::text as id from public.post_comments c
  where c.parent_comment_id is null and c.deleted_at is null
  order by c.post_id, (select count(*) from public.comment_reactions cr where cr.comment_id = c.id) desc, c.created_at desc, c.id desc`

const COUNTER_POST_REACTIONS = `select p.id::text as id, json_build_object(
    'like', coalesce(c.like_count, 0), 'support', coalesce(c.support_count, 0),
    'respect', coalesce(c.respect_count, 0), 'on_point', coalesce(c.on_point_count, 0)) as counts
  from public.posts p left join public.post_reaction_counts c on c.post_id = p.id order by p.id`
const COUNTER_COMMENT_REACTIONS = COUNTER_POST_REACTIONS
  .replace('from public.posts p left join public.post_reaction_counts c on c.post_id = p.id',
    'from public.post_comments p left join public.comment_reaction_counts c on c.comment_id = p.id')
const COUNTER_POLL_VOTES = `select o.id::text as id, coalesce(c.votes, 0)::int as votes
  from public.post_poll_options o left join public.post_poll_option_counts c on c.option_id = o.id order by o.id`

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function member() {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at) values (gen_random_uuid(), $1, $2, now()) returning id`,
    [`Placeholder Person ${sequence}`, `placeholder-counter-${sequence}`],
  )
  return rows[0]!.id as string
}

async function post(authorId: string) {
  const rows = await db.query(
    `insert into public.posts (author_id, category, body, post_type) values ($1, 'technical_discussion', 'Placeholder text', 'standard') returning id`,
    [authorId],
  )
  return rows[0]!.id as string
}

async function poll(authorId: string, optionCount: number) {
  return db.transaction(async (run) => {
    const rows = await run(`insert into public.posts (author_id, category, body, post_type) values ($1, 'technical_discussion', 'Placeholder poll', 'poll') returning id`, [authorId])
    const id = rows[0]!.id as string
    await run(`insert into public.post_polls (post_id) values ($1)`, [id])
    const options: string[] = []
    for (let position = 0; position < optionCount; position += 1) {
      const option = await run(`insert into public.post_poll_options (post_id, label, position) values ($1, $2, $3) returning id`, [id, `Option ${position + 1}`, position])
      options.push(option[0]!.id as string)
    }
    return { id, options }
  })
}

async function comment(postId: string, authorId: string) {
  const rows = await db.query(`insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'Placeholder comment') returning id`, [postId, authorId])
  return rows[0]!.id as string
}

/** A small deterministic generator, so a failure always replays the same writes. */
function generator(seed: number) {
  let state = seed
  return (n: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state % n
  }
}

async function expectCountersMatchPrevious() {
  expect(await query(COUNTER_POST_REACTIONS)).toEqual(await query(PREVIOUS_POST_REACTIONS))
  expect(await query(COUNTER_COMMENT_REACTIONS)).toEqual(await query(PREVIOUS_COMMENT_REACTIONS))
  expect(await query(COUNTER_POLL_VOTES)).toEqual(await query(PREVIOUS_POLL_VOTES))
}

describe('engagement counters (Round CAP, migration 0102)', () => {
  const repo = createFeedRepository({ query: query as never })
  const members: string[] = []
  const posts: string[] = []
  const polls: Array<{ id: string; options: string[] }> = []
  const comments: string[] = []

  it('match the previous per-read counts after every kind of write, and so do the feed reads', async () => {
    for (let n = 0; n < 24; n += 1) members.push(await member())
    for (let n = 0; n < 10; n += 1) posts.push(await post(members[n % members.length]!))
    for (let n = 0; n < 4; n += 1) polls.push(await poll(members[n]!, 2 + n))
    for (let n = 0; n < 30; n += 1) comments.push(await comment(posts[n % posts.length]!, members[(n * 7) % members.length]!))

    const pick = generator(20261113)
    for (let step = 0; step < 900; step += 1) {
      const who = members[pick(members.length)]!
      const kind = pick(10)
      if (kind < 3) await repo.setPostReaction(who, posts[pick(posts.length)]!, pick(5) === 0 ? null : TYPES[pick(4)]!)
      else if (kind < 4) await repo.setLiked(who, posts[pick(posts.length)]!, pick(2) === 0)
      else if (kind < 6) await repo.setCommentReaction(who, comments[pick(comments.length)]!, pick(5) === 0 ? null : TYPES[pick(4)]!)
      else if (kind < 8) {
        const target = polls[pick(polls.length)]!
        await repo.setPollVote(who, target.id, target.options[pick(target.options.length)]!)
      } else if (kind < 9) {
        // Reactions on polls and comment reactions on any post too.
        await repo.setPostReaction(who, polls[pick(polls.length)]!.id, TYPES[pick(4)]!)
      } else {
        await repo.setPostReaction(who, posts[pick(posts.length)]!, TYPES[pick(4)]!)
      }
      if (step % 150 === 149) await expectCountersMatchPrevious()
    }
    await expectCountersMatchPrevious()

    // The feed's own reads now come from the counters: same numbers as the previous counts, post by post.
    const viewer = members[0]!
    const previousPosts = new Map((await query(PREVIOUS_POST_REACTIONS)).map((row) => [row.id, row.counts]))
    const previousVotes = new Map((await query(PREVIOUS_POLL_VOTES)).map((row) => [row.id, row.votes]))
    for (const id of [...posts, ...polls.map((p) => p.id)]) {
      const row = await repo.getPostRow(viewer, id) as unknown as { post_reactions: unknown; post_polls: { post_poll_options: Array<{ id: string; post_poll_votes: { count: number } }> } | null }
      expect(row.post_reactions).toEqual(previousPosts.get(id))
      for (const option of row.post_polls?.post_poll_options ?? []) expect(option.post_poll_votes.count).toBe(previousVotes.get(option.id))
    }
    const previousComments = new Map((await query(PREVIOUS_COMMENT_REACTIONS)).map((row) => [row.id, row.counts]))
    for (const row of await repo.getComments(posts, viewer)) {
      expect(row.reaction_summary).toEqual(previousComments.get(row.id))
    }
    // The comment preview still ranks by the comment's reactions, then newest.
    const previewIds = (await repo.getCommentPreview(posts, viewer, 2)).map((row) => row.id).sort()
    const previous = await query(PREVIOUS_PREVIEW_ORDER)
    const expected: string[] = []
    for (const postId of posts) expected.push(...previous.filter((row) => row.post_id === postId).slice(0, 2).map((row) => row.id as string))
    expect(previewIds).toEqual(expected.sort())
  })

  it('stay equal through deletes: a comment, a post with everything on it, and a member\'s rows', async () => {
    await db.query(`delete from public.post_comments where id = $1`, [comments[0]])
    await db.query(`update public.post_comments set deleted_at = now() where id = $1`, [comments[1]])
    await db.query(`delete from public.posts where id = $1`, [posts[1]])
    await db.query(`delete from public.posts where id = $1`, [polls[0]!.id])
    await db.query(`delete from public.post_reactions where user_id = $1`, [members[3]])
    await db.query(`delete from public.comment_reactions where user_id = $1`, [members[3]])
    await db.query(`delete from public.post_poll_votes where user_id = $1`, [members[3]])
    await expectCountersMatchPrevious()
    // Nothing is left for rows that are gone.
    const orphans = await query(`select
      (select count(*) from public.post_reaction_counts c where not exists (select 1 from public.posts p where p.id = c.post_id))::int as posts,
      (select count(*) from public.post_poll_option_counts c where not exists (select 1 from public.post_poll_options o where o.id = c.option_id))::int as options`)
    expect(orphans[0]).toEqual({ posts: 0, options: 0 })
  })

  it('are rebuilt exactly by the migration backfill', async () => {
    const migration = readFileSync('infra/aws/database/migrations/0102_round_cap_engagement_counters.sql', 'utf8')
    const backfill = migration.split('-- statement-breakpoint').map((part) => part.trim()).filter((part) => /^(--[^\n]*\n)*insert into public\./.test(part))
    expect(backfill).toHaveLength(3)
    await db.query(`delete from public.post_reaction_counts`)
    await db.query(`delete from public.comment_reaction_counts`)
    await db.query(`delete from public.post_poll_option_counts`)
    for (const statement of backfill) await db.query(statement)
    await expectCountersMatchPrevious()
  })

  it('never fails a member\'s like, vote, comment reaction or delete when a counter bump errors', async () => {
    // Break all three bump functions on purpose (a deadlock or anything unforeseen would raise the same way).
    const broken = (name: string, args: string) => `create or replace function public.${name}(${args}) returns void language plpgsql as $$
      begin raise exception 'simulated counter failure'; end $$`
    await db.query(broken('post_reaction_counts_bump', 'target uuid, kind public.post_reaction_type, delta integer'))
    await db.query(broken('comment_reaction_counts_bump', 'target uuid, kind public.post_reaction_type, delta integer'))
    await db.query(broken('post_poll_option_counts_bump', 'target uuid, delta integer'))
    const who = await member()
    const before = await query(`select count(*)::int as n from public.post_reactions`)
    await repo.setPostReaction(who, posts[3]!, 'support')
    await repo.setPostReaction(who, posts[3]!, 'respect')
    await repo.setCommentReaction(who, comments[5]!, 'like')
    await repo.setPollVote(who, polls[2]!.id, polls[2]!.options[0]!)
    await repo.setPollVote(who, polls[2]!.id, polls[2]!.options[1]!)
    await repo.setPostReaction(who, posts[3]!, null)
    // Every member write landed.
    expect((await query(`select count(*)::int as n from public.post_reactions`))[0]!.n).toBe(Number(before[0]!.n))
    expect((await query(`select count(*)::int as n from public.comment_reactions where user_id = $1`, [who]))[0]!.n).toBe(1)
    expect((await query(`select option_id::text as option from public.post_poll_votes where user_id = $1`, [who]))[0]!.option).toBe(polls[2]!.options[1])
    // Restore the real functions (re-apply them from the migration) for the reconcile test that follows.
    const migration = readFileSync('infra/aws/database/migrations/0102_round_cap_engagement_counters.sql', 'utf8')
    for (const part of migration.split('-- statement-breakpoint').map((piece) => piece.trim())) {
      if (/^(--[^\n]*\n)*create or replace function public\.[a-z_]+_bump/.test(part)) await db.query(part)
    }
  })

  it('drift is repaired by the nightly reconcile, in batches, with counts of what it fixed', async () => {
    await db.query(`insert into public.post_reaction_counts (post_id, like_count) values ($1, 3)
      on conflict (post_id) do update set like_count = public.post_reaction_counts.like_count + 3`, [posts[2]])
    await db.query(`delete from public.comment_reaction_counts where comment_id in (select comment_id from public.comment_reaction_counts order by comment_id limit 2)`)
    await db.query(`insert into public.post_poll_option_counts (option_id, votes) values ($1, 1)
      on conflict (option_id) do update set votes = public.post_poll_option_counts.votes + 1`, [polls[1]!.options[0]])
    const night = Date.UTC(2026, 10, 13, COUNTER_RECONCILE_START_UTC.hour, COUNTER_RECONCILE_START_UTC.minute)
    let clock = night - 60_000
    const sweep = createCounterReconcileSweep({ query, now: () => clock, batchSize: 7 })
    expect(sweep.requiresTable).toBe('post_reaction_counts')
    expect(await sweep.run()).toBeUndefined() // before the start time nothing runs
    clock = night
    let summary: Record<string, { scanned: number; fixed: number }> | undefined
    for (let pass = 0; pass < 100 && !summary; pass += 1) summary = await sweep.run() as typeof summary
    expect(summary).toBeDefined()
    // Fixed: the post counter corrupted here (its reaction bumps during the failure test cancelled out); the two
    // removed comment counters plus the comment reaction missed while the bumps were failing; the option counter
    // corrupted here plus the vote missed during the failure test.
    expect(summary!.post_reactions!.fixed).toBe(1)
    expect(summary!.comment_reactions!.fixed).toBeGreaterThanOrEqual(2)
    expect(summary!.poll_votes!.fixed).toBe(2)
    expect(summary!.post_reactions!.scanned).toBe(Number((await query(`select count(*)::int as n from public.posts`))[0]!.n))
    await expectCountersMatchPrevious()
    // A second run the next night finds nothing to fix.
    clock = night + 24 * 60 * 60 * 1000
    summary = undefined
    for (let pass = 0; pass < 100 && !summary; pass += 1) summary = await sweep.run() as typeof summary
    expect(Object.values(summary!).every((entry) => entry.fixed === 0)).toBe(true)
  })
})
