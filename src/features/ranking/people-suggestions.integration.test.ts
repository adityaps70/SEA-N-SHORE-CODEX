import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createProfileRepository } from '@/features/profiles/repository'
import { createPeopleCandidateRepository } from './people-candidates'
import { createPeopleSuggestions } from './people-suggestions'
import { createPeopleSweep } from './people-sweep'
import { createSignalsRepository } from '@/features/signals/repository'
import { createPrivacyPreferences } from '@/features/profiles/privacy-preferences'
import { DECLINED_REQUEST_SUGGESTION_WINDOW, RECOMMENDATION_WEIGHTS } from '@/features/network/recommendations'

/**
 * Round G (G2) against the real schema (PGlite, every migration): People you may know precomputes
 * from mutual connections, shipmates and profile matches, and never suggests anyone excluded.
 * Placeholder data only.
 */
let db: TestDatabase
let sequence = 0
let viewer = ''

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>

function service() {
  const candidates = createPeopleCandidateRepository({ query })
  return { candidates, people: createPeopleSuggestions({ candidates, profiles: createProfileRepository({ query: query as never }) }) }
}

async function member(extra: { roleKey?: string; profileType?: string; location?: string } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, profile_type, location, headline, avatar_path)
     values (gen_random_uuid(), $1, $2, now(), $3, $4::public.profile_type, $5, 'Placeholder headline', 'profiles/placeholder.webp') returning id`,
    [`Placeholder Mariner ${sequence}`, `placeholder-mariner-${sequence}`, extra.roleKey ?? null, extra.profileType ?? 'seafarer', extra.location ?? null],
  )
  return rows[0]!.id as string
}

async function connect(a: string, b: string, status: 'accepted' | 'pending' = 'accepted', requestedBy = a) {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, $4::public.connection_status)`, [low, high, requestedBy, status])
}

async function sailed(profileId: string, vessel: string, from: string, to: string | null) {
  await db.query(
    `insert into public.profile_experiences (profile_id, track, title, organization, vessel, started_on, ended_on) values ($1, 'sea_service', 'Second Officer', 'Placeholder Lines', $2, $3, $4)`,
    [profileId, vessel, from, to],
  )
}

beforeEach(async () => {
  for (const table of ['people_suggestions', 'suggestion_dismissals', 'member_preferences', 'profile_experiences', 'social_action_events', 'user_blocks', 'follows', 'connections', 'maritime_profiles', 'profiles']) {
    await db.query(`delete from public.${table}`)
  }
  viewer = await member({ roleKey: 'second_officer', location: 'Mumbai, India' })
})

describe('People you may know, precomputed (round G)', () => {
  it('never suggests a load-test account, never computes suggestions for one, and the live list skips them too (Round ARCH)', async () => {
    const friend = await member()
    const testAccount = await member()
    const realStranger = await member()
    await db.query(`update public.profiles set is_load_test = true where id = $1`, [testAccount])
    await connect(viewer, friend)
    await connect(friend, testAccount)
    await connect(friend, realStranger)
    const { people, candidates } = service()
    await people.refreshForViewer(viewer)
    const ids = (await people.list(viewer, { limit: 10 })).map((entry) => entry.candidateId)
    expect(ids).toContain(realStranger)
    expect(ids).not.toContain(testAccount)
    const live = await createProfileRepository({ query: query as never }).getPeopleSuggestions({
      viewerProfileId: viewer, limit: 20, weights: RECOMMENDATION_WEIGHTS, declinedRequestWindow: DECLINED_REQUEST_SUGGESTION_WINDOW, roundG: true,
    })
    expect(live.map((entry) => entry.id)).not.toContain(testAccount)
    // The nightly run never spends work on a load-test account.
    const covered = await candidates.listViewersToRefresh(null, 100)
    expect(covered).toContain(viewer)
    expect(covered).not.toContain(testAccount)
  })

  it('suggests friends of friends with the mutual count as the reason', async () => {
    const friend1 = await member()
    const friend2 = await member()
    const friendOfFriends = await member()
    await connect(viewer, friend1)
    await connect(viewer, friend2)
    await connect(friend1, friendOfFriends)
    await connect(friend2, friendOfFriends)
    const { people } = service()
    await people.refreshForViewer(viewer)
    const list = await people.list(viewer, { limit: 3 })
    expect(list[0]).toEqual({ candidateId: friendOfFriends, reason: '2 mutual connections', source: 'mutual' })
  })

  it('finds shipmates only when their time on the same vessel overlaps', async () => {
    const overlapping = await member()
    const notOverlapping = await member()
    await sailed(viewer, 'MV Placeholder Star', '2024-01-01', '2024-06-30')
    await sailed(overlapping, 'mv placeholder star', '2024-05-01', '2024-12-31')
    await sailed(notOverlapping, 'MV Placeholder Star', '2025-01-01', null)
    const { people } = service()
    await people.refreshForViewer(viewer)
    const stored = await db.query(`select candidate_id, primary_source from public.people_suggestions where viewer_id = $1`, [viewer])
    expect(stored).toContainEqual({ candidate_id: overlapping, primary_source: 'shipmate' })
    expect(stored.find((row) => row.candidate_id === notOverlapping)?.primary_source).not.toBe('shipmate')
    const list = await people.list(viewer, { limit: 1 })
    expect(list[0]!.reason).toBe('Sailed on mv placeholder star together')
  })

  it('never suggests connected, pending, followed, blocked, declined, dismissed or opted-out members, or organisations', async () => {
    const friend = await member()
    const connected = await member()
    const pendingOut = await member()
    const pendingIn = await member()
    const followed = await member()
    const blocked = await member()
    const declined = await member()
    const dismissed = await member()
    const optedOut = await member()
    const organisation = await member({ profileType: 'company' })
    const eligible = await member()
    const everyone = [connected, pendingOut, pendingIn, followed, blocked, declined, dismissed, optedOut, organisation, eligible]
    await connect(viewer, friend)
    for (const id of everyone) await connect(friend, id)
    await connect(viewer, connected)
    await connect(viewer, pendingOut, 'pending', viewer)
    await connect(viewer, pendingIn, 'pending', pendingIn)
    await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2)`, [viewer, followed])
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [blocked, viewer])
    await db.query(`insert into public.social_action_events (profile_id, action, target_profile_id) values ($1, 'connection_request', $2)`, [viewer, declined])

    const { people } = service()
    await people.refreshForViewer(viewer)
    // Dismissed and opted out after the nightly run: the read path re-checks live.
    await createSignalsRepository({ query }).dismissSuggestion(viewer, 'person', dismissed)
    await createPrivacyPreferences({ query }).set(optedOut, 'showInPeopleSuggestions', false)

    const ids = (await people.list(viewer, { limit: 20 })).map((item) => item.candidateId)
    expect(ids).toContain(eligible)
    for (const id of [viewer, friend, connected, pendingOut, pendingIn, followed, blocked, declined, dismissed, optedOut, organisation]) {
      expect(ids).not.toContain(id)
    }
  })

  it('re-checks precomputed rows live: someone requested after the nightly run never shows', async () => {
    const friend = await member()
    const candidate = await member()
    await connect(viewer, friend)
    await connect(friend, candidate)
    const { people } = service()
    await people.refreshForViewer(viewer)
    expect((await people.list(viewer, { limit: 3 })).map((item) => item.candidateId)).toContain(candidate)
    await connect(viewer, candidate, 'pending', viewer)
    expect((await people.list(viewer, { limit: 3 })).map((item) => item.candidateId)).not.toContain(candidate)
  })

  it('always fills the rail with 3 when 3 eligible members exist, topping up from live profile matching', async () => {
    const friend = await member()
    const viaFriend = await member()
    await connect(viewer, friend)
    await connect(friend, viaFriend)
    const strangers = [await member(), await member()]
    const { people } = service()
    await people.refreshForViewer(viewer)
    // Only one candidate scores in the precomputed list (no shared attributes with the strangers).
    expect((await db.query(`select count(*)::int as n from public.people_suggestions where viewer_id = $1`, [viewer]))[0]!.n).toBe(1)
    const list = await people.list(viewer, { limit: 3 })
    expect(list.map((item) => item.candidateId).sort()).toEqual([viaFriend, ...strangers].sort())
  })

  it('the nightly sweep refreshes every member and reports a count', async () => {
    const friend = await member()
    const other = await member()
    await connect(viewer, friend)
    await connect(friend, other)
    const { people, candidates } = service()
    const sweep = createPeopleSweep({ candidates, service: people, query, batchSize: 2 })
    let result: Record<string, unknown> | undefined
    for (let step = 0; step < 10 && !result; step += 1) result = await sweep.run()
    expect(result).toMatchObject({ members: 3 })
    expect((await db.query(`select count(*)::int as n from public.people_suggestions`))[0]!.n).toBeGreaterThan(0)
  })
})
