import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  ORGANIZATION_APPLICATION_STATUSES,
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
    submitOrganizationApplication,
    resubmitOrganizationApplication,
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
