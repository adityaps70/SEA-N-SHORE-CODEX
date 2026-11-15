import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAdminRanksRepository } from './admin-ranks-repository'
import { createRoleCatalogLoader } from './catalog-server'
import { isAcceptableJobRoleKey } from './job-role-input'
import { ladderDistance, roleByKey, rolesFor, setAddedRoles } from './taxonomy'

/**
 * P6b (owner-approved 15 Nov), against the real schema (PGlite with every migration, including 0105): administrators
 * add a missing rank to public.maritime_ranks, it reaches the live rank list, and the feed and people-you-may-know
 * rank bands (public.maritime_rank_steps) count it as the step between its neighbours. Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const repository = () => createAdminRanksRepository({
  query: ((text: string, values?: readonly unknown[]) => run(text, values)) as never,
  transaction: async (work) => work(((text: string, values?: readonly unknown[]) => run(text, values)) as never),
})
let adminId = ''

beforeAll(async () => {
  db = await createTestDatabase()
  const rows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Admin') returning id`)
  adminId = String(rows[0]!.id)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

afterEach(() => setAddedRoles([]))

async function loadCatalog() {
  await createRoleCatalogLoader({ query: (text, values) => run(text, values) }).reload()
}

describe('P6b admin ranks (migration 0105)', () => {
  it('for the seeded ranks a step difference equals the ladder_level difference, so today\'s rank bands are unchanged', async () => {
    const rows = await run(`select r.code, r.department_key, r.ladder, r.ladder_level, s.step
      from public.maritime_ranks r join public.maritime_rank_steps s using (code)`)
    expect(rows.length).toBeGreaterThan(80)
    const byLadder = new Map<string, Row[]>()
    for (const row of rows) byLadder.set(`${row.department_key}|${row.ladder}`, [...(byLadder.get(`${row.department_key}|${row.ladder}`) ?? []), row])
    for (const [ladder, members] of byLadder) {
      for (const a of members) for (const b of members) {
        expect(Number(a.step) - Number(b.step), `${ladder} ${a.code} ${b.code}`).toBe(Number(a.ladder_level) - Number(b.ladder_level))
      }
    }
  })

  it('adds a rank between two others; it reaches validation, pickers and matching, and the rank bands', async () => {
    const result = await repository().addRank(adminId, {
      label: 'Junior ETO', departmentKey: 'engine_officers', anchorKey: 'eto', relation: 'below', synonyms: ['Assistant ETO'],
    })
    expect(result).toEqual({ status: 'added', code: 'added_junior_eto' })
    const [row] = await run(`select name, department, ladder, ladder_level, position::text, source, anchor_code, anchor_relation, added_by, sort_order
      from public.maritime_ranks where code = 'added_junior_eto'`)
    expect(row).toMatchObject({ name: 'Junior ETO', department: 'electrical', ladder: 'electrical_officer', position: '1.5000', source: 'admin', anchor_code: 'eto', anchor_relation: 'below', added_by: adminId })
    expect(Number(row!.sort_order)).toBeGreaterThan(1000)

    const steps = await run(`select code, step from public.maritime_rank_steps where ladder = 'electrical_officer' and department_key = 'engine_officers' order by step`)
    expect(steps.map((s) => [s.code, Number(s.step)])).toEqual([['eto', 1], ['added_junior_eto', 2], ['electrical_officer', 3]])
    // The feed / people-you-may-know band (same shape as feed-candidates RANK_BAND_SQL): ETO's band now holds the
    // added rank, and no longer the Electrical Officer two steps away.
    const band = await run(`select coalesce(array_agg(r.code order by r.code), '{}'::text[]) as band
      from public.maritime_rank_steps vr
      join public.maritime_rank_steps r on r.ladder = vr.ladder and r.department_key = vr.department_key and abs(r.step - vr.step) <= 1
      where vr.code = 'eto'`)
    expect(band[0]!.band).toEqual(['added_junior_eto', 'eto'])

    expect(roleByKey('added_junior_eto')).toBeUndefined()
    await loadCatalog()
    expect(roleByKey('added_junior_eto')?.label).toBe('Junior ETO')
    expect(isAcceptableJobRoleKey('engine_officers', 'added_junior_eto')).toBe(true)
    expect(rolesFor('engine_officers').map((role) => role.key)).toContain('added_junior_eto')
    expect(ladderDistance('electrical_officer', 'eto')).toBe(2)

    const audit = await run(`select actor_id, target_id, metadata from public.audit_events where action = 'admin.rank_added'`)
    expect(audit).toEqual([{ actor_id: adminId, target_id: 'added_junior_eto', metadata: { department_key: 'engine_officers', anchor_code: 'eto', relation: 'below' } }])
  })

  it('refuses a duplicate, including one added on another server since this one last loaded', async () => {
    expect(await repository().addRank(adminId, { label: 'Chief Mate', departmentKey: 'deck_officers', anchorKey: 'chief_officer', relation: 'same' }))
      .toEqual({ status: 'error', error: 'duplicate' })
    // Not yet loaded here (another server added it), but the database check catches it.
    setAddedRoles([])
    expect(await repository().addRank(adminId, { label: 'Assistant ETO', departmentKey: 'engine_officers', anchorKey: 'eto', relation: 'same' }))
      .toEqual({ status: 'error', error: 'duplicate' })
  })

  it('a rank at the same level shares its anchor\'s step, and codes are never reused', async () => {
    const first = await repository().addRank(adminId, { label: 'GP Rating', departmentKey: 'deck_ratings', anchorKey: 'able_seaman', relation: 'same' })
    expect(first).toEqual({ status: 'added', code: 'added_gp_rating' })
    const steps = await run(`select code, step from public.maritime_rank_steps where code in ('able_seaman', 'added_gp_rating', 'ordinary_seaman') order by code`)
    expect(Object.fromEntries(steps.map((s) => [s.code, Number(s.step)]))).toEqual({ able_seaman: 3, added_gp_rating: 3, ordinary_seaman: 4 })
    // A later rank whose name gives the same code gets its own.
    await run(`update public.maritime_ranks set name = 'General Purpose Seaman' where code = 'added_gp_rating'`)
    expect(await repository().addRank(adminId, { label: 'GP-Rating', departmentKey: 'deck_ratings', anchorKey: 'bosun', relation: 'below' }))
      .toEqual({ status: 'added', code: 'added_gp_rating_2' })
  })

  it('hides and shows an added rank (pickers only), with audit events; seeded ranks cannot be hidden', async () => {
    const ranks = repository()
    expect(await ranks.setHidden(adminId, 'added_junior_eto', true)).toBe(true)
    expect(await ranks.setHidden(adminId, 'added_junior_eto', true)).toBe(false)
    expect(await ranks.setHidden(adminId, 'chief_engineer', true)).toBe(false)
    await loadCatalog()
    expect(rolesFor('engine_officers').map((role) => role.key)).not.toContain('added_junior_eto')
    expect(roleByKey('added_junior_eto')?.hidden).toBe(true)
    expect(isAcceptableJobRoleKey('engine_officers', 'added_junior_eto')).toBe(true)
    expect(await ranks.setHidden(adminId, 'added_junior_eto', false)).toBe(true)
    const audit = await run(`select action from public.audit_events where target_id = 'added_junior_eto' and action like 'admin.rank_%' order by id`)
    expect(audit.map((row) => row.action)).toEqual(['admin.rank_added', 'admin.rank_hidden', 'admin.rank_shown'])
    // The database refuses hiding a seeded rank even without the app.
    await expect(run(`update public.maritime_ranks set hidden_at = now() where code = 'chief_engineer'`)).rejects.toThrow()
  })

  it('counts where each added rank is used (profiles and jobs, counts only)', async () => {
    await run(`update public.profiles set role_key = 'added_junior_eto' where id = $1`, [adminId])
    const usage = await repository().usage()
    expect(usage.find((row) => row.code === 'added_junior_eto')).toEqual({ code: 'added_junior_eto', profiles: 1, jobs: 0 })
  })
})
