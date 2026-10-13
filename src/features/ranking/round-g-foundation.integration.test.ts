import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { CERTIFICATE_TYPE_SEEDS, MARITIME_RANKS, VESSEL_TYPE_SEEDS } from '@/features/taxonomy/maritime-taxonomy'
import { listUnmappedTaxonomyValues, runTaxonomyBackfill } from '@/features/taxonomy/backfill'
import { createSignalsRepository } from '@/features/signals/repository'
import { purgeExpiredSignals } from '@/features/signals/retention'
import { createRankingSwitches } from './switches'

/**
 * Round G, PR 1 (G0) against the real schema (PGlite, every migration): the taxonomy seed matches the
 * code, triggers fill codes and keep post_stats current, and the signals, backfill and retention SQL
 * behave. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>

async function member() {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at) values (gen_random_uuid(), $1, $2, now()) returning id`,
    [`Placeholder Person ${sequence}`, `placeholder-person-${sequence}`],
  )
  return rows[0]!.id as string
}

async function post(authorId: string, extra: { repostOf?: string } = {}) {
  const rows = await db.query(
    `insert into public.posts (author_id, category, body, post_type, repost_of_post_id)
     values ($1, 'technical_discussion', 'Placeholder text', $2::public.post_type, $3) returning id`,
    [authorId, extra.repostOf ? 'repost' : 'standard', extra.repostOf ?? null],
  )
  return rows[0]!.id as string
}

async function stats(postId: string) {
  const rows = await db.query(`select reactions, comments, reposts, last_engaged_at from public.post_stats where post_id = $1`, [postId])
  return rows[0] ?? null
}

describe('taxonomy seed (migration 0083)', () => {
  it('holds exactly the ranks, vessel types and certificates in the code', async () => {
    const ranks = await db.query(`select code, name, department, ladder, ladder_level, synonyms, same_as from public.maritime_ranks order by sort_order`)
    expect(ranks.map((row) => [row.code, row.name, row.department, row.ladder, row.ladder_level, row.synonyms, row.same_as]))
      .toEqual(MARITIME_RANKS.map((rank) => [rank.code, rank.name, rank.department, rank.ladder, rank.ladderLevel, [...rank.synonyms], rank.sameAs]))
    const vessels = await db.query(`select code, name, vessel_group, synonyms from public.vessel_types order by sort_order`)
    expect(vessels.map((row) => [row.code, row.name, row.vessel_group, row.synonyms]))
      .toEqual(VESSEL_TYPE_SEEDS.map((vessel) => [vessel.code, vessel.name, vessel.group, [...vessel.synonyms]]))
    const certificates = await db.query(`select code, name, category, synonyms, coc_rank_code from public.certificate_types order by sort_order`)
    expect(certificates.map((row) => [row.code, row.name, row.category, row.synonyms, row.coc_rank_code]))
      .toEqual(CERTIFICATE_TYPE_SEEDS.map((certificate) => [certificate.code, certificate.name, certificate.category, [...certificate.synonyms], certificate.cocRankCode ?? null]))
  })

  it('maps no term to two codes, and normalises like the app', async () => {
    const conflicts = await db.query(`select kind, term from public.taxonomy_terms group by kind, term having count(distinct code) > 1`)
    expect(conflicts).toEqual([])
    const [row] = await db.query(`select public.taxonomy_code('rank', '2/O') as a, public.taxonomy_code('rank', ' c.e ') as b, public.taxonomy_code('vessel', 'Oil/Chemical Tanker') as c`)
    expect(row).toEqual({ a: 'second_officer', b: 'chief_engineer', c: 'chemical_tanker' })
  })
})

describe('taxonomy codes on new rows, backfill and unmapped values', () => {
  it('fills codes from text on insert and edit, backfills old rows, and lists what stays unmapped', async () => {
    const profileId = await member()
    await db.query(`insert into public.maritime_profiles (user_id, rank, vessel_types) values ($1, 'Navigator', '{VLCC,Hovercraft}')`, [profileId])
    const [maritime] = await db.query(`select vessel_type_codes from public.maritime_profiles where user_id = $1`, [profileId])
    expect(maritime!.vessel_type_codes).toEqual(['crude_tanker'])

    const [experience] = await db.query(
      `insert into public.profile_experiences (profile_id, track, title, organization, vessel, vessel_type)
       values ($1, 'sea_service', '2nd Mate', 'Placeholder Lines', 'MV Placeholder', 'Product tanker') returning id, rank_code, vessel_type_code`,
      [profileId],
    )
    expect([experience!.rank_code, experience!.vessel_type_code]).toEqual(['second_officer', 'product_tanker'])

    // A row from before the migration has no codes: the sweep fills them once, then finds nothing new.
    await db.query(`update public.profile_experiences set rank_code = null, vessel_type_code = null where id = $1`, [experience!.id])
    await db.query(
      `insert into public.profile_experiences (profile_id, track, title, organization) values ($1, 'sea_service', 'Sky Pilot', 'Placeholder Lines')`,
      [profileId],
    )
    const first = await runTaxonomyBackfill({ query })
    expect(first.experience_rank).toEqual({ scanned: 2, mapped: 1 })
    expect(first.experience_vessel).toEqual({ scanned: 1, mapped: 1 })

    const unmapped = await listUnmappedTaxonomyValues({ query })
    expect(unmapped.values).toEqual(expect.arrayContaining([
      { kind: 'rank', value: 'navigator', count: 1 },
      { kind: 'rank', value: 'sky pilot', count: 1 },
      { kind: 'vessel', value: 'hovercraft', count: 1 },
    ]))
    expect(unmapped.totals.rank).toEqual({ distinct: 2, rows: 2 })
  })
})

describe('post_stats triggers', () => {
  it('counts reactions, live comments and live reposts as they change', async () => {
    const author = await member()
    const reader = await member()
    const original = await post(author)
    expect(await stats(original)).toBeNull()

    await db.query(`insert into public.post_reactions (post_id, user_id, reaction_type) values ($1, $2, 'like')`, [original, reader])
    const [comment] = await db.query(`insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'Placeholder comment') returning id`, [original, reader])
    const repost = await post(reader, { repostOf: original })
    expect(await stats(original)).toMatchObject({ reactions: 1, comments: 1, reposts: 1 })
    expect((await stats(original))!.last_engaged_at).not.toBeNull()

    await db.query(`update public.post_comments set deleted_at = now() where id = $1`, [comment!.id])
    await db.query(`update public.posts set deleted_at = now(), deleted_by = $2, deletion_reason = 'author', purge_after = now() + interval '30 days' where id = $1`, [repost, reader])
    await db.query(`delete from public.post_reactions where post_id = $1`, [original])
    expect(await stats(original)).toMatchObject({ reactions: 0, comments: 0, reposts: 0 })
  })
})

describe('signals', () => {
  beforeEach(async () => {
    await db.query('delete from public.post_impressions')
  })

  it('records impressions once per hour per viewer and post, skipping unknown posts', async () => {
    const author = await member()
    const viewer = await member()
    const postId = await post(author)
    const signals = createSignalsRepository({ query })

    expect(await signals.recordImpressions(viewer, [postId, postId, '00000000-0000-4000-8000-00000000dead'])).toBe(1)
    expect(await signals.recordImpressions(viewer, [postId])).toBe(0)
    await db.query(`update public.post_impressions set last_seen_at = now() - interval '2 hours'`)
    expect(await signals.recordImpressions(viewer, [postId])).toBe(1)
    const [row] = await db.query(`select seen_count from public.post_impressions where viewer_id = $1 and post_id = $2`, [viewer, postId])
    expect(row!.seen_count).toBe(2)
  })

  it('mutes, lists and unmutes a member; dismisses suggestions; stores feedback with author and category', async () => {
    const viewer = await member()
    const author = await member()
    const postId = await post(author)
    const signals = createSignalsRepository({ query })

    await signals.muteProfile(viewer, author)
    await signals.muteProfile(viewer, author)
    await signals.muteProfile(viewer, viewer)
    const mutes = await signals.listMutes(viewer)
    expect(mutes).toHaveLength(1)
    expect(mutes[0]).toMatchObject({ kind: 'person', slug: expect.stringMatching(/^placeholder-person-/) })
    expect(await signals.unmute(author, mutes[0]!.id)).toBe(false)
    expect(await signals.unmute(viewer, mutes[0]!.id)).toBe(true)

    await db.query(`insert into public.people_suggestions (viewer_id, candidate_id, score, primary_source) values ($1, $2, 5, 'profile')`, [viewer, author])
    await signals.dismissSuggestion(viewer, 'person', author)
    expect(await db.query(`select 1 from public.people_suggestions where viewer_id = $1`, [viewer])).toEqual([])
    expect(await db.query(`select kind from public.suggestion_dismissals where viewer_id = $1`, [viewer])).toEqual([{ kind: 'person' }])

    expect(await signals.recordFeedFeedback(viewer, postId, 'show_less')).toBe(true)
    const [feedback] = await db.query(`select author_id, category from public.feed_feedback where viewer_id = $1`, [viewer])
    expect(feedback).toEqual({ author_id: author, category: 'technical_discussion' })

    await signals.incrementMetric('pymk.cards_shown', 3)
    await signals.incrementMetric('pymk.cards_shown', 2)
    const [metric] = await db.query(`select value from public.ranking_metrics_daily where metric = 'pymk.cards_shown'`)
    expect(Number(metric!.value)).toBe(5)
  })

  it('purges signals past their retention and keeps the rest', async () => {
    const author = await member()
    const viewer = await member()
    const oldPost = await post(author)
    const newPost = await post(author)
    await db.query(
      `insert into public.post_impressions (viewer_id, post_id, first_seen_at, last_seen_at) values ($1, $2, now() - interval '200 days', now() - interval '181 days'), ($1, $3, now(), now())`,
      [viewer, oldPost, newPost],
    )
    await db.query(`insert into public.search_queries (viewer_id, normalized_query, created_at) values ($1, 'old', now() - interval '91 days'), ($1, 'new', now())`, [viewer])
    const purged = await purgeExpiredSignals({ query })
    expect(purged.post_impressions).toBe(1)
    expect(purged.search_queries).toBe(1)
    expect(await db.query(`select post_id from public.post_impressions where viewer_id = $1`, [viewer])).toEqual([{ post_id: newPost }])
  })
})

describe('ranking settings', () => {
  it('starts with the feed and people switches on for administrators only', async () => {
    const switches = createRankingSwitches({ query })
    expect(await switches.listModes()).toMatchObject({ feed: 'admins', people: 'admins', jobs: 'off', weekly_digest: 'off' })
  })
})
