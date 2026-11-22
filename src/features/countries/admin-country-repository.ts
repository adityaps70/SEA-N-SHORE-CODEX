import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { createSharedCache } from '@/lib/server/shared-cache'
import { LIVE_JOB_SQL } from '@/features/jobs/repository'
import {
  REGISTERED_MEMBER_SQL,
  VERIFIED_MEMBER_SQL,
  memberCountryCtes,
  memberCountryValues,
  type MemberCountrySource,
} from './member-country-sql'
import { isCountryCode } from './catalog'
import { CountrySchemaMissingError, countrySchemaReady } from './country-schema'
import { loadCountryAdminAccess } from '@/features/country-admins/scope'
import { allows } from '@/features/country-admins/sections'

/**
 * Round GP (Global Partners), Part B: Admin › Members by country. Counts only: no member names, emails or phone
 * numbers leave this module. The all-country table and each country's detail are the same for every administrator,
 * so they sit in a 30-second shared cache after the permission check; nothing heavy runs on every page view.
 */
type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

/** Which member country the table counts by: country of residence (with estimates), or nationality (no estimates). */
export const COUNTRY_BASES = ['residence', 'nationality'] as const
export type CountryBasis = (typeof COUNTRY_BASES)[number]

/** A country code, or null for members / organizations with no country at all. */
export type CountryKey = string | null

export type CountryStatsRow = {
  code: CountryKey
  registered: number
  verified: number
  newThisWeek: number
  newThisMonth: number
  /** Members counted here from an estimate (location text, phone code or sign-up country). */
  estimated: number
  organizations: number
  activeJobs: number
}

export type CountryWeek = {
  /** Monday of the week, YYYY-MM-DD (UTC). */
  weekStart: string
  newMembers: number
  /** Registered members who had joined by the end of that week. */
  membersToDate: number
  newOrganizations: number
  jobsPosted: number
}

export type CountryDepartmentCount = {
  departmentKey: string | null
  /** Members with no department who are cadets (a cadet stage is set). */
  cadet: boolean
  members: number
}

export type CountryDetail = {
  code: CountryKey
  totals: CountryStatsRow
  weeks: CountryWeek[]
  departments: CountryDepartmentCount[]
}

export type MemberCountry = { code: string | null; source: MemberCountrySource | null }

export const COUNTRY_DETAIL_WEEKS = 12
const CACHE_TTL_MS = 30_000

const number = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const key = (value: unknown): CountryKey => (typeof value === 'string' && value ? value : null)

/** The member-country CTEs for a basis, and the values they read starting at `first`. */
function memberCodes(basis: CountryBasis, first: number) {
  if (basis === 'nationality') {
    return {
      ctes: `member_country as (
        select p.id as profile_id, p.nationality as code, case when p.nationality is not null then 'profile' end as source
        from public.profiles p
      )`,
      values: [] as unknown[],
    }
  }
  return { ctes: memberCountryCtes({ namesParam: first, dialsParam: first + 1 }), values: [...memberCountryValues()] as unknown[] }
}

function statsRow(row: Row): CountryStatsRow {
  return {
    code: key(row.code),
    registered: number(row.registered),
    verified: number(row.verified),
    newThisWeek: number(row.new_week),
    newThisMonth: number(row.new_month),
    estimated: number(row.estimated),
    organizations: number(row.organizations),
    activeJobs: number(row.active_jobs),
  }
}

const emptyStats = (code: CountryKey): CountryStatsRow => ({
  code, registered: 0, verified: 0, newThisWeek: 0, newThisMonth: 0, estimated: 0, organizations: 0, activeJobs: 0,
})

/** Stats for every country with at least one member, organization or live job ('' stands for "no country"). */
export function statsSql(basis: CountryBasis, countryFilter: string | null) {
  const { ctes, values } = memberCodes(basis, 1)
  const filter = countryFilter === null ? '' : `where codes.code = ${String.fromCharCode(36)}${values.length + 1}`
  return {
    text: `with ${ctes},
      members as (
        select coalesce(mc.code, '') as code, mc.source, p.created_at, ${VERIFIED_MEMBER_SQL('p')} as verified
        from public.profiles p
        join member_country mc on mc.profile_id = p.id
        where ${REGISTERED_MEMBER_SQL('p')}
      ),
      member_counts as (
        select code,
               count(*) as registered,
               count(*) filter (where verified) as verified,
               count(*) filter (where created_at >= now() - interval '7 days') as new_week,
               count(*) filter (where created_at >= now() - interval '30 days') as new_month,
               count(*) filter (where source in ('location', 'phone', 'signup')) as estimated
        from members
        group by code
      ),
      organization_counts as (
        select coalesce(c.country, '') as code, count(*) as organizations
        from public.companies c
        group by 1
      ),
      job_counts as (
        select coalesce(case when j.company_id is not null then jc.country else poster.code end, '') as code, count(*) as active_jobs
        from public.jobs j
        left join public.companies jc on jc.id = j.company_id
        left join member_country poster on poster.profile_id = j.created_by_user_id
        where ${LIVE_JOB_SQL}
        group by 1
      ),
      codes as (
        select code from member_counts union select code from organization_counts union select code from job_counts
      )
      select codes.code, m.registered, m.verified, m.new_week, m.new_month, m.estimated, o.organizations, jc.active_jobs
      from codes
      left join member_counts m on m.code = codes.code
      left join organization_counts o on o.code = codes.code
      left join job_counts jc on jc.code = codes.code
      ${filter}`,
    values: countryFilter === null ? values : [...values, countryFilter],
  }
}

function weeksSql(basis: CountryBasis, country: string) {
  const { ctes, values } = memberCodes(basis, 1)
  const at = (offset: number) => `${String.fromCharCode(36)}${values.length + offset}`
  return {
    text: `with ${ctes},
      weeks as (
        select (date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => g.n))::date as week_start
        from generate_series(0, ${at(2)}::int - 1) as g(n)
      ),
      members as (
        select p.created_at from public.profiles p
        join member_country mc on mc.profile_id = p.id
        where ${REGISTERED_MEMBER_SQL('p')} and coalesce(mc.code, '') = ${at(1)}
      ),
      organizations as (
        select c.created_at from public.companies c where coalesce(c.country, '') = ${at(1)}
      ),
      jobs as (
        select j.created_at
        from public.jobs j
        left join public.companies jc on jc.id = j.company_id
        left join member_country poster on poster.profile_id = j.created_by_user_id
        where j.deleted_at is null and j.status <> 'draft'
          and coalesce(case when j.company_id is not null then jc.country else poster.code end, '') = ${at(1)}
      )
      select to_char(w.week_start, 'YYYY-MM-DD') as week_start,
             (select count(*) from members m where m.created_at >= w.week_start and m.created_at < w.week_start + 7) as new_members,
             (select count(*) from members m where m.created_at < w.week_start + 7) as members_to_date,
             (select count(*) from organizations o where o.created_at >= w.week_start and o.created_at < w.week_start + 7) as new_organizations,
             (select count(*) from jobs j where j.created_at >= w.week_start and j.created_at < w.week_start + 7) as jobs_posted
      from weeks w
      order by w.week_start asc`,
    values: [...values, country, COUNTRY_DETAIL_WEEKS],
  }
}

function departmentsSql(basis: CountryBasis, country: string) {
  const { ctes, values } = memberCodes(basis, 1)
  return {
    text: `with ${ctes}
      select p.role_department_key as department_key, (p.role_department_key is null and p.cadet_stage_key is not null) as cadet, count(*) as members
      from public.profiles p
      join member_country mc on mc.profile_id = p.id
      where ${REGISTERED_MEMBER_SQL('p')} and coalesce(mc.code, '') = ${String.fromCharCode(36)}${values.length + 1}
      group by 1, 2
      order by 3 desc, 1 asc nulls last`,
    values: [...values, country],
  }
}

export function createAdminCountryRepository(input: {
  query?: Query
  /** The permission check every read runs first (the platform administrator role). */
  isPlatformAdministrator?: (userId: string) => Promise<boolean>
  /** Round GP (Part C): a country admin's countries, or null (default: only with the Members by country section). */
  countryAdminCountries?: (userId: string) => Promise<string[] | null>
  cacheTtlMs?: number
  countrySchemaReady?: () => Promise<boolean>
} = {}) {
  // Round GP safety net: before migration 0108 the country pages say so instead of failing, and member lists show
  // estimates only (location text, phone code, session country).
  const countryColumnsReady = input.countrySchemaReady ?? countrySchemaReady
  const query: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))
  const isPlatformAdministrator = input.isPlatformAdministrator ?? (async (userId: string) => {
    const rows = await query(`select 1 as allowed from public.user_roles where user_id = $1 and role::text = 'administrator' limit 1`, [userId])
    return Boolean(rows[0])
  })
  const ttlMs = input.cacheTtlMs ?? CACHE_TTL_MS
  // Round CAP (shared cache): counts only, the same for every administrator; the permission check runs before.
  const countryStatsCache = createSharedCache<CountryStatsRow[]>({ name: 'admin_country_stats', ttlMs, maxEntries: 4 })
  const countryDetailCache = createSharedCache<CountryDetail>({ name: 'admin_country_detail', ttlMs, maxEntries: 600 })

  async function authorize(adminId: string) {
    if (!await isPlatformAdministrator(adminId)) throw new Error('admin_forbidden')
  }

  /**
   * Round GP (Part C): a platform administrator sees every country; a country admin only their own countries (never
   * the "Country not set" row, which may hold anyone). Anyone else: admin_forbidden.
   */
  async function countriesFor(adminId: string): Promise<string[] | 'all'> {
    if (await isPlatformAdministrator(adminId)) return 'all'
    const countries = await (input.countryAdminCountries ?? defaultCountryAdminCountries)(adminId).catch(() => null)
    if (!countries?.length) throw new Error('admin_forbidden')
    return countries
  }

  /** Round GP Part E: the countries of a country admin who has the Members by country section, else null. */
  async function defaultCountryAdminCountries(adminId: string) {
    const access = await loadCountryAdminAccess(query, adminId)
    return access && allows(access.permissions, 'members') ? access.countries : null
  }

  async function loadStats(basis: CountryBasis): Promise<CountryStatsRow[]> {
    const { text, values } = statsSql(basis, null)
    return (await query(text, values)).map(statsRow)
  }

  async function loadDetail(basis: CountryBasis, code: CountryKey): Promise<CountryDetail> {
    const country = code ?? ''
    const totalsSql = statsSql(basis, country)
    const weekSql = weeksSql(basis, country)
    const departmentSql = departmentsSql(basis, country)
    const [totals, weeks, departments] = await Promise.all([
      query(totalsSql.text, totalsSql.values),
      query(weekSql.text, weekSql.values),
      query(departmentSql.text, departmentSql.values),
    ])
    return {
      code,
      totals: totals[0] ? statsRow(totals[0]) : emptyStats(code),
      weeks: weeks.map((row) => ({
        weekStart: String(row.week_start),
        newMembers: number(row.new_members),
        membersToDate: number(row.members_to_date),
        newOrganizations: number(row.new_organizations),
        jobsPosted: number(row.jobs_posted),
      })),
      departments: departments.map((row) => ({
        departmentKey: key(row.department_key),
        cadet: row.cadet === true,
        members: number(row.members),
      })),
    }
  }

  /** Every country's numbers, for a platform administrator. Cached for up to 30 seconds. */
  async function listCountryStats(adminId: string, basis: CountryBasis = 'residence'): Promise<CountryStatsRow[]> {
    const allowed = await countriesFor(adminId)
    if (!await countryColumnsReady()) throw new CountrySchemaMissingError()
    const rows = [...await countryStatsCache.get(basis, () => loadStats(basis))]
    return allowed === 'all' ? rows : rows.filter((row) => row.code !== null && allowed.includes(row.code))
  }

  /** One country's totals, last 12 weeks and departments (null = members / organizations with no country). */
  async function getCountryDetail(adminId: string, code: CountryKey, basis: CountryBasis = 'residence'): Promise<CountryDetail> {
    if (code !== null && !isCountryCode(code)) throw new Error('country_unknown')
    const allowed = await countriesFor(adminId)
    if (allowed !== 'all' && (code === null || !allowed.includes(code))) throw new Error('country_out_of_scope')
    if (!await countryColumnsReady()) throw new CountrySchemaMissingError()
    return countryDetailCache.get(`${basis}:${code ?? ''}`, () => loadDetail(basis, code))
  }

  /**
   * Each listed member's country and where it came from, for an admin list (estimates marked by their source).
   * Platform administrators only: member lists are never shown to country admins.
   */
  async function memberCountries(adminId: string, profileIds: readonly string[]): Promise<Map<string, MemberCountry>> {
    await authorize(adminId)
    const ids = [...new Set(profileIds)]
    if (!ids.length) return new Map()
    const withCountryColumns = await countryColumnsReady()
    const rows = await query(
      `with ${memberCountryCtes({ namesParam: 1, dialsParam: 2, profileIdsParam: 3, withCountryColumns })}
       select profile_id, code, source from member_country`,
      [...memberCountryValues(), ids],
    )
    return new Map(rows.map((row) => [String(row.profile_id), {
      code: key(row.code),
      source: (key(row.source) as MemberCountrySource | null),
    }]))
  }

  function clearCaches() {
    countryStatsCache.clear()
    countryDetailCache.clear()
  }

  return { listCountryStats, getCountryDetail, memberCountries, clearCaches }
}

export type AdminCountryRepository = ReturnType<typeof createAdminCountryRepository>

export const adminCountryRepository = createAdminCountryRepository()
