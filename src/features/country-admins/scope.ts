import type { QueryResultRow } from 'pg'
import {
  allows,
  LEGACY_COUNTRY_ADMIN_PERMISSIONS,
  isCountryAdminSection,
  type CountryAdminLevel,
  type CountryAdminPermissions,
  type CountryAdminSection,
} from './sections'

/**
 * Round GP Part E: who may use an admin section, decided in SQL on every call (pages, lists and decisions).
 * - A platform administrator may use every section in every country.
 * - A country admin may use a section only when a platform administrator gave it to them (country_admin_permissions,
 *   migration 0113), at that level, and only for their own countries (country_admins.countries).
 * - Anyone else: admin_forbidden.
 * Before 0113 is applied, every country admin has what they had before sections existed (Organizations with
 * decisions, and Members by country). The table check runs as its own statement, so it never aborts a transaction.
 */
type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

export type SectionScope = { kind: 'platform' } | { kind: 'country'; countries: string[]; level: CountryAdminLevel }

export class SectionForbiddenError extends Error {
  constructor() {
    super('admin_forbidden')
    this.name = 'SectionForbiddenError'
  }
}

let permissionsTableSeen = false

/** True once country_admin_permissions exists (remembered for good; "missing" is checked again on every call). */
export async function permissionsTableReady(query: Query): Promise<boolean> {
  if (permissionsTableSeen) return true
  const rows = await query(`select to_regclass('public.country_admin_permissions') is not null as ready`)
  permissionsTableSeen = rows[0]?.ready === true
  return permissionsTableSeen
}

/** For tests: forget the remembered table check. */
export function resetPermissionsTableCheck() {
  permissionsTableSeen = false
}

const codes = (value: unknown) => (Array.isArray(value) ? value.filter((code): code is string => typeof code === 'string') : [])

async function countryAdminsTableReady(query: Query) {
  const rows = await query(`select to_regclass('public.country_admins') is not null as ready`)
  return rows[0]?.ready === true
}

/** A country admin's countries and sections, or null when the member is not a country admin. */
export async function loadCountryAdminAccess(query: Query, profileId: string): Promise<{ countries: string[]; permissions: CountryAdminPermissions } | null> {
  if (!await countryAdminsTableReady(query)) return null
  const rows = await query(`select countries from public.country_admins where profile_id = $1`, [profileId])
  const countries = codes(rows[0]?.countries)
  if (!countries.length) return null
  if (!await permissionsTableReady(query)) return { countries, permissions: { ...LEGACY_COUNTRY_ADMIN_PERMISSIONS } }
  const permissionRows = await query(`select section, can_act from public.country_admin_permissions where profile_id = $1`, [profileId])
  const permissions: CountryAdminPermissions = {}
  for (const row of permissionRows) {
    if (isCountryAdminSection(row.section)) permissions[row.section] = row.can_act === true ? 'act' : 'view'
  }
  return { countries, permissions }
}

/**
 * The caller's scope for one section at one level, or SectionForbiddenError. `lock` takes the platform role row
 * and the country admin row for update, so a decision and a role change never cross.
 */
export async function resolveSectionScope(
  query: Query,
  userId: string,
  section: CountryAdminSection,
  level: CountryAdminLevel,
  options: { lock?: boolean } = {},
): Promise<SectionScope> {
  // The same platform role check the admin repository has always run (isPlatformAdministratorWithQuery).
  const platform = await query(
    `select true as allowed
     from public.user_roles ur
     where ur.user_id = $1
       and ur.role::text = 'administrator'
     ${options.lock ? 'for update' : ''}
     limit 1`,
    [userId],
  )
  const platformRow = platform[0]
  if (platformRow && (platformRow.allowed === undefined || Boolean(platformRow.allowed))) return { kind: 'platform' }
  if (options.lock && await countryAdminsTableReady(query)) {
    await query(`select 1 from public.country_admins where profile_id = $1 for update`, [userId])
  }
  const access = await loadCountryAdminAccess(query, userId)
  if (!access || !allows(access.permissions, section, level)) throw new SectionForbiddenError()
  return { kind: 'country', countries: access.countries, level: access.permissions[section] ?? 'view' }
}

/** True when the item's country (null = not known) is one this scope covers. Unknown is platform-only. */
export function scopeCoversCountry(scope: SectionScope, country: string | null | undefined) {
  if (scope.kind === 'platform') return true
  return Boolean(country && scope.countries.includes(country))
}
