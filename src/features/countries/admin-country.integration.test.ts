import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAdminRepository } from '@/features/admin/repository'
import { createAdminCountryRepository, type CountryStatsRow } from './admin-country-repository'
import { countryFromLocation, countryFromPhone, normaliseCountryText } from './catalog'
import { countryTextSql, memberCountryCtes, memberCountryValues } from './member-country-sql'

/**
 * Round GP (Global Partners), Parts A and B, against the real schema (PGlite with every migration, including 0108):
 * each member's country in order (profile → location text → phone code → sign-up country), the estimates never
 * written into the profile, and the Members by country numbers equal to direct counts. Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
let adminId = ''
let memberAdmin = ''
const ids: Record<string, string> = {}
let subject = 0

async function member(name: string, input: {
  residence?: string
  nationality?: string
  location?: string
  phone?: string
  phoneVerified?: boolean
  sessions?: string[]
  signupCountry?: string
  registered?: boolean
  verified?: boolean
  department?: string
  cadetStage?: string
  createdDaysAgo?: number
} = {}) {
  const registered = input.registered ?? true
  const rows = await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at, location,
       country_of_residence, nationality, role_department_key, cadet_stage_key, created_at)
     values (gen_random_uuid(), $1, $2, 'seafarer', 'Placeholder headline', 'Placeholder summary for a test member.',
       case when $3::boolean then now() end, $4, $5, $6, $7, $8, now() - make_interval(days => $9::int))
     returning id`,
    [name, `${name.toLowerCase().replaceAll(' ', '-')}-${Object.keys(ids).length}`, registered, input.location ?? null,
      input.residence ?? null, input.nationality ?? null, input.department ?? null, input.cadetStage ?? null, input.createdDaysAgo ?? 60],
  )
  const id = String(rows[0]!.id)
  ids[name] = id
  if (input.phone) {
    subject += 1
    await run(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, phone_number, phone_number_verified)
       values ($1, 'cognito', $2, $3, $4)`,
      [id, `placeholder-subject-${subject}`, input.phone, input.phoneVerified ?? true],
    )
  }
  for (const [index, country] of (input.sessions ?? []).entries()) {
    await run(
      `insert into public.auth_sessions (profile_id, token_origin_hash, created_at, approx_country)
       values ($1, encode(gen_random_bytes(32), 'hex'), now() - make_interval(days => $2::int), $3)`,
      [id, 30 - index, country],
    )
  }
  if (input.signupCountry) {
    await run(`insert into public.member_signup_countries (profile_id, country_code) values ($1, $2)`, [id, input.signupCountry])
  }
  if (input.verified) {
    await run(`insert into public.feature_verifications (profile_id, verification_type, status) values ($1, 'recruiter', 'approved')`, [id])
  }
  return id
}

async function company(name: string, country: string | null, ownerId: string) {
  const rows = await run(
    `insert into public.companies (slug, name, created_by, country) values ($1, $2, $3, $4) returning id`,
    [`${name.toLowerCase().replaceAll(' ', '-')}`, name, ownerId, country],
  )
  return String(rows[0]!.id)
}

async function job(title: string, input: { companyId?: string; posterId: string; status?: 'published' | 'draft' }) {
  await run(
    `insert into public.jobs (title, company_name, summary, description, status, company_id, created_by_user_id)
     values ($1, 'Placeholder Org', 'Placeholder summary', 'Placeholder description', $2::public.job_listing_status, $3, $4)`,
    [title, input.status ?? 'published', input.companyId ?? null, input.posterId],
  )
}

const repository = (ttl = 5_000) => createAdminCountryRepository({ query: run, cacheTtlMs: ttl })

beforeAll(async () => {
  db = await createTestDatabase()
  adminId = await member('Placeholder Admin', { residence: 'IN' })
  await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [adminId])
  memberAdmin = await member('Placeholder Not Admin', { residence: 'IN' })

  await member('Chose Philippines', { residence: 'PH', nationality: 'PH', location: 'Mumbai, India', phone: '+919812345678', verified: true, department: 'deck_officers', createdDaysAgo: 2 })
  await member('Location Philippines', { location: 'Manila, Philippines', phone: '+919812345679', department: 'deck_ratings', createdDaysAgo: 10 })
  await member('Location Only Country', { location: 'The Philippines', createdDaysAgo: 40 })
  await member('City Only Phone India', { location: 'Mumbai', phone: '+919812345670', nationality: 'IN' })
  await member('Phone Canada', { phone: '+14165551234' })
  await member('Phone United States', { phone: '+12125551234' })
  await member('Phone Jamaica', { phone: '+18765551234' })
  await member('Session UAE', { sessions: ['AE', 'GB'] })
  await member('Signup Singapore', { sessions: ['AE'], signupCountry: 'SG' })
  await member('Nothing Known', { cadetStage: 'pre_sea' })
  await member('Not Registered Philippines', { residence: 'PH', registered: false })

  const ph1 = await company('Placeholder Manila Crewing', 'PH', ids['Chose Philippines']!)
  await company('Placeholder Cebu Manning', 'PH', ids['Chose Philippines']!)
  await company('Placeholder Mumbai Ship Management', 'IN', adminId)
  await company('Placeholder No Country Org', null, adminId)
  await job('Placeholder Second Officer', { companyId: ph1, posterId: ids['Chose Philippines']! })
  await job('Placeholder Draft', { companyId: ph1, posterId: ids['Chose Philippines']!, status: 'draft' })
  await job('Placeholder Personal Job', { posterId: ids['City Only Phone India']! })
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function countries() {
  const rows = await run(`with ${memberCountryCtes({ namesParam: 1, dialsParam: 2 })} select profile_id, code, source from member_country`, [...memberCountryValues()])
  return new Map(rows.map((row) => [String(row.profile_id), { code: row.code ?? null, source: row.source ?? null }]))
}

const byCode = (rows: CountryStatsRow[], code: string | null) => rows.find((row) => row.code === code)

describe('Round GP member countries (migration 0108)', () => {
  it('takes the chosen country first, then location text, then phone code, then the sign-up country', async () => {
    const all = await countries()
    const of = (name: string) => all.get(ids[name]!)
    expect(of('Chose Philippines')).toEqual({ code: 'PH', source: 'profile' })
    expect(of('Location Philippines')).toEqual({ code: 'PH', source: 'location' })
    expect(of('Location Only Country')).toEqual({ code: 'PH', source: 'location' })
    expect(of('City Only Phone India')).toEqual({ code: 'IN', source: 'phone' })
    expect(of('Phone Canada')).toEqual({ code: 'CA', source: 'phone' })
    expect(of('Phone United States')).toEqual({ code: 'US', source: 'phone' })
    expect(of('Phone Jamaica')).toEqual({ code: 'JM', source: 'phone' })
    expect(of('Session UAE')).toEqual({ code: 'AE', source: 'signup' })
    expect(of('Signup Singapore')).toEqual({ code: 'SG', source: 'signup' })
    expect(of('Nothing Known')).toEqual({ code: null, source: null })
  })

  it('never writes an estimate into the profile', async () => {
    await repository().listCountryStats(adminId)
    await repository().memberCountries(adminId, Object.values(ids))
    const rows = await run(`select full_name, country_of_residence from public.profiles where country_of_residence is not null order by full_name`)
    expect(rows.map((row) => row.full_name)).toEqual(['Chose Philippines', 'Not Registered Philippines', 'Placeholder Admin', 'Placeholder Not Admin'])
  })

  it('normalises location text the same way in Postgres as in the app', async () => {
    const samples = ['Côte d’Ivoire', 'Manila, Philippines', '  São Tomé and Príncipe ', 'U.A.E.', 'Türkiye', 'Mumbai']
    const rows = await run(`select x, ${countryTextSql('x')} as normalised from unnest($1::text[]) as x`, [samples])
    for (const row of rows) expect(row.normalised).toBe(normaliseCountryText(String(row.x)))
    expect(countryFromLocation('Manila, Philippines')).toBe('PH')
    expect(countryFromLocation('Mumbai')).toBeNull()
    expect(countryFromPhone('+14165551234')).toBe('CA')
  })

  it('counts each country the same as a direct database count, for three sample countries', async () => {
    const stats = await repository().listCountryStats(adminId)
    const all = await countries()
    for (const code of ['PH', 'IN', 'AE']) {
      const registered = await run(
        `select p.id, exists (select 1 from public.feature_verifications fv where fv.profile_id = p.id and fv.status = 'approved') as verified
         from public.profiles p where p.account_status = 'active' and p.onboarding_completed_at is not null and not p.is_load_test`,
      )
      const inCountry = registered.filter((row) => all.get(String(row.id))?.code === code)
      const organizations = await run(`select count(*)::int as total from public.companies where country = $1`, [code])
      const row = byCode(stats, code)
      expect(row?.registered ?? 0).toBe(inCountry.length)
      expect(row?.verified ?? 0).toBe(inCountry.filter((entry) => entry.verified).length)
      expect(row?.organizations ?? 0).toBe(Number(organizations[0]!.total))
    }
    expect(byCode(stats, 'PH')).toMatchObject({ registered: 3, verified: 1, newThisWeek: 1, newThisMonth: 2, estimated: 2, organizations: 2, activeJobs: 1 })
    expect(byCode(stats, 'IN')).toMatchObject({ registered: 3, estimated: 1, organizations: 1, activeJobs: 1 })
    expect(byCode(stats, null)).toMatchObject({ registered: 1, organizations: 1 })
  })

  it('counts by nationality without estimates', async () => {
    const stats = await repository().listCountryStats(adminId, 'nationality')
    expect(byCode(stats, 'PH')).toMatchObject({ registered: 1, estimated: 0 })
    expect(byCode(stats, 'IN')).toMatchObject({ registered: 1, estimated: 0 })
  })

  it('gives a country its last 12 weeks and departments', async () => {
    const detail = await repository().getCountryDetail(adminId, 'PH')
    expect(detail.weeks).toHaveLength(12)
    expect(detail.weeks.at(-1)!.membersToDate).toBe(3)
    expect(detail.weeks.reduce((sum, week) => sum + week.newMembers, 0)).toBe(3)
    expect(detail.weeks.reduce((sum, week) => sum + week.jobsPosted, 0)).toBe(1)
    expect(detail.departments).toEqual(expect.arrayContaining([
      { departmentKey: 'deck_officers', cadet: false, members: 1 },
      { departmentKey: 'deck_ratings', cadet: false, members: 1 },
      { departmentKey: null, cadet: false, members: 1 },
    ]))
    const unset = await repository().getCountryDetail(adminId, null)
    expect(unset.departments).toEqual([{ departmentKey: null, cadet: true, members: 1 }])
  })

  it('refuses members who are not platform administrators, and unknown country codes', async () => {
    await expect(repository().listCountryStats(memberAdmin)).rejects.toThrow('admin_forbidden')
    await expect(repository().getCountryDetail(memberAdmin, 'PH')).rejects.toThrow('admin_forbidden')
    await expect(repository().memberCountries(memberAdmin, [adminId])).rejects.toThrow('admin_forbidden')
    await expect(repository().getCountryDetail(adminId, 'QQ')).rejects.toThrow('country_unknown')
  })

  it('works out the listed members only, with their source', async () => {
    const result = await repository().memberCountries(adminId, [ids['Location Philippines']!, ids['Session UAE']!])
    expect([...result.values()]).toEqual(expect.arrayContaining([{ code: 'PH', source: 'location' }, { code: 'AE', source: 'signup' }]))
    expect(result.size).toBe(2)
  })

  it('filters the admin member list by country, the same way the table counts it', async () => {
    const admin = createAdminRepository({ query: run, transaction: async (work) => work(run) })
    const philippines = await admin.searchUsers(adminId, { query: '', status: 'all', limit: 50, country: 'PH' })
    expect(philippines.map((user) => user.fullName).sort()).toEqual(['Chose Philippines', 'Location Only Country', 'Location Philippines', 'Not Registered Philippines'])
    expect(await admin.countUsers(adminId, { query: '', status: 'all', country: 'PH' })).toBe(4)
    const unset = await admin.searchUsers(adminId, { query: '', status: 'all', limit: 50, country: 'unset' })
    expect(unset.map((user) => user.fullName)).toEqual(['Nothing Known'])
    const searched = await admin.searchUsers(adminId, { query: 'location', status: 'all', limit: 50, country: 'PH' })
    expect(searched).toHaveLength(2)
  })

  it('lets a platform administrator set an organization country, with an audit event, and filters organizations by it', async () => {
    const admin = createAdminRepository({ query: run, transaction: async (work) => work(run) })
    const [target] = await run(`select id from public.companies where country is null limit 1`)
    const companyId = String(target!.id)
    expect((await admin.listOrganizations(adminId, { query: '', status: 'all', limit: 50, country: 'unset' })).organizations.map((entry) => entry.id)).toEqual([companyId])
    expect(await admin.getOrganizationCountryTarget(adminId, companyId)).toMatchObject({ id: companyId, country: null })

    expect(await admin.setOrganizationCountry(adminId, companyId, 'SG')).toBe(true)
    expect((await admin.listOrganizations(adminId, { query: '', status: 'all', limit: 50, country: 'SG' })).organizations.map((entry) => entry.country)).toEqual(['SG'])
    const audit = await run(`select actor_id, action, target_type, metadata from public.audit_events where target_id = $1`, [companyId])
    expect(audit).toEqual([{ actor_id: adminId, action: 'organization.country_set', target_type: 'company', metadata: { previousCountry: null, country: 'SG' } }])

    // Saving the same country again writes nothing new; a non-administrator is refused.
    expect(await admin.setOrganizationCountry(adminId, companyId, 'SG')).toBe(true)
    expect(await run(`select 1 from public.audit_events where target_id = $1`, [companyId])).toHaveLength(1)
    await expect(admin.setOrganizationCountry(memberAdmin, companyId, 'IN')).rejects.toThrow('admin_forbidden')
    expect(await admin.setOrganizationCountry(adminId, '00000000-0000-4000-8000-000000000000', 'IN')).toBe(false)
  })
})
