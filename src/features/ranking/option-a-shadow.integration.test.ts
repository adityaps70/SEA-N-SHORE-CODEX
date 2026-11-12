import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { FEED_WEIGHTS } from './feed-weights'
import { candidateSql, mapCandidate } from './feed-candidates'
import { similarToSql } from './people-candidates'

/**
 * Round DB Option A (owner-approved 12 Nov) against the real schema (PGlite, every migration): a shadow comparison of
 * the feed candidate query and "People similar to" before and after their rewrites, over a placeholder community with
 * every rule the queries apply. "Before" is the previous SQL, rebuilt here from the new one with only the rewrite
 * undone; every viewer, mode and member gives the same rows, columns and order. Counts only; placeholder data.
 */
let db: TestDatabase
const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>

/** The feed candidate query as it was: the viewer's engagement with each author counted per row. */
const PREVIOUS_ENGAGEMENT = `(
      (select count(*) from public.post_reactions vr join public.posts vp on vp.id = vr.post_id
       where vr.user_id = $1 and vp.author_id = p.author_id and vr.created_at > now() - make_interval(days => $6))
      + (select count(*) from public.post_comments vc join public.posts vp on vp.id = vc.post_id
       where vc.author_id = $1 and vc.deleted_at is null and vp.author_id = p.author_id and vc.created_at > now() - make_interval(days => $6))
      + (select count(*) from public.messages vm
         join public.conversations conv on conv.id = vm.conversation_id
         where vm.sender_profile_id = $1 and conv.type = 'direct'
           and (conv.direct_user_low_id = p.author_id or conv.direct_user_high_id = p.author_id)
           and vm.created_at > now() - make_interval(days => $6))
    )::int as viewer_engagement_with_author,`

export function previousCandidateSql(mode: 'network' | 'explore') {
  const now = candidateSql(mode)
  const swapped = now
    .replace('coalesce(viewer_author.total, 0)::int as viewer_engagement_with_author,', PREVIOUS_ENGAGEMENT)
    .replace(/\n\s*-- One row per author \(grouped\), so this never adds rows\.\n\s*left join viewer_author_engagement viewer_author on viewer_author\.author_id = p\.author_id/, '')
  if (swapped === now || swapped.includes('viewer_author.')) throw new Error('the previous feed candidate query could not be rebuilt')
  return swapped
}

/** "People similar to" as it was: every member read. */
export function previousSimilarToSql() {
  const now = similarToSql()
  const swapped = now.replace(/from matches\n\s*join public\.profiles c on c\.id = matches\.id/, 'from public.profiles c')
  if (swapped === now) throw new Error('the previous similar-to query could not be rebuilt')
  return swapped
}

const ids: string[] = []
/** Members whose "similar to" list is compared: every ninth, and every one without a rank (only company or vessel group can match them). */
const SUBJECTS = () => ids.filter((_, n) => n % 9 === 0 || n % 8 === 7)
const RANKS = ['master', 'chief_officer', 'second_officer', 'third_officer', 'chief_engineer', 'second_engineer', 'electro_technical_officer', null]

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
  // Vessel types by name: a trigger derives vessel_type_codes from them.
  const vessels = (await db.query(`select name from public.vessel_types order by code`)).map((r) => String(r.name))
  const ranks = new Set((await db.query(`select code from public.maritime_ranks`)).map((r) => String(r.code)))
  // 240 members of every kind: ranks, departments, personas, companies, vessel types; some inactive, not onboarded,
  // without a slug, organisations, company profiles, load-test and synthetic accounts.
  const [creator] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Company Creator') returning id`)
  await db.query(`insert into public.companies (name, slug, created_by) select 'Placeholder Company ' || n, 'placeholder-company-' || n, $1 from generate_series(1, 4) n`, [creator!.id])
  const companies = (await db.query(`select id from public.companies order by slug`)).map((r) => String(r.id))
  for (let n = 0; n < 240; n += 1) {
    const rank = RANKS[n % RANKS.length]
    const [row] = await db.query(
      `insert into public.profiles (id, full_name, slug, onboarding_completed_at, profile_type, role_key, role_department_key, persona, location, headline,
                                    account_status, identity_root, primary_identity, primary_identity_family, is_load_test, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, case when $3 then now() end, $4::public.profile_type, $5, $6, $7, 'Placeholder City', 'Placeholder headline',
               $8::public.account_status, $9::text, case when $9::text is not null then 'Shipowner' end, case when $9::text is not null then 'Shipping & Ship Management' end,
               $10, now() - make_interval(days => $11), now() - make_interval(mins => $12)) returning id`,
      [n % 37 === 5 ? 'Placeholder e2e test user' : `Placeholder Mariner ${n}`, n % 41 === 7 ? null : `placeholder-mariner-${n}`, n % 29 !== 3,
        n % 31 === 4 ? 'company' : 'seafarer', rank && ranks.has(rank) ? rank : null, n % 2 ? 'deck' : 'engine', n % 9 === 0 ? 'student_cadet' : 'seafarer',
        n % 23 === 6 ? 'suspended' : n % 43 === 8 ? 'deletion_requested' : 'active', n % 47 === 9 ? 'organisation' : null, n % 53 === 10,
        n % 300, (n * 7) % 997],
    )
    ids.push(String(row!.id))
    await db.query(`insert into public.maritime_profiles (user_id, current_company_id, vessel_types) values ($1, $2, $3)`,
      [row!.id, n % 3 === 0 ? companies[n % companies.length] : null, n % 4 === 1 ? [] : [vessels[n % vessels.length], vessels[(n * 5) % vessels.length]]])
  }
  await db.query(`insert into public.member_preferences (profile_id, show_in_people_suggestions) select id, false from public.profiles where updated_at < now() - interval '15 hours' and updated_at > now() - interval '16 hours'`)
  // The graph: connections (accepted and pending), follows, organisation follows, groups (public and private), blocks
  // both ways, mutes, a recent declined request, dismissals.
  const pair = (a: number, b: number) => (ids[a]! < ids[b]! ? [ids[a]!, ids[b]!] : [ids[b]!, ids[a]!])
  for (let a = 0; a < 40; a += 1) {
    for (let k = 1; k <= 6; k += 1) {
      const b = (a * 11 + k * 17) % 240
      if (b === a) continue
      const [low, high] = pair(a, b)
      await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, $4::public.connection_status) on conflict do nothing`,
        [low, high, ids[a], k === 6 ? 'pending' : 'accepted'])
    }
    await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2) on conflict do nothing`, [ids[a], ids[(a * 13 + 3) % 240]])
    if (a % 5 === 0) await db.query(`insert into public.organization_follows (company_id, follower_id) values ($1, $2) on conflict do nothing`, [companies[a % 4], ids[a]])
    if (a % 7 === 1) await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`, [ids[a], ids[(a + 50) % 240]])
    if (a % 7 === 2) await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`, [ids[(a + 60) % 240], ids[a]])
    if (a % 6 === 3) await db.query(`insert into public.user_mutes (viewer_id, muted_profile_id) values ($1, $2)`, [ids[a], ids[(a + 70) % 240]])
    if (a % 8 === 4) await db.query(`insert into public.social_action_events (profile_id, action, target_profile_id) values ($1, 'connection_request', $2)`, [ids[a], ids[(a + 80) % 240]])
  }
  const groups: string[] = []
  for (const [n, visibility] of [[1, 'public'], [2, 'private'], [3, 'public']] as const) {
    const [g] = await db.query(`insert into public.community_groups (name, slug, visibility, created_by, archived_at) values ($1, $2, $3, $4, $5) returning id`,
      [`Placeholder Group ${n}`, `placeholder-group-${n}`, visibility, ids[0], n === 3 ? new Date() : null])
    groups.push(String(g!.id))
  }
  for (let a = 0; a < 40; a += 3) await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status) values ($1, $2, 'member', 'active') on conflict do nothing`, [groups[a % 2], ids[a]])
  // 900 posts over 40 days: in groups and companies, reposts, deleted ones; reactions and comments (some deleted, some
  // old); impressions, hides, feedback, reports; direct messages in and out of the engagement window.
  const posts: string[] = []
  for (let n = 0; n < 900; n += 1) {
    const repostOf = n % 13 === 12 && posts.length > 5 ? posts[(n * 3) % posts.length] : null
    const [p] = await db.query(
      `insert into public.posts (author_id, body, category, post_type, repost_of_post_id, group_id, company_id, created_at, deleted_at, deletion_reason, purge_after)
       values ($1, $2, $3, $4::public.post_type, $5, $6, $7, now() - make_interval(mins => $8), case when $9 then now() end,
               case when $9 then 'author_deleted' end, case when $9 then now() + interval '30 days' end) returning id`,
      [ids[(n * 7) % 240], n % 11 === 0 ? 'https://example.test/placeholder' : `Placeholder post ${n}`, n % 2 ? 'maritime_news' : 'career_advice',
        repostOf ? 'repost' : 'standard', repostOf, n % 17 === 4 ? groups[n % 3] : null, n % 19 === 6 ? companies[n % 4] : null, n * 61, n % 29 === 11],
    )
    posts.push(String(p!.id))
  }
  for (let n = 0; n < 2600; n += 1) {
    await db.query(`insert into public.post_reactions (post_id, user_id, reaction_type, created_at) values ($1, $2, 'like', now() - make_interval(days => $3)) on conflict do nothing`,
      [posts[(n * 31) % 900], ids[(n * 17) % 240], n % 70])
  }
  for (let n = 0; n < 900; n += 1) {
    await db.query(`insert into public.post_comments (post_id, author_id, body, created_at, deleted_at) values ($1, $2, 'Placeholder comment', now() - make_interval(days => $3), case when $4 then now() end)`,
      [posts[(n * 37) % 900], ids[(n * 13) % 240], n % 75, n % 23 === 0])
  }
  for (let a = 0; a < 40; a += 1) {
    for (let k = 0; k < 6; k += 1) {
      const b = (a * 19 + k * 23 + 1) % 240
      if (b === a) continue
      const [low, high] = pair(a, b)
      const [conv] = await db.query(`insert into public.conversations (direct_user_low_id, direct_user_high_id) values ($1, $2) on conflict do nothing returning id`, [low, high])
      if (!conv) continue
      for (let m = 0; m < 4; m += 1) {
        await db.query(`insert into public.messages (conversation_id, sender_profile_id, client_message_id, body, created_at) values ($1, $2, gen_random_uuid(), 'Placeholder', now() - make_interval(days => $3))`,
          [conv.id, m % 2 ? ids[a] : ids[b], (k * 17 + m * 11) % 90])
      }
    }
    await db.query(`insert into public.post_impressions (viewer_id, post_id) values ($1, $2) on conflict do nothing`, [ids[a], posts[(a * 7) % 900]])
    if (a % 4 === 0) await db.query(`insert into public.post_hides (user_id, post_id) values ($1, $2) on conflict do nothing`, [ids[a], posts[(a * 9 + 1) % 900]])
    if (a % 5 === 1) await db.query(`insert into public.feed_feedback (viewer_id, post_id, kind, author_id) values ($1, $2, 'show_less', $3) on conflict do nothing`, [ids[a], posts[(a * 11 + 2) % 900], ids[(a * 7 + 7) % 240]])
    if (a % 9 === 2) await db.query(`insert into public.content_reports (target_type, target_id, reporter_id, reason, status) values ('post', $1, $2, 'spam', 'open')`, [posts[(a * 5) % 900], ids[a]])
  }
  await db.query(`analyze`)
}, 600_000)

afterAll(async () => {
  await db?.close()
})

describe('Option A shadow comparison (previous SQL vs rewritten SQL)', () => {
  it('the feed candidate query gives every viewer the same candidates, columns and order, in both modes', async () => {
    const counts = { lists: 0, identical: 0, rows: 0, withEngagement: 0 }
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    for (const viewer of ids.slice(0, 40)) {
      for (const mode of ['network', 'explore'] as const) {
        const values = [viewer, since, [], FEED_WEIGHTS.candidates.maxCandidates, FEED_WEIGHTS.candidates.ownPostPinMinutes, FEED_WEIGHTS.relationship.recentEngagementDays]
        const was = (await query(previousCandidateSql(mode), values)).map(mapCandidate)
        const now = (await query(candidateSql(mode), values)).map(mapCandidate)
        counts.lists += 1
        counts.rows += was.length
        counts.withEngagement += was.filter((row) => row.viewerEngagementWithAuthor > 0).length
        if (JSON.stringify(was) === JSON.stringify(now)) counts.identical += 1
        else expect(now).toEqual(was)
      }
    }
    expect(counts.identical).toBe(counts.lists)
    expect(counts.lists).toBe(80)
    // The comparison is not trivial: many candidates, and many with the viewer's engagement counted.
    expect(counts.rows).toBeGreaterThan(2000)
    expect(counts.withEngagement).toBeGreaterThan(100)
  }, 600_000)

  it('"People similar to" gives every viewer and member the same people in the same order', async () => {
    const counts = { lists: 0, identical: 0, rows: 0 }
    for (const viewer of ids.slice(0, 30)) {
      for (const subject of SUBJECTS()) {
        const was = (await query(previousSimilarToSql(), [viewer, subject, 8])).map((r) => String(r.id))
        const now = (await query(similarToSql(), [viewer, subject, 8])).map((r) => String(r.id))
        counts.lists += 1
        counts.rows += was.length
        if (JSON.stringify(was) === JSON.stringify(now)) counts.identical += 1
        else expect(now).toEqual(was)
      }
    }
    expect(counts.identical).toBe(counts.lists)
    expect(counts.lists).toBe(30 * SUBJECTS().length)
    expect(counts.rows).toBeGreaterThan(3000)
    // Members do carry vessel type codes (the trigger derived them).
    expect((await query(`select count(*)::int as n from public.maritime_profiles where cardinality(vessel_type_codes) > 0`))[0]!.n).toBeGreaterThan(100)
    // Each way of matching (rank band, company, vessel group) decides some lists here, so the comparison covers all
    // three: without any one of them, some list comes out different.
    const branches = [
      'where p.role_key = any(s.rank_band)',
      'where s.current_company_id is not null and mp.current_company_id = s.current_company_id',
      'where cardinality(sc.group_codes) > 0 and mp.vessel_type_codes && sc.group_codes',
    ]
    for (const branch of branches) {
      // That branch matches nobody.
      const without = similarToSql().replace(branch, 'where false')
      expect(without).not.toBe(similarToSql())
      let differs = 0
      for (const viewer of ids.slice(0, 30)) {
        for (const subject of SUBJECTS()) {
          const full = (await query(similarToSql(), [viewer, subject, 8])).map((r) => String(r.id))
          const partial = (await query(without, [viewer, subject, 8])).map((r) => String(r.id))
          if (JSON.stringify(full) !== JSON.stringify(partial)) differs += 1
        }
        if (differs) break
      }
      expect(differs, `branch ${branches.indexOf(branch)}`).toBeGreaterThan(0)
    }
  }, 600_000)
})
