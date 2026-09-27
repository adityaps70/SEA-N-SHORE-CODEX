import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { OrganizationAccessRole } from '@/features/access/policy'
import { organizationSuspendedSql } from './access-request-repository'
import { isCompanySize, type CompanySize } from './organization-page-profile'
import { displayOrganizationType, resolveOrganizationType, type OrganizationTypeCode } from './organization-types'
import { parseOrganizationDetails } from './schemas'
import type { OrganizationDetails } from './types'

type WorkspaceQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type WorkspaceRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  logo_path: string | null
  company_type: string | null
  organization_type?: string | null
  organization_details?: unknown
  website: string | null
  description: string | null
  fleet_summary: string | null
  vessel_types: string[] | null
  office_locations: string[] | null
  is_verified: boolean | null
  cover_path?: string | null
  tagline?: string | null
  company_size?: string | null
  specialties?: string[] | null
}

type OrganizationCardRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  logo_path: string | null
  cover_path: string | null
  tagline: string | null
  description: string | null
  company_type: string | null
  organization_type: string | null
  headquarters: string | null
  is_verified: boolean | null
  follower_count: string | number | null
  following: boolean | null
}

type PersonRow = QueryResultRow & {
  id: string
  full_name: string
  slug: string | null
  headline: string | null
  avatar_path: string | null
  member_role: string | null
}

type MemberRow = QueryResultRow & {
  user_id: string
  full_name: string
  slug: string | null
  role: string
  approved_at: string | Date
}

type FollowStateRow = QueryResultRow & {
  follower_count: string | number | null
  following: boolean | null
}

type MetricsRow = QueryResultRow & {
  published_jobs: string | number | null
  applications: string | number | null
  published_events: string | number | null
  attendees: string | number | null
  published_courses: string | number | null
  enrollments: string | number | null
}

export type OrganizationWorkspace = {
  id: string
  slug: string
  name: string
  logoPath: string | null
  /** Display label for the organization type. */
  companyType: string | null
  organizationType: OrganizationTypeCode
  details: OrganizationDetails
  website: string | null
  description: string | null
  fleetSummary: string | null
  vesselTypes: string[]
  officeLocations: string[]
  verified: boolean
  coverPath: string | null
  tagline: string | null
  companySize: CompanySize | null
  specialties: string[]
}

/** Compact organization summary for cards (hub, discovery, "Pages people also viewed"). */
export type OrganizationCard = {
  id: string
  slug: string
  name: string
  logoPath: string | null
  coverPath: string | null
  tagline: string | null
  description: string | null
  companyType: string
  organizationType: OrganizationTypeCode
  headquarters: string | null
  verified: boolean
  followerCount: number
  following: boolean
}

/** Someone shown on an organization's People tab. Public profile fields only. */
export type OrganizationPerson = {
  id: string
  fullName: string
  slug: string | null
  headline: string | null
  avatarPath: string | null
  /** Set for approved team members; null for people who list the organization on their profile. */
  memberRole: OrganizationAccessRole | null
}

export type OrganizationWorkspaceMember = {
  userId: string
  fullName: string
  slug: string | null
  role: OrganizationAccessRole
  approvedAt: string
}

export type OrganizationWorkspaceMetrics = {
  publishedJobs: number
  applications: number
  publishedEvents: number
  attendees: number
  publishedCourses: number
  enrollments: number
}

export type OrganizationBrandingInput = {
  website: string | null
  description: string | null
  fleetSummary: string | null
  vesselTypes: string[]
  officeLocations: string[]
  /** Page details; when all three are omitted the stored values are kept. */
  tagline?: string | null
  companySize?: CompanySize | null
  specialties?: string[]
  /** Wellbeing details to merge into organization_details; omitted for other types. */
  supportDetails?: {
    servicesOffered: string[]
    languages: string[]
    helpline24x7: boolean | null
  }
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
    || value === 'member'
  ) return value
  return 'member'
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function number(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapWorkspace(row: WorkspaceRow): OrganizationWorkspace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoPath: row.logo_path ?? null,
    companyType: row.company_type || row.organization_type
      ? displayOrganizationType(row.organization_type, row.company_type)
      : null,
    organizationType: resolveOrganizationType(row.organization_type, row.company_type).code,
    details: parseOrganizationDetails(row.organization_details),
    website: row.website ?? null,
    description: row.description ?? null,
    fleetSummary: row.fleet_summary ?? null,
    vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
    officeLocations: Array.isArray(row.office_locations) ? row.office_locations : [],
    verified: Boolean(row.is_verified),
    coverPath: row.cover_path ?? null,
    tagline: row.tagline?.trim() || null,
    companySize: isCompanySize(row.company_size) ? row.company_size : null,
    specialties: Array.isArray(row.specialties) ? row.specialties : [],
  }
}

function mapCard(row: OrganizationCardRow): OrganizationCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoPath: row.logo_path ?? null,
    coverPath: row.cover_path ?? null,
    tagline: row.tagline?.trim() || null,
    description: row.description ?? null,
    companyType: displayOrganizationType(row.organization_type, row.company_type),
    organizationType: resolveOrganizationType(row.organization_type, row.company_type).code,
    headquarters: row.headquarters ?? null,
    verified: Boolean(row.is_verified),
    followerCount: number(row.follower_count),
    following: Boolean(row.following),
  }
}

const WORKSPACE_COLUMNS = `id, slug, name, logo_path, cover_path, tagline, company_size, specialties,
              company_type, organization_type, organization_details,
              website, description, fleet_summary,
              vessel_types, office_locations, coalesce(is_verified, false) as is_verified`

/** Card columns for `public.companies company`; $1 is the viewer. */
const CARD_COLUMNS = `company.id,
         company.slug,
         company.name,
         company.logo_path,
         company.cover_path,
         company.tagline,
         left(company.description, 400) as description,
         company.company_type,
         company.organization_type,
         company.office_locations[1] as headquarters,
         coalesce(company.is_verified, false) as is_verified,
         (select count(*) from public.organization_follows card_follow where card_follow.company_id = company.id) as follower_count,
         exists (
           select 1 from public.organization_follows viewer_follow
           where viewer_follow.company_id = company.id and viewer_follow.follower_id = $1
         ) as following`

/**
 * Everyone connected to organization $1: approved team members plus people whose
 * profile names it as their current company (maritime_profiles.current_company_id).
 */
const PEOPLE_SOURCE_SQL = `
  select member.user_id as profile_id, member.role::text as member_role
  from public.company_members member
  where member.company_id = $1
    and member.approved_at is not null
  union all
  select listed.user_id as profile_id, null as member_role
  from public.maritime_profiles listed
  where listed.current_company_id = $1`

export function createOrganizationWorkspaceRepository(input: {
  query?: WorkspaceQuery
} = {}) {
  const queryRows: WorkspaceQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function getBySlug(slug: string): Promise<OrganizationWorkspace | null> {
    const rows = await queryRows(
      `select ${WORKSPACE_COLUMNS}
       from public.companies
       where slug = $1
       limit 1`,
      [slug],
    ) as WorkspaceRow[]
    return rows[0] ? mapWorkspace(rows[0]) : null
  }

  async function getById(companyId: string): Promise<OrganizationWorkspace | null> {
    const rows = await queryRows(
      `select ${WORKSPACE_COLUMNS}
       from public.companies
       where id = $1
       limit 1`,
      [companyId],
    ) as WorkspaceRow[]
    return rows[0] ? mapWorkspace(rows[0]) : null
  }

  async function listMembers(companyId: string): Promise<OrganizationWorkspaceMember[]> {
    const rows = await queryRows(
      `select member.user_id, profile.full_name, profile.slug, member.role::text as role, member.approved_at
       from public.company_members member
       join public.profiles profile on profile.id = member.user_id
       where member.company_id = $1
         and member.approved_at is not null
       order by
         case member.role::text
           when 'owner' then 0
           when 'administrator' then 1
           when 'recruiter' then 2
           when 'lms_manager' then 3
           when 'event_manager' then 4
           when 'content_manager' then 5
           when 'analyst' then 6
           else 7
         end,
         profile.full_name asc,
         profile.id asc`,
      [companyId],
    ) as MemberRow[]

    return rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      slug: row.slug ?? null,
      role: role(row.role),
      approvedAt: iso(row.approved_at),
    }))
  }

  async function updateMemberRole(
    actorId: string,
    companyId: string,
    memberId: string,
    nextRole: Exclude<OrganizationAccessRole, 'owner'>,
  ) {
    return databaseTransaction(async (client: DatabaseQueryClient) => {
      const target = await client.query<{ role: string }>(
        `select role::text as role
         from public.company_members
         where company_id = $1 and user_id = $2 and approved_at is not null
         for update`,
        [companyId, memberId],
      )
      if (!target.rows[0]) throw new Error('organization_member_not_found')
      if (target.rows[0].role === 'owner') throw new Error('organization_owner_role_locked')

      const updated = await client.query<{ user_id: string }>(
        `update public.company_members
         set role = $3::public.company_member_role
         where company_id = $1 and user_id = $2 and approved_at is not null
         returning user_id`,
        [companyId, memberId, nextRole],
      )
      if (!updated.rows[0]) throw new Error('organization_member_not_found')

      await client.query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'organization.member_role_changed', 'company', $2, $3::jsonb)`,
        [
          actorId,
          companyId,
          JSON.stringify({ memberId, previousRole: target.rows[0].role, nextRole }),
        ],
      )
      return true
    })
  }

  async function updateBranding(companyId: string, input: OrganizationBrandingInput) {
    // Only the wellbeing keys are replaced; other stored details (accreditation,
    // licences, fleet size) stay as verified.
    const supportDetails = input.supportDetails
      ? JSON.stringify({
          servicesOffered: input.supportDetails.servicesOffered,
          languages: input.supportDetails.languages,
          helpline24x7: input.supportDetails.helpline24x7,
        })
      : null
    const rows = await queryRows(
      `update public.companies
       set website = $2,
           description = $3,
           fleet_summary = $4,
           vessel_types = $5::text[],
           office_locations = $6::text[],
           organization_details = case
             when $7::jsonb is null then organization_details
             else jsonb_strip_nulls(organization_details || $7::jsonb)
           end,
           tagline = case when $8::boolean then $9::text else tagline end,
           company_size = case when $8::boolean then $10::text else company_size end,
           specialties = case when $8::boolean then $11::text[] else specialties end,
           updated_at = now()
       where id = $1
       returning id`,
      [
        companyId,
        input.website,
        input.description,
        input.fleetSummary,
        input.vesselTypes,
        input.officeLocations,
        supportDetails,
        input.tagline !== undefined || input.companySize !== undefined || input.specialties !== undefined,
        input.tagline ?? null,
        input.companySize ?? null,
        input.specialties ?? [],
      ],
    )
    if (!rows[0]) throw new Error('organization_not_found')
    return true
  }

  async function updateLogoPath(companyId: string, logoPath: string | null) {
    const rows = await queryRows(
      `update public.companies set logo_path = $2, updated_at = now() where id = $1 returning id`,
      [companyId, logoPath],
    )
    if (!rows[0]) throw new Error('organization_not_found')
    return true
  }

  async function updateCoverPath(companyId: string, coverPath: string | null) {
    const rows = await queryRows(
      `update public.companies set cover_path = $2, updated_at = now() where id = $1 returning id`,
      [companyId, coverPath],
    )
    if (!rows[0]) throw new Error('organization_not_found')
    return true
  }

  /** Cards for the given organizations, in the order of `companyIds`. */
  async function listOrganizationCards(companyIds: string[], viewerId: string): Promise<OrganizationCard[]> {
    const ids = [...new Set(companyIds)]
    if (!ids.length) return []
    const rows = await queryRows(
      `select ${CARD_COLUMNS}
       from public.companies company
       where company.id = any($2::uuid[])`,
      [viewerId, ids],
    ) as OrganizationCardRow[]
    const byId = new Map(rows.map((row) => [row.id, mapCard(row)]))
    return ids.flatMap((id) => byId.get(id) ?? [])
  }

  /**
   * "Pages people also viewed": other organizations of the same type (or the same
   * stored label for older rows), verified first, then by followers.
   */
  async function listSimilarOrganizations(
    workspace: Pick<OrganizationWorkspace, 'id' | 'organizationType' | 'companyType'>,
    viewerId: string,
    limit = 4,
  ): Promise<OrganizationCard[]> {
    const rows = await queryRows(
      `select ${CARD_COLUMNS}
       from public.companies company
       where company.id <> $2
         and (
           company.organization_type = $3
           or (company.organization_type is null and $4::text is not null and lower(company.company_type) = lower($4::text))
         )
         and not ${organizationSuspendedSql('company.id')}
       order by coalesce(company.is_verified, false) desc, follower_count desc, company.name asc, company.id asc
       limit $5`,
      [viewerId, workspace.id, workspace.organizationType, workspace.companyType, Math.min(Math.max(Math.trunc(limit), 1), 12)],
    ) as OrganizationCardRow[]
    return rows.map(mapCard)
  }

  /** Verified organizations the viewer neither belongs to nor follows yet. */
  async function listDiscoverOrganizations(viewerId: string, limit = 6): Promise<OrganizationCard[]> {
    const rows = await queryRows(
      `select ${CARD_COLUMNS}
       from public.companies company
       where coalesce(company.is_verified, false) = true
         and not ${organizationSuspendedSql('company.id')}
         and not exists (
           select 1 from public.company_members discover_member
           where discover_member.company_id = company.id and discover_member.user_id = $1
         )
         and not exists (
           select 1 from public.organization_follows discover_follow
           where discover_follow.company_id = company.id and discover_follow.follower_id = $1
         )
       order by follower_count desc, company.name asc, company.id asc
       limit $2`,
      [viewerId, Math.min(Math.max(Math.trunc(limit), 1), 24)],
    ) as OrganizationCardRow[]
    return rows.map(mapCard)
  }

  /** "N people work here": team members plus people who list this organization, each counted once. */
  async function countPeople(companyId: string): Promise<number> {
    const rows = await queryRows(
      `select count(distinct people.profile_id) as people_count
       from (${PEOPLE_SOURCE_SQL}) people
       join public.profiles person on person.id = people.profile_id
       where person.account_status = 'active'`,
      [companyId],
    )
    return number(rows[0]?.people_count)
  }

  /** People tab: team members first (owners, then administrators), then people who list the organization. */
  async function listPeople(companyId: string, viewerId: string, limit = 60): Promise<OrganizationPerson[]> {
    const rows = await queryRows(
      `select id, full_name, slug, headline, avatar_path, member_role
       from (
         select distinct on (person.id)
           person.id,
           person.full_name,
           person.slug,
           person.headline,
           person.avatar_path,
           people.member_role
         from (${PEOPLE_SOURCE_SQL}) people
         join public.profiles person on person.id = people.profile_id
         where person.account_status = 'active'
           and not exists (
             select 1 from public.user_blocks block
             where (block.blocker_id = $2 and block.blocked_id = person.id)
                or (block.blocker_id = person.id and block.blocked_id = $2)
           )
         order by person.id, (people.member_role is null)
       ) listed_person
       order by
         (member_role is null),
         case member_role
           when 'owner' then 0
           when 'administrator' then 1
           else 2
         end,
         full_name asc,
         id asc
       limit $3`,
      [companyId, viewerId, Math.min(Math.max(Math.trunc(limit), 1), 200)],
    ) as PersonRow[]
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      slug: row.slug ?? null,
      headline: row.headline ?? null,
      avatarPath: row.avatar_path ?? null,
      memberRole: row.member_role ? role(row.member_role) : null,
    }))
  }

  /** Profile that receives messages sent to the organization: its longest-standing active owner. */
  async function getContactProfileId(companyId: string): Promise<string | null> {
    const rows = await queryRows(
      `select member.user_id
       from public.company_members member
       join public.profiles owner_profile on owner_profile.id = member.user_id
       where member.company_id = $1
         and member.approved_at is not null
         and member.role::text = 'owner'
         and owner_profile.account_status = 'active'
       order by member.approved_at asc, member.user_id asc
       limit 1`,
      [companyId],
    ) as Array<QueryResultRow & { user_id: string }>
    return rows[0]?.user_id ?? null
  }

  async function listFollowedOrganizations(followerId: string): Promise<OrganizationWorkspace[]> {
    const rows = await queryRows(
      `select
         company.id,
         company.slug,
         company.name,
         company.logo_path,
         company.company_type,
         company.organization_type,
         company.organization_details,
         company.website,
         company.description,
         company.fleet_summary,
         company.vessel_types,
         company.office_locations,
         company.cover_path,
         company.tagline,
         company.company_size,
         company.specialties,
         coalesce(company.is_verified, false) as is_verified
       from public.companies company
       join public.organization_follows follow
         on follow.company_id = company.id
       where follow.follower_id = $1
       order by follow.created_at desc, company.name asc, company.id asc`,
      [followerId],
    ) as WorkspaceRow[]
    return rows.map(mapWorkspace)
  }

  async function getFollowState(companyId: string, viewerId: string) {
    const rows = await queryRows(
      `select
         (select count(*) from public.organization_follows where company_id = $1) as follower_count,
         exists (
           select 1
           from public.organization_follows
           where company_id = $1 and follower_id = $2
         ) as following`,
      [companyId, viewerId],
    ) as FollowStateRow[]
    const row = rows[0]
    return {
      followerCount: number(row?.follower_count),
      following: Boolean(row?.following),
    }
  }

  async function followOrganization(followerId: string, companyId: string) {
    await queryRows(
      `insert into public.organization_follows (company_id, follower_id)
       values ($1, $2)
       on conflict do nothing`,
      [companyId, followerId],
    )
  }

  async function unfollowOrganization(followerId: string, companyId: string) {
    await queryRows(
      `delete from public.organization_follows
       where company_id = $1 and follower_id = $2`,
      [companyId, followerId],
    )
  }

  async function getMetrics(companyId: string): Promise<OrganizationWorkspaceMetrics> {
    const rows = await queryRows(
      `select
         (select count(*) from public.jobs job where job.company_id = $1 and job.status = 'published') as published_jobs,
         (select count(*) from public.job_applications application
            join public.jobs job on job.id = application.job_id
            where job.company_id = $1) as applications,
         (select count(*) from public.events event where event.company_id = $1 and event.status = 'published') as published_events,
         (select count(*) from public.event_attendees attendee
            join public.events event on event.id = attendee.event_id
            where event.company_id = $1) as attendees,
         (select count(*) from public.learning_courses course where course.company_id = $1 and course.status = 'published') as published_courses,
         (select count(*) from public.learning_enrollments enrollment
            join public.learning_courses course on course.id = enrollment.course_id
            where course.company_id = $1 and enrollment.status in ('active', 'completed')) as enrollments`,
      [companyId],
    ) as MetricsRow[]
    const row = rows[0] ?? {}
    return {
      publishedJobs: number(row.published_jobs),
      applications: number(row.applications),
      publishedEvents: number(row.published_events),
      attendees: number(row.attendees),
      publishedCourses: number(row.published_courses),
      enrollments: number(row.enrollments),
    }
  }

  return {
    getBySlug,
    getById,
    listMembers,
    updateMemberRole,
    updateBranding,
    updateLogoPath,
    updateCoverPath,
    listOrganizationCards,
    listSimilarOrganizations,
    listDiscoverOrganizations,
    countPeople,
    listPeople,
    getContactProfileId,
    listFollowedOrganizations,
    getFollowState,
    followOrganization,
    unfollowOrganization,
    getMetrics,
  }
}

export const organizationWorkspaceRepository = createOrganizationWorkspaceRepository()
