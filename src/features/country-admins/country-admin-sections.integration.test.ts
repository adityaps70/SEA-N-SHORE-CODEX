import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAdminRepository } from '@/features/admin/repository'
import { createAdminCountryRepository } from '@/features/countries/admin-country-repository'
import { createOrganizationRepository } from '@/features/organizations/repository'
import { organizationApplicationSchema } from '@/features/organizations/schemas'
import { createAdminOverviewRepository } from './overview-repository'
import { createCountryAdminRepository, CountryAdminError } from './repository'
import { loadCountryAdminAccess, resetPermissionsTableCheck, resolveSectionScope } from './scope'

/**
 * Round GP Part E (E1), against the real schema (PGlite, every migration including 0113): a new country admin starts
 * with Organizations only, a platform administrator chooses sections as View or Act, every section is checked in SQL,
 * decisions are audited with the section and country, and the Overview counts only the admin's countries (platform
 * administrators also see what has no country). Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const transaction = async <T,>(work: (query: typeof run) => Promise<T>) => db.transaction((query) => work(query as typeof run))
const ready = async () => true

let platformAdmin = ''
let partner = ''
let applicant = ''

async function profile(name: string, slug: string) {
  return String((await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at)
     values (gen_random_uuid(), $1, $2, 'seafarer', 'Placeholder headline', 'Placeholder summary for a test member.', now())
     returning id`,
    [name, slug],
  ))[0]!.id)
}

const application = (overrides: Record<string, unknown> = {}) => organizationApplicationSchema.parse({
  organizationName: 'Placeholder Harbour Crew', organizationType: 'union', website: null,
  officialEmail: 'office@placeholder.example', officeLocation: 'Manila, Philippines', country: 'PH',
  description: 'A placeholder organization used only in this test.', fleetSummary: null, vesselTypes: [],
  applicantRole: 'Secretary', registrationReference: null, supportingNotes: null, ...overrides,
})

const countryAdmins = () => createCountryAdminRepository({ query: run, transaction })
const admin = () => createAdminRepository({ query: run, transaction, countrySchemaReady: ready })

beforeAll(async () => {
  db = await createTestDatabase()
  platformAdmin = await profile('Placeholder Admin', 'placeholder-admin')
  await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [platformAdmin])
  partner = await profile('Placeholder Partner', 'placeholder-partner')
  applicant = await profile('Placeholder Applicant', 'placeholder-applicant')
}, 120_000)

beforeEach(() => resetPermissionsTableCheck())

afterAll(async () => {
  await db?.close()
})

describe('country admin sections', () => {
  it('starts a new country admin with Organizations (act) only', async () => {
    const result = await countryAdmins().grant(platformAdmin, partner, ['PH'])
    expect(result.permissions).toEqual({ organizations: 'act' })
    expect(await loadCountryAdminAccess(run, partner)).toEqual({ countries: ['PH'], permissions: { organizations: 'act' } })
    await expect(resolveSectionScope(run, partner, 'organizations', 'act')).resolves.toEqual({ kind: 'country', countries: ['PH'], level: 'act' })
    await expect(resolveSectionScope(run, partner, 'members', 'view')).rejects.toThrow('admin_forbidden')
    await expect(resolveSectionScope(run, partner, 'overview', 'view')).rejects.toThrow('admin_forbidden')
    await expect(resolveSectionScope(run, platformAdmin, 'learning', 'act')).resolves.toEqual({ kind: 'platform' })
  })

  it('saves the ticked sections, makes view-only sections view, and audits the change', async () => {
    const result = await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'view', members: 'act', overview: 'view' })
    expect(result).toMatchObject({ permissions: { organizations: 'view', members: 'view', overview: 'view' }, previousPermissions: { organizations: 'act' } })
    expect((await countryAdmins().list(platformAdmin))[0]!.permissions).toEqual({ organizations: 'view', members: 'view', overview: 'view' })
    await expect(resolveSectionScope(run, partner, 'organizations', 'view')).resolves.toMatchObject({ level: 'view' })
    await expect(resolveSectionScope(run, partner, 'organizations', 'act')).rejects.toThrow('admin_forbidden')

    const [audit] = await run(
      `select metadata from public.audit_events where target_id = $1 and action = 'country_admin.updated' order by created_at desc, id desc limit 1`,
      [partner],
    )
    expect(audit!.metadata).toMatchObject({
      section: 'country_admins', actorRole: 'platform_admin', country: null,
      permissions: { organizations: 'view', members: 'view', overview: 'view' }, previousPermissions: { organizations: 'act' },
    })
  })

  it('never saves a section that is not live yet, and refuses an empty choice', async () => {
    const result = await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', communities: 'act' })
    expect(result.permissions).toEqual({ organizations: 'act' })
    await expect(countryAdmins().grant(platformAdmin, partner, ['PH'], { communities: 'act' })).rejects.toBeInstanceOf(CountryAdminError)
    await expect(countryAdmins().grant(partner, partner, ['PH'], { organizations: 'act' })).rejects.toThrow('admin_forbidden')
  })

  it('lets a view-only country admin read organization reviews but not decide them; deciding is audited with the section', async () => {
    const { applicationId } = await createOrganizationRepository({ query: run, transaction, countrySchemaReady: ready })
      .submitOrganizationApplication(applicant, application())
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'view' })
    expect(await admin().getOrganizationApplicationReview(partner, applicationId)).toMatchObject({ applicationId })
    await expect(admin().reviewOrganizationApplication(partner, applicationId, 'approved', null)).rejects.toThrow('admin_forbidden')

    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act' })
    await admin().reviewOrganizationApplication(partner, applicationId, 'approved', null)
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'organization.approved'`, [applicationId])
    expect(audit!.metadata).toMatchObject({ section: 'organizations', actorRole: 'country_admin', country: 'PH' })
  })

  it('lets Members by country in only with that section', async () => {
    const countries = createAdminCountryRepository({ query: run, countrySchemaReady: ready })
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act' })
    await expect(countries.listCountryStats(partner)).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', members: 'view' })
    expect((await countries.listCountryStats(partner)).every((row) => row.code === 'PH')).toBe(true)
  })

  it('counts the Overview for the admin’s countries only, and shows platform administrators what has no country', async () => {
    const organizations = createOrganizationRepository({ query: run, transaction, countrySchemaReady: ready })
    await organizations.submitOrganizationApplication(applicant, application({ organizationName: 'Placeholder Cebu Port' }))
    await organizations.submitOrganizationApplication(applicant, application({ organizationName: 'Placeholder Kochi Crew', country: 'IN', officeLocation: 'Kochi, India' }))
    const unknown = await organizations.submitOrganizationApplication(applicant, application({ organizationName: 'Placeholder Nowhere Crew' }))
    await run(`update public.companies set country = null where id = $1`, [unknown.companyId])

    const overview = createAdminOverviewRepository({ query: run, cacheTtlMs: 5_000 })
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act' })
    await expect(overview.countsForCountryAdmin(partner)).rejects.toThrow('admin_forbidden')

    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', overview: 'view' })
    const mine = await overview.countsForCountryAdmin(partner)
    expect(mine.countries).toEqual(['PH'])
    expect(mine.counts.pendingOrganizations).toBe(1)
    expect((await overview.countsWithoutCountry(platformAdmin)).pendingOrganizations).toBe(1)
    await expect(overview.countsWithoutCountry(partner)).rejects.toThrow('admin_forbidden')
  })

  it('removing the role removes every section with it', async () => {
    await countryAdmins().remove(platformAdmin, partner)
    expect(await run(`select 1 from public.country_admin_permissions where profile_id = $1`, [partner])).toEqual([])
    await expect(resolveSectionScope(run, partner, 'organizations', 'view')).rejects.toThrow('admin_forbidden')
  })
})

describe('before and after migration 0113', () => {
  let before: TestDatabase
  const runBefore = (text: string, values?: readonly unknown[]) => before.query(text, values ? [...values] : undefined) as Promise<Row[]>

  beforeAll(async () => {
    before = await createTestDatabase({ skipMigrations: ['0113_country_admin_permissions.sql'] })
  }, 120_000)

  afterAll(async () => {
    await before?.close()
  })

  it('keeps every existing country admin on Organizations (act) and Members by country, before and after the backfill', async () => {
    resetPermissionsTableCheck()
    const id = String((await runBefore(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Partner') returning id`))[0]!.id)
    await runBefore(`insert into public.country_admins (profile_id, countries) values ($1, array['PH'])`, [id])
    expect(await loadCountryAdminAccess(runBefore, id)).toEqual({ countries: ['PH'], permissions: { organizations: 'act', members: 'view' } })
    await expect(resolveSectionScope(runBefore, id, 'overview', 'view')).rejects.toThrow('admin_forbidden')

    for (const statement of readFileSync('infra/aws/database/migrations/0113_country_admin_permissions.sql', 'utf8').split('-- statement-breakpoint')) {
      if (statement.trim()) await before.query(statement)
    }
    resetPermissionsTableCheck()
    expect(await loadCountryAdminAccess(runBefore, id)).toEqual({ countries: ['PH'], permissions: { organizations: 'act', members: 'view' } })
    // Running it again changes nothing.
    for (const statement of readFileSync('infra/aws/database/migrations/0113_country_admin_permissions.sql', 'utf8').split('-- statement-breakpoint')) {
      if (statement.trim()) await before.query(statement)
    }
    expect(await runBefore(`select count(*)::int as n from public.country_admin_permissions where profile_id = $1`, [id])).toEqual([{ n: 2 }])
  })
})
