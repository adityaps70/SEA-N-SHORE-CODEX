import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createProfileRepository } from '@/features/profiles/repository'
import { createSignalsRepository } from '@/features/signals/repository'
import { createPrivacyPreferences } from '@/features/profiles/privacy-preferences'
import { DECLINED_REQUEST_SUGGESTION_WINDOW, RECOMMENDATION_WEIGHTS } from '@/features/network/recommendations'
import { createPeopleCandidateRepository } from './people-candidates'
import { createPeopleSuggestions, PEOPLE_TOP_UP_CACHE_MS } from './people-suggestions'

/**
 * Round DB (PYMK fix 2, owner-approved 12 Nov) against the real schema (PGlite, every migration): a shadow
 * comparison of People you may know before and after the top-up is kept for 10 minutes. "Before" scores the
 * top-up afresh on every view (the cache off); "after" keeps it and re-runs the same query over the kept ids.
 * Every viewer and list size gives the same people in the same order, including after members are blocked,
 * connected, requested, followed, dismissed, hidden, removed or flagged as load-test accounts, and a freshly
 * joined member gets suggestions at once. Placeholder data only; the comparison reports counts.
 */
let db: TestDatabase
let sequence = 0
let clock = Date.parse('2026-11-12T08:00:00Z')

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const profiles = () => createProfileRepository({ query: query as never })
const candidates = () => createPeopleCandidateRepository({ query })
/** Before: the top-up scored afresh on every view. */
const before = () => createPeopleSuggestions({ candidates: candidates(), profiles: profiles(), topUpCacheMs: 0, now: () => clock })
/** After: the top-up kept for 10 minutes and re-checked on every view. */
const after = () => createPeopleSuggestions({ candidates: candidates(), profiles: profiles(), now: () => clock })

type Member = { roleRank?: string; location?: string; profileType?: string; vessel?: string; skill?: string; name?: string; onboarded?: boolean; slug?: boolean; status?: string; organisation?: boolean }

async function member(extra: Member = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, profile_type, location, headline, account_status,
                                  identity_root, primary_identity, primary_identity_family, updated_at)
     values (gen_random_uuid(), $1, $2, case when $3::boolean then now() end, $4::public.profile_type, $5, 'Placeholder headline',
             $6::public.account_status, $7::text, case when $7::text is not null then 'Shipowner' end, case when $7::text is not null then 'Shipping & Ship Management' end,
             timestamptz '2026-11-01 00:00:00+00' + make_interval(mins => $8::int)) returning id`,
    [extra.name ?? `Placeholder Mariner ${sequence}`, extra.slug === false ? null : `placeholder-mariner-${sequence}`, extra.onboarded !== false,
      extra.profileType ?? 'seafarer', extra.location ?? null, extra.status ?? 'active', extra.organisation ? 'organisation' : null, sequence],
  )
  const id = String(rows[0]!.id)
  if (extra.roleRank || extra.vessel) {
    await db.query(`insert into public.maritime_profiles (user_id, rank, vessel_types) values ($1, $2, $3)`, [id, extra.roleRank ?? null, extra.vessel ? [extra.vessel] : []])
  }
  if (extra.skill) await db.query(`insert into public.profile_skills (user_id, skill) values ($1, $2)`, [id, extra.skill])
  return id
}

async function connect(a: string, b: string, status: 'accepted' | 'pending', requestedBy = a) {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, $4::public.connection_status)`, [low, high, requestedBy, status])
}

const ids = async (service: ReturnType<typeof createPeopleSuggestions>, viewer: string, limit: number) =>
  (await service.list(viewer, { limit })).map((item) => item.candidateId)

const LIMITS = [1, 3, 5, 12, 40]

/** Compares before and after for every viewer and list size; returns the counts (never ids). */
async function shadow(viewers: string[], kept: ReturnType<typeof createPeopleSuggestions>) {
  const counts = { lists: 0, identical: 0, entries: 0 }
  for (const viewer of viewers) {
    for (const limit of LIMITS) {
      const was = await ids(before(), viewer, limit)
      const now = await ids(kept, viewer, limit)
      counts.lists += 1
      counts.entries += was.length
      if (JSON.stringify(was) === JSON.stringify(now)) counts.identical += 1
    }
  }
  return counts
}

describe('People you may know top-up, kept for 10 minutes (shadow comparison)', () => {
  it('gives every viewer the same people as before, and nobody excluded, through every kind of change', async () => {
    // Viewers: two with shared attributes, one with none, one with a precomputed list.
    const viewers = [
      await member({ roleRank: 'Second Officer', location: 'Mumbai, India', vessel: 'Bulk Carrier', skill: 'ECDIS' }),
      await member({ roleRank: 'Chief Engineer', location: 'Kochi, India', vessel: 'Tanker' }),
      await member(),
    ]
    const withStored = await member({ roleRank: 'Second Officer', location: 'Mumbai, India' })
    viewers.push(withStored)
    // Eligible members with every mix of shared attributes, so scores and ties both occur.
    const eligible: string[] = []
    for (let n = 0; n < 30; n += 1) {
      eligible.push(await member({
        roleRank: n % 3 === 0 ? 'Second Officer' : n % 3 === 1 ? 'Chief Engineer' : undefined,
        location: n % 4 === 0 ? 'Mumbai, India' : n % 4 === 1 ? 'Kochi, India' : undefined,
        vessel: n % 5 === 0 ? 'Bulk Carrier' : n % 5 === 1 ? 'Tanker' : undefined,
        skill: n % 6 === 0 ? 'ECDIS' : undefined,
      }))
    }
    // Members nobody may ever be suggested.
    const never = [
      await member({ onboarded: false, location: 'Mumbai, India' }),
      await member({ status: 'suspended', location: 'Mumbai, India' }),
      await member({ status: 'deletion_requested', location: 'Mumbai, India' }),
      await member({ status: 'restricted', location: 'Mumbai, India' }),
      await member({ slug: false, location: 'Mumbai, India' }),
      await member({ organisation: true, location: 'Mumbai, India' }),
      await member({ profileType: 'company', location: 'Mumbai, India' }),
      await member({ name: 'Placeholder e2e test user', location: 'Mumbai, India' }),
    ]
    const loadTest = await member({ location: 'Mumbai, India', roleRank: 'Second Officer' })
    await db.query(`update public.profiles set is_load_test = true where id = $1`, [loadTest])
    never.push(loadTest)
    // A precomputed list for one viewer (a friend's connections), so stored rows and the top-up mix.
    const friend = await member()
    await connect(withStored, friend, 'accepted')
    for (const id of eligible.slice(0, 4)) await connect(friend, id, 'accepted')
    await createPeopleSuggestions({ candidates: candidates(), profiles: profiles() }).refreshForViewer(withStored)

    const kept = after()
    // 1. Cold, then warm: identical.
    expect(await shadow(viewers, kept)).toEqual({ lists: 20, identical: 20, entries: expect.any(Number) })
    const warm = await shadow(viewers, kept)
    expect(warm.identical).toBe(warm.lists)
    expect(warm.entries).toBeGreaterThan(200)

    // 2. While the top-ups are kept, members at the top of the lists become excluded in every way.
    const top = await ids(before(), viewers[0]!, 12)
    const [blocked, blocker, connected, requestedOut, requestedIn, followed, declined, dismissed, hidden, removed, flagged] = top
    const v = viewers[0]!
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [v, blocked])
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [blocker, v])
    await connect(v, connected!, 'accepted')
    await connect(v, requestedOut!, 'pending', v)
    await connect(v, requestedIn!, 'pending', requestedIn)
    await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2)`, [v, followed])
    await db.query(`insert into public.social_action_events (profile_id, action, target_profile_id) values ($1, 'connection_request', $2)`, [v, declined])
    await createSignalsRepository({ query }).dismissSuggestion(v, 'person', dismissed!)
    await createPrivacyPreferences({ query }).set(hidden!, 'showInPeopleSuggestions', false)
    await db.query(`update public.profiles set account_status = 'deletion_requested' where id = $1`, [removed])
    await db.query(`update public.profiles set is_load_test = true where id = $1`, [flagged])
    const excludedNow = [blocked, blocker, connected, requestedOut, requestedIn, followed, declined, dismissed, hidden, removed, flagged] as string[]
    clock += 60_000

    const changed = await shadow(viewers, kept)
    expect(changed.identical).toBe(changed.lists)
    for (const limit of LIMITS) {
      const shown = await ids(kept, v, limit)
      for (const id of [...excludedNow, ...never, v]) expect(shown).not.toContain(id)
      // The list still fills: the next eligible members take the freed places.
      expect(shown.length).toBe(Math.min(limit, (await ids(before(), v, limit)).length))
    }
    // Excluded for the other viewers too where the rule is theirs (blocks are both ways, removal and
    // load-test flags are global).
    for (const viewer of viewers.slice(1)) {
      const shown = await ids(kept, viewer, 40)
      for (const id of [removed, flagged, ...never]) expect(shown).not.toContain(id)
    }

    // 3. After 10 minutes the kept lists are scored afresh: still identical.
    clock += PEOPLE_TOP_UP_CACHE_MS
    const later = await shadow(viewers, kept)
    expect(later.identical).toBe(later.lists)
  })

  it('scores afresh when the kept top-up can no longer fill the list, so it still fills as before', async () => {
    const viewer = await member({ location: 'Visakhapatnam, India' })
    for (let n = 0; n < 15; n += 1) await member({ location: 'Visakhapatnam, India' })
    const kept = after()
    const first = await ids(kept, viewer, 3)
    expect(first.length).toBe(3)
    // Block every member the kept top-up holds (3 asked + 6 spare) but one.
    const held = await ids(before(), viewer, 9)
    for (const id of held.slice(0, 8)) await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [viewer, id])
    clock += 60_000
    const shown = await ids(kept, viewer, 3)
    expect(shown).toEqual(await ids(before(), viewer, 3))
    expect(shown.length).toBe(3)
    for (const id of held.slice(0, 8)) expect(shown).not.toContain(id)
  })

  it('a freshly joined member gets suggestions at once, without the nightly rebuild', async () => {
    await member({ location: 'Chennai, India', roleRank: 'Third Officer' })
    await member({ location: 'Chennai, India' })
    const joined = await member({ location: 'Chennai, India', roleRank: 'Third Officer' })
    expect((await db.query(`select count(*)::int as n from public.people_suggestions where viewer_id = $1`, [joined]))[0]!.n).toBe(0)
    const shown = await ids(after(), joined, 3)
    expect(shown.length).toBe(3)
    expect(shown).toEqual(await ids(before(), joined, 3))
  })

  it('a member who becomes eligible shows in a kept top-up within 10 minutes, and the raw query agrees', async () => {
    const viewer = await member({ location: 'Goa, India' })
    const kept = after()
    const first = await ids(kept, viewer, 40)
    const newcomer = await member({ location: 'Goa, India', roleRank: 'Master', vessel: 'Container Ship', skill: 'Ship handling' })
    clock += 60_000
    expect(await ids(kept, viewer, 40)).toEqual(first)
    clock += PEOPLE_TOP_UP_CACHE_MS
    expect(await ids(kept, viewer, 40)).toContain(newcomer)
    // The live query restricted to some ids returns exactly the full query's rows among those ids, in order.
    const lookup = { viewerProfileId: viewer, limit: 60, weights: RECOMMENDATION_WEIGHTS, declinedRequestWindow: DECLINED_REQUEST_SUGGESTION_WINDOW, roundG: true }
    const full = (await profiles().getPeopleSuggestions(lookup)).map((p) => p.id)
    const some = full.filter((_, n) => n % 2 === 0)
    const restricted = (await profiles().getPeopleSuggestions({ ...lookup, onlyIds: [...some, viewer] })).map((p) => p.id)
    expect(restricted).toEqual(some)
    expect(await profiles().getPeopleSuggestions({ ...lookup, onlyIds: [] })).toEqual([])
  })
})
