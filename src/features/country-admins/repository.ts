import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { isCountryCode } from '@/features/countries/catalog'
import { actorRoleFor, recordAdminAudit } from '@/features/admin/admin-audit'
import { loadCountryAdminAccess, permissionsTableReady } from './scope'
import {
  DEFAULT_COUNTRY_ADMIN_PERMISSIONS,
  LEGACY_COUNTRY_ADMIN_PERMISSIONS,
  LIVE_COUNTRY_ADMIN_SECTIONS,
  isCountryAdminSection,
  normalisePermissions,
  type CountryAdminPermissions,
} from './sections'

/**
 * Round GP (Global Partners), Part C: country admins. A platform administrator makes an existing member a country
 * admin for one or more countries; the member then reviews organizations from those countries and sees their
 * Members by country numbers, nothing else. Country admins are never in public.user_roles, so every platform admin
 * check in the app keeps refusing them.
 *
 * Every grant, change and removal is written to the audit trail. Before migration 0110 the table is missing: a
 * member is then simply not a country admin, and the management actions say so.
 */
type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export const COUNTRY_ADMIN_MAX_COUNTRIES = 50
/** How stale "last active" may be before a visit writes it again. */
const ACTIVE_TOUCH_MINUTES = 5

export type CountryAdminEntry = {
  profileId: string
  fullName: string
  slug: string | null
  countries: string[]
  /** Round GP Part E: the sections a platform administrator opened to them, each "view" or "act". */
  permissions: CountryAdminPermissions
  grantedAt: string
  updatedAt: string
  lastActiveAt: string | null
}

export type CountryAdminMember = { id: string; fullName: string; slug: string | null; isPlatformAdministrator: boolean; countries: string[] | null }

export class CountryAdminError extends Error {
  constructor(code: 'admin_forbidden' | 'member_not_found' | 'member_is_platform_admin' | 'countries_invalid' | 'permissions_invalid' | 'country_admins_unavailable' | 'not_a_country_admin') {
    super(code)
    this.name = 'CountryAdminError'
  }
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows as Row[]))
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '')
const codes = (value: unknown) => (Array.isArray(value) ? value.filter((code): code is string => typeof code === 'string') : [])

/** Unique, sorted, listed codes; refuses an empty or oversized list. */
export function normaliseCountryAdminCountries(input: readonly string[]): string[] {
  const unique = [...new Set(input.map((code) => code.trim().toUpperCase()))].sort()
  if (!unique.length || unique.length > COUNTRY_ADMIN_MAX_COUNTRIES || !unique.every(isCountryCode)) {
    throw new CountryAdminError('countries_invalid')
  }
  return unique
}

/**
 * The permissions a platform administrator may save: only sections that are live in this release, cleaned by
 * normalisePermissions. Throws permissions_invalid when nothing is left.
 */
export function normaliseSavedPermissions(input: CountryAdminPermissions): CountryAdminPermissions {
  const live: Partial<Record<string, unknown>> = {}
  for (const [section, level] of Object.entries(input)) {
    if (isCountryAdminSection(section) && LIVE_COUNTRY_ADMIN_SECTIONS.includes(section)) live[section] = level
  }
  const permissions = normalisePermissions(live)
  if (!permissions) throw new CountryAdminError('permissions_invalid')
  return permissions
}

function isMissingTable(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '42P01')
}

export function createCountryAdminRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function requirePlatformAdministrator(run: Query, adminId: string) {
    const rows = await run(`select 1 as allowed from public.user_roles where user_id = $1 and role::text = 'administrator' limit 1`, [adminId])
    if (!rows[0]) throw new CountryAdminError('admin_forbidden')
  }

  /** The countries a member reviews as a country admin, or null when they are not one (or 0110 is not applied). */
  async function getCountries(profileId: string): Promise<string[] | null> {
    try {
      const rows = await query(`select countries from public.country_admins where profile_id = $1`, [profileId])
      const countries = codes(rows[0]?.countries)
      return countries.length ? countries : null
    } catch (error) {
      if (isMissingTable(error)) return null
      throw error
    }
  }

  /** Round GP Part E: a country admin's countries and sections, or null (also before migration 0110). */
  async function getAccess(profileId: string) {
    try {
      return await loadCountryAdminAccess(query, profileId)
    } catch (error) {
      if (isMissingTable(error)) return null
      throw error
    }
  }

  /** Records that a country admin used the console (at most once every few minutes). Never fails the request. */
  async function touchActive(profileId: string) {
    await query(
      `update public.country_admins
       set last_active_at = now()
       where profile_id = $1
         and (last_active_at is null or last_active_at < now() - make_interval(mins => $2::int))`,
      [profileId, ACTIVE_TOUCH_MINUTES],
    ).catch(() => undefined)
  }

  /** Every country admin, for Admin › Country admins (platform administrators only). */
  async function list(adminId: string): Promise<CountryAdminEntry[]> {
    await requirePlatformAdministrator(query, adminId)
    let rows: Row[]
    try {
      rows = await query(
        `select ca.profile_id, p.full_name, p.slug, ca.countries, ca.granted_at, ca.updated_at, ca.last_active_at
         from public.country_admins ca
         join public.profiles p on p.id = ca.profile_id
         order by p.full_name asc, ca.profile_id asc`,
      )
    } catch (error) {
      if (isMissingTable(error)) throw new CountryAdminError('country_admins_unavailable')
      throw error
    }
    const permissionsByProfile = new Map<string, CountryAdminPermissions>()
    if (rows.length && await permissionsTableReady(query)) {
      const permissionRows = await query(
        `select profile_id, section, can_act from public.country_admin_permissions where profile_id = any($1::uuid[])`,
        [rows.map((row) => String(row.profile_id))],
      )
      for (const row of permissionRows) {
        if (!isCountryAdminSection(row.section)) continue
        const entry = permissionsByProfile.get(String(row.profile_id)) ?? {}
        entry[row.section] = row.can_act === true ? 'act' : 'view'
        permissionsByProfile.set(String(row.profile_id), entry)
      }
    }
    const tableReady = await permissionsTableReady(query)
    return rows.map((row) => ({
      profileId: String(row.profile_id),
      fullName: String(row.full_name),
      slug: typeof row.slug === 'string' ? row.slug : null,
      countries: codes(row.countries),
      permissions: tableReady ? (permissionsByProfile.get(String(row.profile_id)) ?? {}) : { ...LEGACY_COUNTRY_ADMIN_PERMISSIONS },
      grantedAt: iso(row.granted_at),
      updatedAt: iso(row.updated_at),
      lastActiveAt: row.last_active_at ? iso(row.last_active_at) : null,
    }))
  }

  /**
   * One member by their exact username or sign-in email, for granting the role. Never a search: an exact match or
   * nothing, so the page cannot be used to list members.
   */
  async function findMember(adminId: string, identifier: string): Promise<CountryAdminMember | null> {
    await requirePlatformAdministrator(query, adminId)
    const value = identifier.trim().toLowerCase().replace(/^@/, '')
    if (!value || value.length > 320) return null
    const rows = await query(
      `select p.id, p.full_name, p.slug,
              exists (select 1 from public.user_roles r where r.user_id = p.id and r.role::text = 'administrator') as is_admin
       from public.profiles p
       where p.account_status = 'active'
         and (lower(p.slug) = $1
           or exists (select 1 from public.identity_accounts ia where ia.profile_id = p.id and lower(ia.email) = $1))
       order by p.created_at asc
       limit 2`,
      [value],
    )
    if (rows.length !== 1) return null
    const row = rows[0]!
    return {
      id: String(row.id),
      fullName: String(row.full_name),
      slug: typeof row.slug === 'string' ? row.slug : null,
      isPlatformAdministrator: row.is_admin === true,
      countries: await getCountries(String(row.id)),
    }
  }

  /** Makes a member a country admin, or changes their countries. Audited with the previous and new countries. */
  /**
   * Makes a member a country admin, or changes their countries and sections. A new country admin starts with
   * Organizations only unless sections are given (Round GP Part E). Audited with the previous and new countries and
   * sections.
   */
  async function grant(adminId: string, profileId: string, countries: readonly string[], permissions?: CountryAdminPermissions) {
    const next = normaliseCountryAdminCountries(countries)
    const requestedPermissions = permissions ? normaliseSavedPermissions(permissions) : null
    const withPermissions = await permissionsTableReady(query)
    return transaction(async (run) => {
      await requirePlatformAdministrator(run, adminId)
      const members = await run(
        `select p.id,
                exists (select 1 from public.user_roles r where r.user_id = p.id and r.role::text = 'administrator') as is_admin
         from public.profiles p where p.id = $1 and p.account_status = 'active' for update`,
        [profileId],
      )
      const member = members[0]
      if (!member) throw new CountryAdminError('member_not_found')
      if (member.is_admin === true) throw new CountryAdminError('member_is_platform_admin')
      let previous: string[] = []
      try {
        previous = codes((await run(`select countries from public.country_admins where profile_id = $1 for update`, [profileId]))[0]?.countries)
      } catch (error) {
        if (isMissingTable(error)) throw new CountryAdminError('country_admins_unavailable')
        throw error
      }
      await run(
        `insert into public.country_admins (profile_id, countries, granted_by)
         values ($1, $2::text[], $3)
         on conflict (profile_id) do update set countries = excluded.countries, updated_at = now()`,
        [profileId, next, adminId],
      )

      // Round GP Part E: sections. Before migration 0113 there is no table, and everyone has the legacy two sections.
      let previousPermissions: CountryAdminPermissions = previous.length ? { ...LEGACY_COUNTRY_ADMIN_PERMISSIONS } : {}
      let nextPermissions: CountryAdminPermissions = previousPermissions
      if (withPermissions) {
        previousPermissions = {}
        for (const row of await run(`select section, can_act from public.country_admin_permissions where profile_id = $1`, [profileId])) {
          if (isCountryAdminSection(row.section)) previousPermissions[row.section] = row.can_act === true ? 'act' : 'view'
        }
        const wanted = requestedPermissions ?? (previous.length ? null : DEFAULT_COUNTRY_ADMIN_PERMISSIONS)
        if (wanted) {
          // Only the live sections are replaced; a section a later release adds is kept as it was.
          await run(
            `delete from public.country_admin_permissions where profile_id = $1 and section = any($2::text[])`,
            [profileId, [...LIVE_COUNTRY_ADMIN_SECTIONS]],
          )
          for (const [section, level] of Object.entries(wanted)) {
            await run(
              `insert into public.country_admin_permissions (profile_id, section, can_act, granted_by)
               values ($1, $2, $3, $4)
               on conflict (profile_id, section) do update set can_act = excluded.can_act, granted_by = excluded.granted_by, granted_at = now()`,
              [profileId, section, level === 'act', adminId],
            )
          }
          nextPermissions = { ...Object.fromEntries(Object.entries(previousPermissions).filter(([section]) => !LIVE_COUNTRY_ADMIN_SECTIONS.includes(section as never))), ...wanted }
        } else {
          nextPermissions = previousPermissions
        }
      } else if (requestedPermissions) {
        throw new CountryAdminError('country_admins_unavailable')
      }

      await recordAdminAudit(run, {
        actorId: adminId,
        actorRole: actorRoleFor({ kind: 'platform' }),
        section: 'country_admins',
        country: null,
        action: previous.length ? 'country_admin.updated' : 'country_admin.granted',
        targetType: 'profile',
        targetId: profileId,
        metadata: { countries: next, previousCountries: previous, permissions: nextPermissions, previousPermissions },
      })
      return { countries: next, previousCountries: previous, permissions: nextPermissions, previousPermissions }
    })
  }

  /** Ends a member's country admin role. Audited with the countries they had. */
  async function remove(adminId: string, profileId: string) {
    return transaction(async (run) => {
      await requirePlatformAdministrator(run, adminId)
      let rows: Row[]
      try {
        rows = await run(`delete from public.country_admins where profile_id = $1 returning countries`, [profileId])
      } catch (error) {
        if (isMissingTable(error)) throw new CountryAdminError('country_admins_unavailable')
        throw error
      }
      if (!rows[0]) throw new CountryAdminError('not_a_country_admin')
      await recordAdminAudit(run, {
        actorId: adminId,
        actorRole: 'platform_admin',
        section: 'country_admins',
        country: null,
        action: 'country_admin.removed',
        targetType: 'profile',
        targetId: profileId,
        metadata: { previousCountries: codes(rows[0].countries) },
      })
      return true
    })
  }

  return { getCountries, getAccess, touchActive, list, findMember, grant, remove }
}

export type CountryAdminRepository = ReturnType<typeof createCountryAdminRepository>

export const countryAdminRepository = createCountryAdminRepository()
