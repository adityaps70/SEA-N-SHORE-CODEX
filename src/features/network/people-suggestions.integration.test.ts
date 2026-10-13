import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createProfileRepository } from '@/features/profiles/repository'
import { DECLINED_REQUEST_SUGGESTION_WINDOW, PEOPLE_SUGGESTION_LIMITS, RECOMMENDATION_WEIGHTS } from './recommendations'

/**
 * Round G hotfix against the real schema (PGlite, every migration): People you may know excludes
 * people in SQL before the limit, so the list stays full. Placeholder data only.
 */

let db: TestDatabase
let sequence = 0
let viewer = ''

beforeAll(async () => {
  db = await createTestDatabase()
  // Fixture members only need to count as onboarded; the identity fields are not what these tests are about.
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.query('delete from public.social_action_events')
  await db.query('delete from public.connections')
  await db.query('delete from public.follows')
  await db.query('delete from public.user_blocks')
  await db.query('delete from public.maritime_profiles')
  await db.query('delete from public.profiles')
  viewer = await member()
})

async function member(options: { profileType?: string; headline?: string; rank?: string; updatedMinutesAgo?: number; status?: string } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, profile_type, headline, account_status, updated_at)
     values (gen_random_uuid(), $1, $2, now(), $3::public.profile_type, $4, $5::public.account_status, now() - make_interval(mins => $6))
     returning id`,
    [
      `Placeholder Member ${sequence}`,
      `placeholder-member-${sequence}`,
      options.profileType ?? 'seafarer',
      options.headline ?? 'Maritime professional',
      options.status ?? 'active',
      options.updatedMinutesAgo ?? sequence,
    ],
  )
  const id = rows[0]!.id as string
  if (options.rank) {
    await db.query(`insert into public.maritime_profiles (user_id, rank) values ($1, $2)`, [id, options.rank])
  }
  return id
}

async function connection(a: string, b: string, requestedBy: string, status: 'pending' | 'accepted') {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(
    `insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, $4::public.connection_status)`,
    [low, high, requestedBy, status],
  )
}

async function suggestions(limit: number = PEOPLE_SUGGESTION_LIMITS.rail) {
  const repository = createProfileRepository({ query: async (text, values) => db.query(text, values) as never })
  const profiles = await repository.getPeopleSuggestions({
    viewerProfileId: viewer,
    limit,
    weights: RECOMMENDATION_WEIGHTS,
    declinedRequestWindow: DECLINED_REQUEST_SUGGESTION_WINDOW,
  })
  return profiles.map((profile) => profile.id)
}

describe('People you may know (round G hotfix)', () => {
  it('never suggests someone the viewer sent a pending request to, or who sent the viewer one', async () => {
    const sentTo = await member()
    const receivedFrom = await member()
    const eligible = await member()
    await connection(viewer, sentTo, viewer, 'pending')
    await connection(viewer, receivedFrom, receivedFrom, 'pending')

    const ids = await suggestions()
    expect(ids).not.toContain(sentTo)
    expect(ids).not.toContain(receivedFrom)
    expect(ids).toEqual([eligible])
  })

  it('never suggests the viewer, a connection, a followed member, a blocked member either way or an organisation', async () => {
    const connected = await member()
    const followed = await member()
    const blockedByViewer = await member()
    const blockedViewer = await member()
    const organisation = await member({ profileType: 'company' })
    const eligible = await member()
    await connection(viewer, connected, viewer, 'accepted')
    await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2)`, [viewer, followed])
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2), ($3, $1)`, [viewer, blockedByViewer, blockedViewer])

    const ids = await suggestions()
    expect(ids).toEqual([eligible])
    for (const excluded of [viewer, connected, followed, blockedByViewer, blockedViewer, organisation]) {
      expect(ids).not.toContain(excluded)
    }
  })

  it('hides a member whose request from the viewer was declined or withdrawn within 180 days, and shows them again after', async () => {
    const declinedRecently = await member()
    const declinedLongAgo = await member()
    await db.query(
      `insert into public.social_action_events (profile_id, action, target_profile_id, created_at)
       values ($1, 'connection_request', $2, now() - interval '30 days'),
              ($1, 'connection_request', $3, now() - interval '181 days')`,
      [viewer, declinedRecently, declinedLongAgo],
    )

    const ids = await suggestions()
    expect(ids).not.toContain(declinedRecently)
    expect(ids).toContain(declinedLongAgo)
  })

  it('leaves out inactive and synthetic test profiles before the limit', async () => {
    const suspended = await member({ status: 'suspended' })
    const synthetic = await member({ headline: 'E2E test user account' })
    const eligible = await member()

    const ids = await suggestions(1)
    expect(ids).toEqual([eligible])
    expect(ids).not.toContain(suspended)
    expect(ids).not.toContain(synthetic)
  })

  it('excludes before the limit, so 5 requests in a row still leave the 3 other eligible members on the rail', async () => {
    // The five people the viewer asks first are the most recently updated, so they would fill a
    // pool picked before exclusion.
    const asked: string[] = []
    for (let index = 0; index < 5; index += 1) asked.push(await member({ updatedMinutesAgo: index }))
    const others: string[] = []
    for (let index = 0; index < 3; index += 1) others.push(await member({ updatedMinutesAgo: 100 + index }))

    expect((await suggestions(3)).every((id) => asked.includes(id))).toBe(true)
    for (const id of asked) {
      await connection(viewer, id, viewer, 'pending')
      await db.query(`insert into public.social_action_events (profile_id, action, target_profile_id) values ($1, 'connection_request', $2)`, [viewer, id])
    }

    expect(await suggestions(3)).toEqual(others)
  })

  it('ranks shared attributes first and returns nobody when no one is eligible', async () => {
    await db.query(`insert into public.maritime_profiles (user_id, rank) values ($1, 'Second Officer')`, [viewer])
    const sameRank = await member({ rank: 'second officer', updatedMinutesAgo: 500 })
    const other = await member({ rank: 'Master', updatedMinutesAgo: 1 })
    expect(await suggestions()).toEqual([sameRank, other])

    await connection(viewer, sameRank, viewer, 'pending')
    await connection(viewer, other, viewer, 'accepted')
    expect(await suggestions()).toEqual([])
  })
})
