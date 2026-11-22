import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAdminRepository } from '@/features/admin/repository'
import { createAdminCountryRepository } from '@/features/countries/admin-country-repository'
import { createOrganizationRepository } from '@/features/organizations/repository'
import { organizationApplicationSchema } from '@/features/organizations/schemas'
import { createCountryAdminRepository, CountryAdminError } from './repository'

/**
 * Round GP (Global Partners), Part C, against the real schema (PGlite with every migration, 0109 and 0110 included):
 * a Philippines country admin reviews Philippine organizations only, cannot use any platform admin repository, every
 * decision is audited with the country and the role, and the applicant's in-app notice and email are queued in the
 * same transaction. Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const transaction = async <T,>(work: (query: typeof run) => Promise<T>) => db.transaction((query) => work(query as typeof run))
const ready = async () => true

let platformAdmin = ''
let countryAdmin = ''
let applicant = ''
let otherMember = ''

async function profile(name: string, slug: string) {
  return String((await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at)
     values (gen_random_uuid(), $1, $2, 'seafarer', 'Placeholder headline', 'Placeholder summary for a test member.', now())
     returning id`,
    [name, slug],
  ))[0]!.id)
}

const application = (overrides: Record<string, unknown> = {}) => organizationApplicationSchema.parse({
  organizationName: 'Placeholder Harbour Crew',
  organizationType: 'union',
  website: null,
  officialEmail: 'office@placeholder.example',
  officeLocation: 'Manila, Philippines',
  country: 'PH',
  description: 'A placeholder organization used only in this test.',
  fleetSummary: null,
  vesselTypes: [],
  applicantRole: 'Secretary',
  registrationReference: null,
  supportingNotes: null,
  ...overrides,
})

const admin = () => createAdminRepository({ query: run, transaction, countrySchemaReady: ready })
const countryAdmins = () => createCountryAdminRepository({ query: run, transaction })
const organizations = () => createOrganizationRepository({ query: run, transaction, countrySchemaReady: ready })

beforeAll(async () => {
  db = await createTestDatabase()
  platformAdmin = await profile('Placeholder Admin', 'placeholder-admin')
  await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [platformAdmin])
  countryAdmin = await profile('Placeholder Partner', 'placeholder-partner')
  await run(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified)
     values ($1, 'cognito', 'placeholder-partner-subject', 'partner@placeholder.example', true)`,
    [countryAdmin],
  )
  applicant = await profile('Placeholder Applicant', 'placeholder-applicant')
  otherMember = await profile('Placeholder Other', 'placeholder-other')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('managing country admins (platform administrators only)', () => {
  it('finds a member by exact username or sign-in email only, never by a partial match', async () => {
    const repository = countryAdmins()
    expect(await repository.findMember(platformAdmin, '@placeholder-partner')).toMatchObject({ id: countryAdmin, isPlatformAdministrator: false, countries: null })
    expect(await repository.findMember(platformAdmin, 'Partner@Placeholder.example')).toMatchObject({ id: countryAdmin })
    expect(await repository.findMember(platformAdmin, 'placeholder')).toBeNull()
    expect(await repository.findMember(platformAdmin, 'placeholder-admin')).toMatchObject({ isPlatformAdministrator: true })
    await expect(repository.findMember(otherMember, 'placeholder-partner')).rejects.toThrow('admin_forbidden')
  })

  it('grants, changes and removes the role, auditing each step, and refuses platform administrators', async () => {
    const repository = countryAdmins()
    await expect(repository.grant(platformAdmin, platformAdmin, ['PH'])).rejects.toThrow('member_is_platform_admin')
    await expect(repository.grant(platformAdmin, otherMember, [])).rejects.toBeInstanceOf(CountryAdminError)
    await expect(repository.grant(platformAdmin, otherMember, ['XX'])).rejects.toThrow('countries_invalid')
    await expect(repository.grant(otherMember, otherMember, ['PH'])).rejects.toThrow('admin_forbidden')

    expect(await repository.grant(platformAdmin, otherMember, ['in', 'PH', 'PH'])).toEqual({ countries: ['IN', 'PH'], previousCountries: [], permissions: { organizations: 'act' }, previousPermissions: {} })
    expect(await repository.grant(platformAdmin, otherMember, ['SG'])).toEqual({ countries: ['SG'], previousCountries: ['IN', 'PH'], permissions: { organizations: 'act' }, previousPermissions: { organizations: 'act' } })
    expect(await repository.getCountries(otherMember)).toEqual(['SG'])
    expect(await repository.remove(platformAdmin, otherMember)).toBe(true)
    expect(await repository.getCountries(otherMember)).toBeNull()
    await expect(repository.remove(platformAdmin, otherMember)).rejects.toThrow('not_a_country_admin')

    const audit = await run(`select action, metadata from public.audit_events where target_id = $1 and action like 'country_admin.%' order by created_at, action`, [otherMember])
    expect(audit.map((row) => row.action)).toEqual(['country_admin.granted', 'country_admin.updated', 'country_admin.removed'])
    expect(audit[2]!.metadata).toEqual({ previousCountries: ['SG'], actorRole: 'platform_admin', section: 'country_admins', country: null })
    // Never a platform role.
    expect(await run(`select 1 from public.user_roles where user_id = $1`, [otherMember])).toEqual([])
  })

  it('makes the partner a Philippines country admin and lists them for platform administrators only', async () => {
    const repository = countryAdmins()
    await repository.grant(platformAdmin, countryAdmin, ['PH'])
    expect((await repository.list(platformAdmin)).map((entry) => [entry.profileId, entry.countries])).toEqual([[countryAdmin, ['PH']]])
    await expect(repository.list(countryAdmin)).rejects.toThrow('admin_forbidden')
    await repository.touchActive(countryAdmin)
    expect((await repository.list(platformAdmin))[0]!.lastActiveAt).not.toBeNull()
  })
})

describe('a Philippines country admin', () => {
  let philippine = { companyId: '', applicationId: '' }
  let indian = { companyId: '', applicationId: '' }

  beforeAll(async () => {
    philippine = await organizations().submitOrganizationApplication(applicant, application())
    indian = await organizations().submitOrganizationApplication(applicant, application({
      organizationName: 'Placeholder Kochi Crew', officeLocation: 'Kochi, India', country: 'IN',
    }))
  })

  it('sees only Philippine organizations in the queue, the directory and Members by country', async () => {
    const repository = admin()
    expect(await repository.resolveAdminScope(countryAdmin)).toEqual({ kind: 'country', countries: ['PH'], level: 'act' })
    const queue = await repository.listOrganizationApplications(countryAdmin, 'pending')
    expect(queue.map((entry) => entry.applicationId)).toEqual([philippine.applicationId])
    expect((await repository.listOrganizationApplications(platformAdmin, 'pending')).map((entry) => entry.applicationId).sort())
      .toEqual([philippine.applicationId, indian.applicationId].sort())
    const directory = await repository.listOrganizations(countryAdmin, { query: '', status: 'all', limit: 50 })
    expect(directory.organizations.map((entry) => entry.id)).toEqual([philippine.companyId])

    expect(await repository.getOrganizationApplicationReview(countryAdmin, philippine.applicationId)).toMatchObject({ applicationId: philippine.applicationId })
    await expect(repository.getOrganizationApplicationReview(countryAdmin, indian.applicationId)).rejects.toThrow('organization_out_of_scope')

    const countries = createAdminCountryRepository({ query: run, countrySchemaReady: ready, countryAdminCountries: async (id) => (id === countryAdmin ? ['PH'] : null) })
    expect((await countries.listCountryStats(countryAdmin)).map((row) => row.code)).toEqual(['PH'])
    await expect(countries.getCountryDetail(countryAdmin, 'IN')).rejects.toThrow('country_out_of_scope')
    await expect(countries.memberCountries(countryAdmin, [applicant])).rejects.toThrow()
  })

  it('cannot decide an Indian organization, nor suspend one', async () => {
    const repository = admin()
    await expect(repository.reviewOrganizationApplication(countryAdmin, indian.applicationId, 'approved', null)).rejects.toThrow('organization_out_of_scope')
    await expect(repository.reviewOrganizationApplication(countryAdmin, philippine.applicationId, 'suspended', null)).rejects.toThrow('admin_forbidden')
    expect(await run(`select status from public.organization_applications where id = $1`, [indian.applicationId])).toEqual([{ status: 'pending' }])
  })

  it('cannot use any platform admin repository', async () => {
    const repository = admin()
    expect(await repository.isPlatformAdministrator(countryAdmin)).toBe(false)
    await expect(repository.searchUsers(countryAdmin, { query: '', status: 'all', limit: 50 })).rejects.toThrow()
    await expect(repository.countUsers(countryAdmin, { query: '', status: 'all' })).rejects.toThrow()
    await expect(repository.getAdminUser(countryAdmin, applicant)).rejects.toThrow()
    await expect(repository.listAuditEvents(countryAdmin, { targetType: 'all', limit: 10 })).rejects.toThrow()
    await expect(repository.listModerationCases(countryAdmin, 'open' as never)).rejects.toThrow()
    await expect(repository.setOrganizationCountry(countryAdmin, indian.companyId, 'PH')).rejects.toThrow()
    await expect(repository.setUserAccountStatus(countryAdmin, applicant, 'suspended' as never, 'Placeholder reason' as never)).rejects.toThrow()
  })

  it('approves a Philippine organization: audited with the country and role, the applicant notified in the app and by email', async () => {
    await admin().reviewOrganizationApplication(countryAdmin, philippine.applicationId, 'approved', null)
    expect(await run(`select status from public.organization_applications where id = $1`, [philippine.applicationId])).toEqual([{ status: 'approved' }])

    const [audit] = await run(
      `select actor_id, metadata from public.audit_events where target_id = $1 and action like 'organization.%' order by created_at desc limit 1`,
      [philippine.applicationId],
    )
    expect(audit).toMatchObject({ actor_id: countryAdmin, metadata: expect.objectContaining({ actorRole: 'country_admin', country: 'PH' }) })

    const notices = await run(`select notification_type, company_id, details from public.notifications where recipient_id = $1 and notification_type = 'organization_review_decided'`, [applicant])
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ company_id: philippine.companyId, details: expect.objectContaining({ decision: 'approved' }) })
    const emails = await run(`select decision, status, recipient_id from public.organization_review_emails where company_id = $1`, [philippine.companyId])
    expect(emails).toEqual([{ decision: 'approved', status: 'pending', recipient_id: applicant }])

    // The platform audit filter for country admin decisions finds it.
    const filtered = await admin().listAuditEvents(platformAdmin, { targetType: 'all', limit: 50, countryAdminsOnly: true, country: 'PH' })
    expect(filtered.map((event) => event.targetId)).toContain(philippine.applicationId)
    expect((await admin().listAuditEvents(platformAdmin, { targetType: 'all', limit: 50, actorId: countryAdmin })).length).toBeGreaterThan(0)
  })

  it('leaves platform administrators with every power, the Indian decision and suspensions included', async () => {
    const repository = admin()
    await repository.reviewOrganizationApplication(platformAdmin, indian.applicationId, 'rejected', 'Placeholder reason for the test.')
    const [audit] = await run(
      `select metadata from public.audit_events where target_id = $1 and action like 'organization.%' order by created_at desc limit 1`,
      [indian.applicationId],
    )
    expect(audit!.metadata).toEqual(expect.objectContaining({ actorRole: 'platform_admin', country: 'IN' }))
    const [email] = await run(`select decision, payload from public.organization_review_emails where company_id = $1`, [indian.companyId])
    expect(email).toMatchObject({ decision: 'rejected', payload: expect.objectContaining({ reason: 'Placeholder reason for the test.' }) })
    await repository.reviewOrganizationApplication(platformAdmin, philippine.applicationId, 'suspended', 'Placeholder suspension.')
    expect(await run(`select status from public.organization_applications where id = $1`, [philippine.applicationId])).toEqual([{ status: 'suspended' }])
  })

  it('loses access the moment the role is removed', async () => {
    await countryAdmins().remove(platformAdmin, countryAdmin)
    await expect(admin().resolveAdminScope(countryAdmin)).rejects.toThrow('admin_forbidden')
    await expect(admin().listOrganizationApplications(countryAdmin, 'pending')).rejects.toThrow('admin_forbidden')
  })
})
