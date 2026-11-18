import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAdminRepository } from '@/features/admin/repository'
import { createIdentityRepository } from '@/features/auth/identity-repository'
import { createOrganizationRepository } from '@/features/organizations/repository'
import { organizationApplicationSchema } from '@/features/organizations/schemas'
import { createUnclaimedOrganizationRepository } from '@/features/organizations/unclaimed-organization-repository'
import { createOnboardingRepository } from '@/features/profiles/onboarding-repository'
import { createAdminCountryRepository } from './admin-country-repository'
import { CountrySchemaMissingError, createCountrySchemaProbe } from './country-schema'
import { createProfileCountryRepository } from './profile-country-repository'

/**
 * Round GP safety net (owner, 18 Nov): this release may run before migration 0108 is applied. Against a real schema
 * without 0108 (PGlite, every other migration), every country read and write falls back to what the app did before:
 * onboarding, organization applications and claims, Admin lists and filters, the member's own country and sign-up
 * all work; the Admin country pages and the set-country action say "not available yet". Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const transaction = async <T,>(work: (query: typeof run) => Promise<T>) => db.transaction((query) => work(query as typeof run))
let ready: () => Promise<boolean>
let adminId = ''
let memberId = ''

beforeAll(async () => {
  db = await createTestDatabase({ skipMigrations: ['0108_member_countries.sql'] })
  ready = createCountrySchemaProbe({ query: run }).ready
  adminId = String((await run(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Admin') returning id`))[0]!.id)
  await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [adminId])
  memberId = String((await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at, location)
     values (gen_random_uuid(), 'Placeholder Member', 'placeholder-member', 'seafarer', 'Placeholder headline',
       'Placeholder summary for a test member.', now(), 'Manila, Philippines') returning id`,
  ))[0]!.id)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const application = (overrides: Record<string, unknown> = {}) => organizationApplicationSchema.parse({
  organizationName: 'Placeholder Harbour Crew',
  organizationType: 'union',
  website: null,
  officialEmail: 'office@placeholder.example',
  officeLocation: 'Kochi, India',
  country: 'IN',
  description: 'A placeholder organization used only in this test.',
  fleetSummary: null,
  vesselTypes: [],
  applicantRole: 'Secretary',
  registrationReference: null,
  supportingNotes: null,
  ...overrides,
})

describe('before migration 0108 (Round GP safety net)', () => {
  it('the schema check sees that the country columns are missing', async () => {
    expect(await ready()).toBe(false)
    expect(await run(`select 1 from information_schema.columns where table_name = 'companies' and column_name = 'country'`)).toHaveLength(0)
  })

  it('onboarding saves the profile without the country fields', async () => {
    const id = String((await run(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder New') returning id`))[0]!.id)
    const repository = createOnboardingRepository({ query: run, countrySchemaReady: ready })
    await repository.updateActivationProfile(id, {
      persona: 'shore_professional', profileIntents: ['network'], fullName: 'Placeholder New', slug: 'placeholder-new',
      location: 'Manila, Philippines', headline: 'Placeholder headline', contactVisibility: 'members',
      countryOfResidence: 'PH', nationality: 'PH',
    } as never, 'maritime_professional', false)
    expect(await run(`select slug, location from public.profiles where id = $1`, [id])).toEqual([{ slug: 'placeholder-new', location: 'Manila, Philippines' }])
  })

  it('organization applications, resubmissions and claims are saved and read without a country', async () => {
    const organizations = createOrganizationRepository({ query: run, transaction, countrySchemaReady: ready })
    const { companyId, applicationId } = await organizations.submitOrganizationApplication(memberId, application())
    expect(await organizations.getOrganizationApplication(memberId, applicationId)).toMatchObject({ country: null, officeLocation: 'Kochi, India' })
    await run(`update public.organization_applications set status = 'changes_requested' where id = $1`, [applicationId])
    await organizations.resubmitOrganizationApplication(memberId, applicationId, application({ description: 'An updated placeholder description.' }))
    expect(await run(`select description from public.companies where id = $1`, [companyId])).toEqual([{ description: 'An updated placeholder description.' }])

    const unclaimed = createUnclaimedOrganizationRepository({ query: run, transaction, countrySchemaReady: ready })
    const page = await unclaimed.createUnclaimedOrganization(adminId, { name: 'Placeholder Unclaimed Port', organizationType: 'port_terminal', website: null, location: 'Cebu, Philippines' } as never)
    expect(await unclaimed.getClaimableOrganization(page.slug)).toMatchObject({ unclaimed: true, prefill: { country: null } })
    const claimant = String((await run(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Claimant') returning id`))[0]!.id)
    await unclaimed.submitClaim(claimant, page.id, application({ organizationName: 'Placeholder Unclaimed Port', organizationType: 'port_terminal' }))
    expect(await run(`select request_kind from public.organization_applications where company_id = $1`, [page.id])).toEqual([{ request_kind: 'claim' }])
  })

  it('Admin lists, reviews and filters work, with every organization "not set" and members by estimate only', async () => {
    const admin = createAdminRepository({ query: run, transaction, countrySchemaReady: ready })
    const directory = await admin.listOrganizations(adminId, { query: '', status: 'all', limit: 50 })
    expect(directory.organizations.length).toBeGreaterThan(0)
    expect(directory.organizations.every((entry) => entry.country === null)).toBe(true)
    expect((await admin.listOrganizations(adminId, { query: '', status: 'all', limit: 50, country: 'unset' })).total).toBe(directory.total)
    expect((await admin.listOrganizations(adminId, { query: '', status: 'all', limit: 50, country: 'IN' })).organizations).toEqual([])
    const [review] = await admin.listOrganizationApplications(adminId, 'pending')
    expect(review?.company.country).toBeNull()

    const philippines = await admin.searchUsers(adminId, { query: '', status: 'all', limit: 50, country: 'PH' })
    expect(philippines.map((user) => user.fullName).sort()).toEqual(['Placeholder Member', 'Placeholder New'])
    expect(await admin.countUsers(adminId, { query: '', status: 'all', country: 'PH' })).toBe(2)

    const countries = createAdminCountryRepository({ query: run, countrySchemaReady: ready })
    expect([...(await countries.memberCountries(adminId, [memberId])).values()]).toEqual([{ code: 'PH', source: 'location' }])
    await expect(countries.listCountryStats(adminId)).rejects.toBeInstanceOf(CountrySchemaMissingError)
    await expect(countries.getCountryDetail(adminId, 'PH')).rejects.toBeInstanceOf(CountrySchemaMissingError)
    await expect(admin.setOrganizationCountry(adminId, directory.organizations[0]!.id, 'IN')).rejects.toBeInstanceOf(CountrySchemaMissingError)
    await expect(admin.getOrganizationCountryTarget(adminId, directory.organizations[0]!.id)).rejects.toBeInstanceOf(CountrySchemaMissingError)
  })

  it("the member's own country is simply not offered, and sign-up still creates the account", async () => {
    const profiles = createProfileCountryRepository({ query: run, countrySchemaReady: ready })
    expect(await profiles.getOwnCountries(memberId)).toBeNull()
    await expect(profiles.dismissPrompt(memberId)).resolves.toBeUndefined()
    await expect(profiles.saveOwnCountries(memberId, { countryOfResidence: 'PH', nationality: null })).rejects.toBeInstanceOf(CountrySchemaMissingError)

    const identity = createIdentityRepository({
      query: run as never,
      withTransaction: (work) => db.transaction((query) => work({ query: async (text: string, values?: readonly unknown[]) => ({ rows: await query(text, values) }) } as unknown as DatabaseQueryClient)),
      countrySchemaReady: ready,
    })
    const profileId = await identity.provisionProfileForCognitoPrincipal({
      sub: 'placeholder-sub-before-0108', username: 'placeholder', email: 'new@placeholder.example', emailVerified: false,
      phoneNumber: null, phoneNumberVerified: false, name: 'Placeholder Signup',
    }, { signupCountry: 'PH' })
    expect(await run(`select full_name from public.profiles where id = $1`, [profileId])).toEqual([{ full_name: 'Placeholder Signup' }])
  })

  it('once 0108 is applied, the check sees it within its recheck window', async () => {
    let clock = 0
    const probe = createCountrySchemaProbe({ query: run, now: () => clock })
    expect(await probe.ready()).toBe(false)
    const { readFileSync } = await import('node:fs')
    for (const statement of readFileSync('infra/aws/database/migrations/0108_member_countries.sql', 'utf8').split('-- statement-breakpoint')) {
      if (statement.trim()) await db.query(statement)
    }
    expect(await probe.ready()).toBe(false)
    clock += 60_000
    expect(await probe.ready()).toBe(true)
    clock += 10_000_000
    expect(await probe.ready()).toBe(true)
  })
})

describe('the country schema check itself', () => {
  it('remembers "present" for good, rechecks "missing" after 60 seconds, and treats a failed check as present for 60 seconds', async () => {
    let clock = 0
    let answer: Row = { columns: 3, signup_table: true }
    let fail = false
    let calls = 0
    const probe = createCountrySchemaProbe({
      now: () => clock,
      query: async () => {
        calls += 1
        if (fail) throw new Error('connection refused')
        return [answer]
      },
    })
    expect(await probe.ready()).toBe(false)
    expect(await probe.ready()).toBe(false)
    expect(calls).toBe(1)
    clock += 60_000
    fail = true
    expect(await probe.ready()).toBe(true)
    expect(await probe.ready()).toBe(true)
    expect(calls).toBe(2)
    clock += 60_000
    fail = false
    answer = { columns: 4, signup_table: true }
    expect(await probe.ready()).toBe(true)
    clock += 10_000_000
    expect(await probe.ready()).toBe(true)
    expect(calls).toBe(3)
  })
})
