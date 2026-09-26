import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { OrganizationAccessRole } from '@/features/access/policy'

type WorkspaceQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type WorkspaceRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  logo_path: string | null
  company_type: string | null
  website: string | null
  description: string | null
  fleet_summary: string | null
  vessel_types: string[] | null
  office_locations: string[] | null
  is_verified: boolean | null
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
  companyType: string | null
  website: string | null
  description: string | null
  fleetSummary: string | null
  vesselTypes: string[]
  officeLocations: string[]
  verified: boolean
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
    companyType: row.company_type ?? null,
    website: row.website ?? null,
    description: row.description ?? null,
    fleetSummary: row.fleet_summary ?? null,
    vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
    officeLocations: Array.isArray(row.office_locations) ? row.office_locations : [],
    verified: Boolean(row.is_verified),
  }
}

export function createOrganizationWorkspaceRepository(input: {
  query?: WorkspaceQuery
} = {}) {
  const queryRows: WorkspaceQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function getBySlug(slug: string): Promise<OrganizationWorkspace | null> {
    const rows = await queryRows(
      `select id, slug, name, logo_path, company_type, website, description, fleet_summary,
              vessel_types, office_locations, coalesce(is_verified, false) as is_verified
       from public.companies
       where slug = $1
       limit 1`,
      [slug],
    ) as WorkspaceRow[]
    return rows[0] ? mapWorkspace(rows[0]) : null
  }

  async function getById(companyId: string): Promise<OrganizationWorkspace | null> {
    const rows = await queryRows(
      `select id, slug, name, logo_path, company_type, website, description, fleet_summary,
              vessel_types, office_locations, coalesce(is_verified, false) as is_verified
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
    const rows = await queryRows(
      `update public.companies
       set website = $2,
           description = $3,
           fleet_summary = $4,
           vessel_types = $5::text[],
           office_locations = $6::text[],
           updated_at = now()
       where id = $1
       returning id`,
      [companyId, input.website, input.description, input.fleetSummary, input.vesselTypes, input.officeLocations],
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

  async function listFollowedOrganizations(followerId: string): Promise<OrganizationWorkspace[]> {
    const rows = await queryRows(
      `select
         company.id,
         company.slug,
         company.name,
         company.logo_path,
         company.company_type,
         company.website,
         company.description,
         company.fleet_summary,
         company.vessel_types,
         company.office_locations,
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
    listFollowedOrganizations,
    getFollowState,
    followOrganization,
    unfollowOrganization,
    getMetrics,
  }
}

export const organizationWorkspaceRepository = createOrganizationWorkspaceRepository()
