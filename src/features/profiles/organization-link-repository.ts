import type { OrganizationAccessRole } from '@/features/access/policy'
import { displayOrganizationType } from '@/features/organizations/organization-types'
import { organizationClaimStatusSql } from '@/features/organizations/unclaimed-organization-policy'
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
  claim_status?: string | null
}

type MembershipRow = OrganizationRow & { member_role: string }

export type MemberOrganizationShortcut = LinkedOrganization & {
  role: OrganizationAccessRole
}

/** An organization shown in the Organizations section of a profile. */
export type ProfileOrganization = OrganizationSearchResult & {
  role: OrganizationAccessRole
  /** Owners and administrators manage the page; everyone else works there. */
  relation: 'manages' | 'works_at'
}

/**
 * SQL condition for an organization that Sea N Shore lists to members: verified
 * organizations, public legacy pages that never went through an application and
 * unclaimed pages added by people who work there. Organizations whose
 * application is pending, awaiting changes, rejected or suspended are never
 * listed or linked, except that an unclaimed page stays listed while someone's
 * claim of it is reviewed (colleagues keep their link); a suspended one does not.
 */
export function listableOrganizationSql(alias: string) {
  return `(
    (
      ${organizationClaimStatusSql(alias)} = 'unclaimed'
      and not exists (
        select 1 from public.organization_applications suspended_application
        where suspended_application.company_id = ${alias}.id
          and suspended_application.status = 'suspended'
      )
    )
    or (
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
    unclaimed: row.claim_status === 'unclaimed',
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
  c.office_locations,
  ${organizationClaimStatusSql('c')} as claim_status
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

  /**
   * An organization the member registered or claimed that Sea N Shore is still
   * reviewing. It is not listed yet, but its applicant may already name it as
   * their current organization; the link shows once the page is verified.
   */
  async function getOwnPendingOrganization(userId: string, companyId: string): Promise<LinkedOrganization | null> {
    const rows = await query(
      `select ${ORGANIZATION_COLUMNS}
       from public.companies c
       join public.organization_applications application on application.company_id = c.id
       where c.id = $1
         and application.submitted_by = $2
         and application.status in ('pending', 'changes_requested')
       limit 1`,
      [companyId, userId],
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

  /**
   * Organizations on a member's profile: approved memberships of organizations
   * Sea N Shore lists, owners and administrators first. The organization's People
   * tab shows the same memberships to everyone.
   */
  async function listProfileOrganizations(profileId: string, limit = 12): Promise<ProfileOrganization[]> {
    const rows = await query(
      `select ${ORGANIZATION_COLUMNS}, cm.role::text as member_role
       from public.company_members cm
       join public.companies c on c.id = cm.company_id
       where cm.user_id = $1
         and cm.approved_at is not null
         and ${listableOrganizationSql('c')}
       order by
         case cm.role::text when 'owner' then 0 when 'administrator' then 1 else 2 end,
         coalesce(c.is_verified, false) desc,
         c.name asc,
         c.id asc
       limit $2`,
      [profileId, Math.min(Math.max(1, Math.trunc(limit)), 50)],
    ) as unknown as MembershipRow[]
    return rows.map((row) => {
      const memberRole = role(row.member_role)
      return {
        ...mapSearchResult(row),
        role: memberRole,
        relation: memberRole === 'owner' || memberRole === 'administrator' ? 'manages' : 'works_at',
      }
    })
  }

  return {
    searchListableOrganizations,
    getListableOrganization,
    getOwnPendingOrganization,
    listMemberOrganizations,
    listProfileOrganizations,
  }
}

export type OrganizationLinkRepository = ReturnType<typeof createOrganizationLinkRepository>

export const organizationLinkRepository = createOrganizationLinkRepository()
