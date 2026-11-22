import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createCommunityAdminScope } from '@/features/community/admin-scope'
import { createCommunityRepository } from '@/features/community/repository'
import { createCommunityService } from '@/features/community/service'

/**
 * Round GP Part E (E5), against the real schema (PGlite, every migration): a group belongs to its owner
 * organization's country, or else its active owner member's country of residence; Admin › Communities lists only a
 * country admin's countries; edits and archiving are audited with who decided, the section and the country.
 * Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
let sequence = 0
const ids: Record<string, string> = {}

async function profile(residence: string | null) {
  sequence += 1
  return String((await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at, country_of_residence)
     values (gen_random_uuid(), 'Placeholder Member', $1, 'seafarer', 'Placeholder headline', 'Placeholder summary for a test member.', now(), $2) returning id`,
    [`placeholder-community-${sequence}`, residence],
  ))[0]!.id)
}

async function group(name: string, input: { ownerResidence?: string | null; companyCountry?: string | null }) {
  sequence += 1
  const owner = await profile(input.ownerResidence ?? null)
  const company = input.companyCountry === undefined ? null : String((await run(
    `insert into public.companies (slug, name, created_by, country) values ($1, 'Placeholder Org', $2, $3) returning id`,
    [`placeholder-community-org-${sequence}`, owner, input.companyCountry],
  ))[0]!.id)
  const id = String((await run(
    `insert into public.community_groups (name, slug, owner_company_id, created_by) values ($1, $2, $3, $4) returning id`,
    [name, `placeholder-group-${sequence}`, company, owner],
  ))[0]!.id)
  await run(`insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at) values ($1, $2, 'owner', 'active', now())`, [id, owner])
  return id
}

beforeAll(async () => {
  db = await createTestDatabase()
  ids.phMember = await group('Placeholder Manila Crew', { ownerResidence: 'PH' })
  ids.inMember = await group('Placeholder Kochi Crew', { ownerResidence: 'IN' })
  // An organization's group follows the organization, wherever its owner member lives.
  ids.phCompany = await group('Placeholder Org Crew', { ownerResidence: 'IN', companyCountry: 'PH' })
  ids.noCountry = await group('Placeholder Nowhere Crew', { ownerResidence: null })
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('Communities for country admins', () => {
  it('gives each group the right country', async () => {
    const countryOf = createCommunityAdminScope(run)
    expect(await countryOf(ids.phMember!)).toBe('PH')
    expect(await countryOf(ids.inMember!)).toBe('IN')
    expect(await countryOf(ids.phCompany!)).toBe('PH')
    expect(await countryOf(ids.noCountry!)).toBeNull()
  })

  it('lists only a country admin’s countries, and every group for platform administrators', async () => {
    const repository = createCommunityRepository({ query: run as never })
    expect((await repository.listAdminGroups({ countries: ['PH'] })).map((entry) => entry.id).sort()).toEqual([ids.phMember, ids.phCompany].sort())
    expect((await repository.listAdminGroups({ countries: ['PH'], search: 'manila' })).map((entry) => entry.id)).toEqual([ids.phMember])
    // Platform administrators: every group (the migrations seed some groups too).
    expect((await repository.listAdminGroups()).map((entry) => entry.id)).toEqual(expect.arrayContaining([ids.phMember, ids.inMember, ids.phCompany, ids.noCountry]))
  })

  it('records who decided, the section and the country on edits and archiving', async () => {
    const repository = createCommunityRepository({ query: run as never })
    const service = createCommunityService({ repository, categories: { canAssign: async () => true } })
    const actor = await profile('PH')
    const audit = { actorRole: 'country_admin', section: 'communities', country: 'PH' }
    await service.updateGroupAsAdmin(actor, ids.phMember!, { name: 'Placeholder Manila Crew', description: '', rules: '', visibility: 'public', joinPolicy: 'approval', icon: null }, audit)
    await service.archiveGroup(actor, ids.phMember!, audit)
    await service.unarchiveGroup(actor, ids.phMember!, audit)
    const rows = await run(`select action, metadata from public.audit_events where target_id = $1 order by id`, [ids.phMember])
    expect(rows.map((row) => row.action)).toEqual([
      'community.group_updated', 'community.join_policy_changed', 'community.group_archived', 'community.group_unarchived',
    ])
    for (const row of rows) expect(row.metadata).toMatchObject(audit)
  })
})
