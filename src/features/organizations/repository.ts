import type { QueryResultRow } from 'pg'
import type { OrganizationAccessRole } from '@/features/access/policy'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  COMPANY_ACCESS_REQUEST_ROLES,
  COMPANY_ACCESS_REQUEST_STATUSES,
  COMPANY_ACCESS_REQUEST_TYPES,
  ORGANIZATION_APPLICATION_STATUSES,
  type CompanyAccessRequestRole,
  type CompanyAccessRequestStatus,
  type CompanyAccessRequestSummary,
  type CompanyAccessRequestType,
  type CompanySearchResult,
  type OrganizationApplicationInput,
  type OrganizationApplicationStatus,
  type UserOrganizationState,
} from './types'

export type { OrganizationApplicationInput } from './types'

type OrganizationQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type OrganizationTransaction = <T>(work: (query: OrganizationQuery) => Promise<T>) => Promise<T>

type OrganizationStateRow = QueryResultRow & {
  application_id: string
  application_status: string
  submitted_at: string
  updated_at: string
  admin_review_note: string | null
  company_id: string
  company_slug: string
  company_name: string
  company_verified: boolean | null
  member_role: string | null
  member_approved_at: string | null
}

type OrganizationApplicationDetailRow = QueryResultRow & {
  application_id: string
  organization_name: string
  organization_type: string | null
  website: string | null
  official_email: string
  office_locations: string[] | null
  description: string | null
  fleet_summary: string | null
  vessel_types: string[] | null
  applicant_role: string
  registration_reference: string | null
  supporting_notes: string | null
}

type CompanySearchRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  company_type: string | null
  is_verified: boolean | null
  website: string | null
}

type ReturningCompanyRow = QueryResultRow & { id: string; slug: string }
type ReturningIdRow = QueryResultRow & { id: string }
type CompanyAccessRequestRow = QueryResultRow & {
  request_id: string
  status: string
  requested_role: string
  request_type: string
  message: string | null
  requested_at: string
  reviewed_at: string | null
  reviewer_note: string | null
  company_id: string
  company_slug: string
  company_name: string
  company_verified: boolean | null
}
type ExistingMembershipRow = QueryResultRow & {
  role: string
  approved_at: string | null
}
type UserOrganizationMembershipRow = QueryResultRow & {
  company_id: string
  company_slug: string
  company_name: string
  company_verified: boolean | null
  member_role: string
}

export type UserOrganizationMembershipSummary = {
  id: string
  slug: string
  name: string
  verified: boolean
  role: OrganizationAccessRole
}
type LockedApplicationRow = QueryResultRow & {
  id: string
  company_id: string
  status: string
  submitted_by: string
}

function runtimeTransaction<T>(work: (query: OrganizationQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function organizationSlug(name: string, actorId: string) {
  const suffix = actorId.replace(/-/g, '').slice(0, 8).toLowerCase() || 'company'
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'organization'
  const maximumBaseLength = Math.max(1, 80 - suffix.length - 1)
  return `${base.slice(0, maximumBaseLength).replace(/-+$/g, '')}-${suffix}`
}

function applicationStatus(value: string): OrganizationApplicationStatus {
  if (ORGANIZATION_APPLICATION_STATUSES.includes(value as OrganizationApplicationStatus)) {
    return value as OrganizationApplicationStatus
  }
  throw new Error('organization_application_status_invalid')
}


function companyAccessRequestStatus(value: string): CompanyAccessRequestStatus {
  if (COMPANY_ACCESS_REQUEST_STATUSES.includes(value as CompanyAccessRequestStatus)) {
    return value as CompanyAccessRequestStatus
  }
  throw new Error('company_access_request_status_invalid')
}

function companyAccessRequestRole(value: string): CompanyAccessRequestRole {
  if (COMPANY_ACCESS_REQUEST_ROLES.includes(value as CompanyAccessRequestRole)) {
    return value as CompanyAccessRequestRole
  }
  throw new Error('company_access_request_role_invalid')
}

function companyAccessRequestType(value: string): CompanyAccessRequestType {
  if (COMPANY_ACCESS_REQUEST_TYPES.includes(value as CompanyAccessRequestType)) {
    return value as CompanyAccessRequestType
  }
  throw new Error('company_access_request_type_invalid')
}

function organizationAccessRole(value: string): OrganizationAccessRole {
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

export function createOrganizationRepository(input: {
  query: OrganizationQuery
  transaction?: OrganizationTransaction
}) {
  const query = input.query
  const transaction = input.transaction ?? runtimeTransaction

  async function getUserOrganizationState(userId: string): Promise<UserOrganizationState> {
    const rows = await query(
      `select
         oa.id as application_id,
         oa.status as application_status,
         oa.submitted_at,
         oa.updated_at,
         oa.admin_review_note,
         c.id as company_id,
         c.slug as company_slug,
         c.name as company_name,
         coalesce(c.is_verified, false) as company_verified,
         cm.role::text as member_role,
         cm.approved_at as member_approved_at
       from public.organization_applications oa
       join public.companies c on c.id = oa.company_id
       left join public.company_members cm
         on cm.company_id = c.id and cm.user_id = $1
       where oa.submitted_by = $1
       order by oa.updated_at desc, oa.id desc
       limit 1`,
      [userId],
    ) as OrganizationStateRow[]

    const row = rows[0]
    if (!row) return { kind: 'none' }

    return {
      kind: 'application',
      applicationId: row.application_id,
      status: applicationStatus(row.application_status),
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
      adminReviewNote: row.admin_review_note ?? null,
      company: {
        id: row.company_id,
        slug: row.company_slug,
        name: row.company_name,
        verified: Boolean(row.company_verified),
      },
      membership: row.member_role
        ? { role: row.member_role, approvedAt: row.member_approved_at ?? null }
        : null,
    }
  }

  async function getOrganizationApplication(userId: string, applicationId: string): Promise<OrganizationApplicationInput | null> {
    const rows = await query(
      `select
         oa.id as application_id,
         c.name as organization_name,
         c.company_type as organization_type,
         c.website,
         oa.official_email,
         c.office_locations,
         c.description,
         c.fleet_summary,
         c.vessel_types,
         oa.applicant_role,
         oa.registration_reference,
         oa.supporting_notes
       from public.organization_applications oa
       join public.companies c on c.id = oa.company_id
       where oa.submitted_by = $1
         and oa.id = $2
       limit 1`,
      [userId, applicationId],
    ) as OrganizationApplicationDetailRow[]
    const row = rows[0]
    if (!row) return null

    return {
      organizationName: row.organization_name,
      organizationType: row.organization_type ?? '',
      website: row.website ?? null,
      officialEmail: row.official_email,
      officeLocation: Array.isArray(row.office_locations) ? row.office_locations[0] ?? '' : '',
      description: row.description ?? '',
      fleetSummary: row.fleet_summary ?? null,
      vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
      applicantRole: row.applicant_role,
      registrationReference: row.registration_reference ?? null,
      supportingNotes: row.supporting_notes ?? null,
    }
  }

  async function submitOrganizationApplication(userId: string, data: OrganizationApplicationInput) {
    return transaction(async (txQuery) => {
      const slug = organizationSlug(data.organizationName, userId)
      const companyRows = await txQuery(
        `insert into public.companies (
           slug, name, company_type, website, description, fleet_summary,
           vessel_types, office_locations, created_by, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9, now(), now())
         returning id, slug`,
        [
          slug,
          data.organizationName,
          data.organizationType,
          data.website,
          data.description,
          data.fleetSummary,
          data.vesselTypes,
          [data.officeLocation],
          userId,
        ],
      ) as ReturningCompanyRow[]
      const company = companyRows[0]
      if (!company) throw new Error('organization_company_create_failed')

      await txQuery(
        `insert into public.company_members (company_id, user_id, role, approved_at, created_at)
         values ($1, $2, $3::public.company_member_role, $4, now())`,
        [company.id, userId, 'owner', null],
      )

      const applicationRows = await txQuery(
        `insert into public.organization_applications (
           company_id, submitted_by, status, official_email, registration_reference,
           applicant_role, supporting_notes, submitted_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, now(), now())
         returning id`,
        [
          company.id,
          userId,
          'pending',
          data.officialEmail.toLowerCase(),
          data.registrationReference,
          data.applicantRole,
          data.supportingNotes,
        ],
      ) as ReturningIdRow[]
      const application = applicationRows[0]
      if (!application) throw new Error('organization_application_create_failed')

      return { companyId: company.id, applicationId: application.id }
    })
  }

  async function resubmitOrganizationApplication(
    userId: string,
    applicationId: string,
    data: OrganizationApplicationInput,
  ) {
    return transaction(async (txQuery) => {
      const lockedRows = await txQuery(
        `select id, company_id, status, submitted_by
         from public.organization_applications
         where id = $1 and submitted_by = $2
         for update`,
        [applicationId, userId],
      ) as LockedApplicationRow[]
      const application = lockedRows[0]
      if (!application || application.submitted_by !== userId) throw new Error('organization_application_not_found')
      if (!['changes_requested', 'rejected'].includes(application.status)) {
        throw new Error('organization_resubmit_forbidden')
      }

      await txQuery(
        `update public.companies
         set name = $2,
             company_type = $3,
             website = $4,
             description = $5,
             fleet_summary = $6,
             vessel_types = $7::text[],
             office_locations = $8::text[],
             updated_at = now()
         where id = $1`,
        [
          application.company_id,
          data.organizationName,
          data.organizationType,
          data.website,
          data.description,
          data.fleetSummary,
          data.vesselTypes,
          [data.officeLocation],
        ],
      )

      const updatedRows = await txQuery(
        `update public.organization_applications
         set status = 'pending',
             official_email = $2,
             registration_reference = $3,
             applicant_role = $4,
             supporting_notes = $5,
             submitted_at = now(),
             updated_at = now(),
             reviewed_by = null,
             reviewed_at = null,
             admin_review_note = null
         where id = $1 and submitted_by = $6
         returning id`,
        [
          applicationId,
          data.officialEmail.toLowerCase(),
          data.registrationReference,
          data.applicantRole,
          data.supportingNotes,
          userId,
        ],
      ) as ReturningIdRow[]

      return updatedRows[0]?.id === applicationId
    })
  }

  async function requestCompanyAccess(
    userId: string,
    companyId: string,
    requestedRole: CompanyAccessRequestRole,
    message: string | null,
  ) {
    return transaction(async (txQuery) => {
      const companyRows = await txQuery(
        `select id
         from public.companies
         where id = $1
         limit 1`,
        [companyId],
      ) as ReturningIdRow[]
      if (!companyRows[0]) throw new Error('organization_company_not_found')

      const membershipRows = await txQuery(
        `select role::text as role, approved_at
         from public.company_members
         where company_id = $1 and user_id = $2
         limit 1`,
        [companyId, userId],
      ) as ExistingMembershipRow[]
      if (membershipRows[0]) throw new Error('organization_membership_exists')

      const requestType: CompanyAccessRequestType = requestedRole === 'member'
        ? 'join_company'
        : requestedRole === 'recruiter' || requestedRole === 'administrator'
          ? 'recruiter_access'
          : 'role_access'

      const rows = await txQuery(
        `insert into public.company_access_requests (
           company_id, user_id, requested_role, request_type, message, status, requested_at
         )
         values ($1, $2, $3::public.company_member_role, $4, $5, 'pending', now())
         on conflict (company_id, user_id, requested_role)
           where status = 'pending'
         do nothing
         returning id`,
        [companyId, userId, requestedRole, requestType, message],
      ) as ReturningIdRow[]
      const request = rows[0]
      if (!request) throw new Error('organization_access_request_exists')
      return { requestId: request.id }
    })
  }

  async function listUserAccessRequests(userId: string): Promise<CompanyAccessRequestSummary[]> {
    const rows = await query(
      `select
         car.id as request_id,
         car.status,
         car.requested_role::text as requested_role,
         car.request_type,
         car.message,
         car.requested_at,
         car.reviewed_at,
         car.reviewer_note,
         c.id as company_id,
         c.slug as company_slug,
         c.name as company_name,
         coalesce(c.is_verified, false) as company_verified
       from public.company_access_requests car
       join public.companies c on c.id = car.company_id
       where car.user_id = $1
       order by car.requested_at desc, car.id desc
       limit 100`,
      [userId],
    ) as CompanyAccessRequestRow[]

    return rows.map((row) => ({
      id: row.request_id,
      status: companyAccessRequestStatus(row.status),
      requestedRole: companyAccessRequestRole(row.requested_role),
      requestType: companyAccessRequestType(row.request_type),
      message: row.message ?? null,
      requestedAt: row.requested_at,
      reviewedAt: row.reviewed_at ?? null,
      reviewerNote: row.reviewer_note ?? null,
      company: {
        id: row.company_id,
        slug: row.company_slug,
        name: row.company_name,
        verified: Boolean(row.company_verified),
      },
    }))
  }

  async function listUserOrganizations(userId: string): Promise<UserOrganizationMembershipSummary[]> {
    const rows = await query(
      `select
         c.id as company_id,
         c.slug as company_slug,
         c.name as company_name,
         coalesce(c.is_verified, false) as company_verified,
         cm.role::text as member_role
       from public.company_members cm
       join public.companies c on c.id = cm.company_id
       where cm.user_id = $1
         and cm.approved_at is not null
       order by c.name asc, c.id asc`,
      [userId],
    ) as UserOrganizationMembershipRow[]

    return rows.map((row) => ({
      id: row.company_id,
      slug: row.company_slug,
      name: row.company_name,
      verified: Boolean(row.company_verified),
      role: organizationAccessRole(row.member_role),
    }))
  }

  async function searchCompanies(term: string): Promise<CompanySearchResult[]> {
    const normalized = term.trim()
    if (normalized.length < 2) return []
    const rows = await query(
      `select id, slug, name, company_type, coalesce(is_verified, false) as is_verified, website
       from public.companies
       where name ilike $1 or coalesce(website, '') ilike $1
       order by is_verified desc, name asc, id asc
       limit 20`,
      [`%${normalized}%`],
    ) as CompanySearchRow[]

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      companyType: row.company_type ?? null,
      verified: Boolean(row.is_verified),
      website: row.website ?? null,
    }))
  }

  return {
    getUserOrganizationState,
    getOrganizationApplication,
    submitOrganizationApplication,
    resubmitOrganizationApplication,
    requestCompanyAccess,
    listUserAccessRequests,
    listUserOrganizations,
    searchCompanies,
  }
}

export type OrganizationRepository = ReturnType<typeof createOrganizationRepository>

export function createOrganizationRepositoryForClient(client: DatabaseQueryClient) {
  return createOrganizationRepository({
    query: async (text, values) => (await client.query(text, values)).rows,
    transaction: async (work) => work(async (text, values) => (await client.query(text, values)).rows),
  })
}

export const organizationRepository = createOrganizationRepository({
  query: async (text, values) => databaseQuery(text, values),
})
