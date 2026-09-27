import type { OrganizationAccessRole } from '@/features/access/policy'
import { displayOrganizationType } from '@/features/organizations/organization-types'
import { query as databaseQuery } from '@/lib/db/client'
import {
  normalizeOrganizationSearchTerm,
  organizationLogoUrl,
  ORGANIZATION_SEARCH_LIMIT,
  ORGANIZATION_SEARCH_MIN_LENGTH,
  type LinkedOrganization,
  type OrganizationSearchResult,
} from './organization-link'

type QueryRow = Record<string, unknown>
type LinkQuery = (text: string, values?: readonly unknown[]) => Promise<QueryRow[]>

type OrganizationRow = {
  id: string
  slug: string
  name: string
  has_logo: boolean | null
  is_verified: boolean | null
  company_type?: string | null
  organization_type?: string | null
  office_locations?: string[] | null
}

type MembershipRow = OrganizationRow & { member_role: string }

export type MemberOrganizationShortcut = LinkedOrganization & {
  role: OrganizationAccessRole
}

/**
 * SQL condition for an organization that Sea N Shore lists to members: verified
 * organizations and public legacy pages that never went through an application.
 * Organizations whose application is pending, awaiting changes, rejected or
 * suspended are never listed or linked.
 */
export function listableOrganizationSql(alias: string) {
  return `(
    (coalesce(${alias}.is_verified, false)
      or not exists (
        select 1 from public.organization_applications listing_application
        where listing_application.company_id = ${alias}.id
      ))
    and not exists (
      select 1 from public.organization_applications blocked_application
      where blocked_application.company_id = ${alias}.id
        and blocked_application.status <> 'approved'
    )
  )`
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function role(value: string): OrganizationAccessRole {
  if (
    value === 'owner'
    || value === 'administrator'
    || value === 'recruiter'
    || value === 'lms_manager'
    || value === 'event_manager'
    || value === 'content_manager'
    || value === 'analyst'
  ) return value
  return 'member'
}

function mapOrganization(row: OrganizationRow): LinkedOrganization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: organizationLogoUrl(row.id, row.has_logo === true),
    verified: row.is_verified === true,
  }
}

function mapSearchResult(row: OrganizationRow): OrganizationSearchResult {
  const location = Array.isArray(row.office_locations)
    ? row.office_locations.find((entry: unknown): entry is string => typeof entry === 'string' && entry.trim() !== '') ?? null
    : null
  return {
    ...mapOrganization(row),
    type: row.company_type || row.organization_type
      ? displayOrganizationType(row.organization_type, row.company_type)
      : null,
    location: location?.trim() ?? null,
  }
}

const ORGANIZATION_COLUMNS = `
  c.id,
  c.slug,
  c.name,
  (c.logo_path is not null and btrim(c.logo_path) <> '') as has_logo,
  coalesce(c.is_verified, false) as is_verified,
  c.company_type,
  c.organization_type,
  c.office_locations
`

export function createOrganizationLinkRepository(input: { query?: LinkQuery } = {}) {
  const query: LinkQuery = input.query ?? ((text, values) => databaseQuery<QueryRow>(text, values))

  /** Type-ahead search over organizations listed on Sea N Shore. */
  async function searchListableOrganizations(term: string, limit = ORGANIZATION_SEARCH_LIMIT): Promise<OrganizationSearchResult[]> {
    const normalized = normalizeOrganizationSearchTerm(term)
    if (normalized.length < ORGANIZATION_SEARCH_MIN_LENGTH) return []
    const escaped = escapeLike(normalized)
    const rows = await query(
      `select ${ORGANIZATION_COLUMNS}
       from public.companies c
       where (c.name ilike $1 escape '\\' or coalesce(c.website, '') ilike $1 escape '\\')
         and ${listableOrganizationSql('c')}
       order by
         (lower(c.name) = lower($3)) desc,
         (c.name ilike $2 escape '\\') desc,
         coalesce(c.is_verified, false) desc,
         c.name asc,
         c.id asc
       limit $4`,
      [`%${escaped}%`, `${escaped}%`, normalized, Math.min(Math.max(1, limit), 20)],
    ) as unknown as OrganizationRow[]
    return rows.map(mapSearchResult)
  }

  /** The organization with this id, only when Sea N Shore lists it. */
  async function getListableOrganization(companyId: string): Promise<LinkedOrganization | null> {
    const rows = await query(
      `select ${ORGANIZATION_COLUMNS}
       from public.companies c
       where c.id = $1
         and ${listableOrganizationSql('c')}
       limit 1`,
      [companyId],
    ) as unknown as OrganizationRow[]
    return rows[0] ? mapOrganization(rows[0]) : null
  }

  /** Organizations the member belongs to (approved memberships), with logo details. */
  async function listMemberOrganizations(userId: string): Promise<MemberOrganizationShortcut[]> {
    const rows = await query(
      `select ${ORGANIZATION_COLUMNS}, cm.role::text as member_role
       from public.company_members cm
       join public.companies c on c.id = cm.company_id
       where cm.user_id = $1
         and cm.approved_at is not null
       order by
         case cm.role::text when 'owner' then 0 when 'administrator' then 1 else 2 end,
         c.name asc,
         c.id asc
       limit 20`,
      [userId],
    ) as unknown as MembershipRow[]
    return rows.map((row) => ({ ...mapOrganization(row), role: role(row.member_role) }))
  }

  return { searchListableOrganizations, getListableOrganization, listMemberOrganizations }
}

export type OrganizationLinkRepository = ReturnType<typeof createOrganizationLinkRepository>

export const organizationLinkRepository = createOrganizationLinkRepository()
