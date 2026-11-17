import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { CANDIDATE_SQL } from './people-candidates'

/**
 * Finding 7 (owner-approved, ₹0) against the real schema (PGlite, every migration including 0106): the
 * people-you-may-know candidate build reads each candidate's latest impression through the new
 * (viewer_id, last_seen_at desc) index, never by walking the global last_seen_at index backwards. Without 0106 the
 * build read 28 million buffers in a 3,000-member test community; with it about 6,500. Placeholder data only.
 */
let db: TestDatabase
const LATEST_IMPRESSION = 'coalesce((select max(i2.last_seen_at) from public.post_impressions i2 where i2.viewer_id = c.id), c.updated_at),'

type PlanNode = { 'Index Name'?: string; 'Relation Name'?: string; 'Node Type': string; Plans?: PlanNode[] }
function indexesUsed(node: PlanNode, out = new Set<string>()) {
  if (node['Relation Name'] === 'post_impressions') out.add(node['Index Name'] ?? node['Node Type'])
  for (const child of node.Plans ?? []) indexesUsed(child, out)
  return out
}

beforeAll(async () => {
  db = await createTestDatabase()
  const q = (text: string, values?: readonly unknown[]) => db.query(text, values)
  const members = 160
  await q(`create table shadow_ids as select n, gen_random_uuid() as id from generate_series(0, ${members - 1}) n`)
  // Members of every kind: departments, cities, academies; some inactive, not onboarded, without a slug, company profiles.
  await q(`insert into public.profiles (id, full_name, slug, onboarding_completed_at, profile_type, role_department_key, persona, location,
                                        institution_name, headline, account_status, created_at, updated_at)
           select id, 'Placeholder Member ' || n, case when n % 41 = 7 then null else 'placeholder-member-' || n end,
                  case when n % 29 = 3 or n % 41 = 7 then null else now() end,
                  case when n % 29 = 3 then null when n % 31 = 4 then 'company'::public.profile_type else 'seafarer'::public.profile_type end,
                  case when n % 2 = 0 then 'deck' else 'engine' end, case when n % 9 = 0 then 'student_cadet' else 'seafarer' end,
                  'Placeholder City ' || (n % 7), 'Placeholder Academy ' || (n % 5), 'Placeholder headline',
                  case when n % 23 = 6 then 'suspended'::public.account_status else 'active'::public.account_status end,
                  now() - make_interval(days => n % 300), now() - make_interval(hours => n * 3)
           from shadow_ids`)
  const vessels = (await q(`select name from public.vessel_types order by code`)).map((r) => String(r.name))
  await q(`insert into public.maritime_profiles (user_id, vessel_types) select id, array[$1::text] from shadow_ids where n % 3 <> 1`, [vessels[0]])
  await q(`insert into public.connections (user_low_id, user_high_id, requested_by, status)
           select least(a.id, b.id), greatest(a.id, b.id), a.id, case when k = 4 then 'pending' else 'accepted' end::public.connection_status
           from shadow_ids a cross join generate_series(1, 4) k join shadow_ids b on b.n = (a.n * 3 + k * 17) % ${members}
           where a.n <> b.n on conflict do nothing`)
  await q(`insert into public.profile_experiences (profile_id, track, title, organization, vessel, started_on, ended_on)
           select id, 'sea_service', 'Officer', 'Placeholder Company ' || ((n + k) % 9), 'MV Placeholder ' || ((n * k) % 25),
                  date '2021-01-01' + ((n * k) % 700), date '2021-01-01' + ((n * k) % 700) + 200
           from shadow_ids cross join generate_series(1, 2) k`)
  await q(`create table shadow_posts as select gen_random_uuid() as id, n from generate_series(0, 399) n`)
  await q(`insert into public.posts (id, author_id, body, category, post_type, created_at, deleted_at, deletion_reason, purge_after)
           select p.id, b.id, 'Placeholder post', 'career_advice', 'standard'::public.post_type, now() - make_interval(hours => p.n * 5),
                  case when p.n % 17 = 3 then now() end, case when p.n % 17 = 3 then 'author_deleted' end,
                  case when p.n % 17 = 3 then now() + interval '30 days' end
           from shadow_posts p join shadow_ids b on b.n = (p.n * 13) % ${members}`)
  // Impressions for two members in three, at varied times (the rest have none: the case the old plan scanned for).
  await q(`insert into public.post_impressions (viewer_id, post_id, first_seen_at, last_seen_at)
           select b.id, p.id, now() - make_interval(days => (b.n + k) % 40), now() - make_interval(hours => (b.n * k) % 900)
           from shadow_ids b cross join generate_series(1, 12) k join shadow_posts p on p.n = (b.n * 7 + k * 31) % 400
           where b.n % 3 <> 0 on conflict do nothing`)
  await q(`insert into public.user_blocks (blocker_id, blocked_id) select a.id, b.id from shadow_ids a join shadow_ids b on b.n = (a.n + 50) % ${members} where a.n % 11 = 1`)
  await q(`analyze`)
}, 600_000)

afterAll(async () => { await db?.close?.() })

describe('people-you-may-know candidate build with migration 0106', () => {
  it('still reads each candidate\'s latest impression with the same correlated max()', () => {
    expect(CANDIDATE_SQL).toContain(LATEST_IMPRESSION)
  })

  it('migration 0106 leaves a valid (viewer_id, last_seen_at desc) index on post_impressions', async () => {
    const [index] = await db.query(`
      select i.indisvalid as valid, pg_get_indexdef(i.indexrelid) as definition
      from pg_index i join pg_class c on c.oid = i.indexrelid
      where c.relname = 'post_impressions_viewer_last_seen_idx'`)
    expect(index?.valid).toBe(true)
    expect(String(index?.definition)).toContain('(viewer_id, last_seen_at DESC)')
  })

  it('reads impressions through the new index, never the global last_seen_at index', async () => {
    const viewers = (await db.query(`select id from shadow_ids where n in (0, 1, 2, 40, 81) order by n`)).map((r) => String(r.id))
    for (const viewer of viewers) {
      const [row] = await db.query(`explain (format json) ${CANDIDATE_SQL}`, [viewer, 200])
      const used = indexesUsed((row!['QUERY PLAN'] as Array<{ Plan: PlanNode }>)[0]!.Plan)
      expect(used.has('post_impressions_viewer_last_seen_idx')).toBe(true)
      expect(used.has('post_impressions_last_seen_idx')).toBe(false)
    }
  })

  it('returns candidates whose latest activity is an impression', async () => {
    const viewer = String((await db.query(`select id from shadow_ids where n = 1`))[0]!.id)
    const rows = await db.query(CANDIDATE_SQL, [viewer, 200])
    expect(rows.length).toBeGreaterThan(20)
    const [impressionLed] = await db.query(`
      select count(*)::int as count from public.profiles p
      where (select max(i.last_seen_at) from public.post_impressions i where i.viewer_id = p.id)
            > greatest(p.updated_at + interval '1 day', coalesce((select max(lp.created_at) from public.posts lp where lp.author_id = p.id and lp.deleted_at is null), p.updated_at) + interval '1 day')`)
    expect(Number(impressionLed!.count)).toBeGreaterThan(10)
  })
})
