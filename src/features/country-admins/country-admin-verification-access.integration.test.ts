import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAdminRepository } from '@/features/admin/repository'
import { createCreatorVerificationRepository } from '@/features/verifications/repository'
import { createCountryAdminRepository } from './repository'

/**
 * Round GP Part E (E2), against the real schema (PGlite, every migration): a Philippines country admin with
 * Verification and Access requests sees and decides only Philippine applicants and organizations, needs "act" to
 * decide, never grants the organization Administrator role, and every decision is audited with the section and the
 * country. Platform administrators keep every power. Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const transaction = async <T,>(work: (query: typeof run) => Promise<T>) => db.transaction((query) => work(query as typeof run))

let platformAdmin = ''
let partner = ''
const ids: Record<string, string> = {}

async function profile(name: string, residence: string | null) {
  const id = String((await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at, country_of_residence)
     values (gen_random_uuid(), $1, $2, 'seafarer', 'Placeholder headline', 'Placeholder summary for a test member.', now(), $3)
     returning id`,
    [name, name.toLowerCase().replaceAll(' ', '-'), residence],
  ))[0]!.id)
  ids[name] = id
  return id
}

async function verification(profileId: string) {
  return String((await run(
    `insert into public.feature_verifications (profile_id, verification_type, status, source, application_payload, submitted_at)
     values ($1, 'recruiter', 'pending', 'application', '{}'::jsonb, now()) returning id`,
    [profileId],
  ))[0]!.id)
}

async function company(name: string, country: string | null) {
  return String((await run(
    `insert into public.companies (slug, name, created_by, country) values ($1, $2, $3, $4) returning id`,
    [name.toLowerCase().replaceAll(' ', '-'), name, platformAdmin, country],
  ))[0]!.id)
}

/** An escalated request, so Sea N Shore (and so a country admin) may decide it. */
async function accessRequest(companyId: string, userId: string, role = 'recruiter') {
  return String((await run(
    `insert into public.company_access_requests (company_id, user_id, requested_role, request_type, status, escalated_at)
     values ($1, $2, $3::public.company_member_role, 'role_access', 'pending', now()) returning id`,
    [companyId, userId, role],
  ))[0]!.id)
}

const admin = () => createAdminRepository({ query: run, transaction, countrySchemaReady: async () => true })
const verifications = () => createCreatorVerificationRepository({ query: run, transaction })
const countryAdmins = () => createCountryAdminRepository({ query: run, transaction })

beforeAll(async () => {
  db = await createTestDatabase()
  platformAdmin = await profile('Placeholder Admin', null)
  await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [platformAdmin])
  partner = await profile('Placeholder Partner', 'PH')
  await profile('Placeholder Manila', 'PH')
  await profile('Placeholder Kochi', 'IN')
  await profile('Placeholder Nowhere', null)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('Verification for a Philippines country admin', () => {
  let manila = ''
  let kochi = ''
  let nowhere = ''

  beforeAll(async () => {
    manila = await verification(ids['Placeholder Manila']!)
    kochi = await verification(ids['Placeholder Kochi']!)
    nowhere = await verification(ids['Placeholder Nowhere']!)
  })

  it('is refused without the section, and lists only Philippine applicants with it', async () => {
    await countryAdmins().grant(platformAdmin, partner, ['PH'])
    await expect(verifications().listAdminApplications(partner, 'pending')).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', verification: 'view' })
    expect((await verifications().listAdminApplications(partner, 'pending')).map((entry) => entry.id)).toEqual([manila])
    expect((await verifications().listAdminApplications(platformAdmin, 'pending')).map((entry) => entry.id).sort()).toEqual([manila, kochi, nowhere].sort())
  })

  it('needs "act" to decide, decides only Philippine applicants, and audits the section and country', async () => {
    await expect(verifications().reviewApplication(partner, manila, 'approved', null)).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', verification: 'act' })
    await expect(verifications().reviewApplication(partner, kochi, 'approved', null)).rejects.toThrow('verification_out_of_scope')
    await expect(verifications().reviewApplication(partner, nowhere, 'approved', null)).rejects.toThrow('verification_out_of_scope')
    await verifications().reviewApplication(partner, manila, 'approved', null)
    expect(await run(`select status from public.feature_verifications where id = $1`, [manila])).toEqual([{ status: 'approved' }])
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'verification.approved'`, [manila])
    expect(audit!.metadata).toMatchObject({ section: 'verification', actorRole: 'country_admin', country: 'PH' })
  })

  it('leaves platform administrators deciding the rest, the no-country one included', async () => {
    await verifications().reviewApplication(platformAdmin, nowhere, 'rejected', 'Placeholder reason.')
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'verification.rejected'`, [nowhere])
    expect(audit!.metadata).toMatchObject({ section: 'verification', actorRole: 'platform_admin', country: null })
  })
})

describe('Access requests for a Philippines country admin', () => {
  let manilaRequest = ''
  let manilaAdminRequest = ''
  let kochiRequest = ''

  beforeAll(async () => {
    const manilaCompany = await company('Placeholder Manila Shipping', 'PH')
    const kochiCompany = await company('Placeholder Kochi Shipping', 'IN')
    manilaRequest = await accessRequest(manilaCompany, ids['Placeholder Manila']!)
    manilaAdminRequest = await accessRequest(manilaCompany, ids['Placeholder Nowhere']!, 'administrator')
    kochiRequest = await accessRequest(kochiCompany, ids['Placeholder Kochi']!)
  })

  it('lists and counts only Philippine organizations, and needs the section', async () => {
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act' })
    await expect(admin().listCompanyAccessRequests(partner, 'needs_platform')).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', access: 'view' })
    expect((await admin().listCompanyAccessRequests(partner, 'needs_platform')).map((entry) => entry.id).sort()).toEqual([manilaRequest, manilaAdminRequest].sort())
    expect((await admin().countCompanyAccessRequests(partner)).needs_platform).toBe(2)
    expect((await admin().countCompanyAccessRequests(platformAdmin)).needs_platform).toBe(3)
  })

  it('decides only with "act", only for its countries, and never grants the Administrator role', async () => {
    await expect(admin().reviewCompanyAccessRequest(partner, manilaRequest, 'approved', null)).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', access: 'act' })
    await expect(admin().reviewCompanyAccessRequest(partner, kochiRequest, 'approved', null)).rejects.toThrow('company_access_request_out_of_scope')
    await expect(admin().reviewCompanyAccessRequest(partner, manilaAdminRequest, 'approved', null)).rejects.toThrow('company_access_request_admin_role_platform_only')
    await expect(admin().reviewCompanyAccessRequest(partner, manilaRequest, 'approved', null, 'administrator')).rejects.toThrow('company_access_request_admin_role_platform_only')

    await admin().reviewCompanyAccessRequest(partner, manilaRequest, 'approved', null, 'recruiter')
    expect(await run(`select status, granted_role::text as role, decided_via from public.company_access_requests where id = $1`, [manilaRequest]))
      .toEqual([{ status: 'approved', role: 'recruiter', decided_via: 'platform' }])
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'organization_access.approved'`, [manilaRequest])
    expect(audit!.metadata).toMatchObject({ section: 'access', actorRole: 'country_admin', country: 'PH', deciderRole: 'country_admin' })

    // A lower role for the Administrator request is fine; so is declining it.
    await admin().reviewCompanyAccessRequest(partner, manilaAdminRequest, 'rejected', 'Placeholder reason for the test.')
    expect(await run(`select status from public.company_access_requests where id = $1`, [manilaAdminRequest])).toEqual([{ status: 'rejected' }])
  })

  it('leaves platform administrators every power, the Administrator role included', async () => {
    await admin().reviewCompanyAccessRequest(platformAdmin, kochiRequest, 'approved', null, 'administrator')
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'organization_access.approved'`, [kochiRequest])
    expect(audit!.metadata).toMatchObject({ section: 'access', actorRole: 'platform_admin', country: 'IN', grantedRole: 'administrator' })
  })
})
