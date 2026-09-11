import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'

export const ADMIN_ORGANIZATION_STATUSES = ['pending', 'changes_requested', 'approved', 'rejected', 'suspended'] as const
export type AdminOrganizationStatus = (typeof ADMIN_ORGANIZATION_STATUSES)[number]
export type AdminOrganizationDecision = Exclude<AdminOrganizationStatus, 'pending'>

export type AdminDashboardMetrics = {
  pendingOrganizations: number
  changesRequested: number
  approvedOrganizations: number
  suspendedOrganizations: number
  pendingAccessRequests: number
}

export type AdminOrganizationReview = {
  applicationId: string
  status: AdminOrganizationStatus
  officialEmail: string
  registrationReference: string | null
  applicantRole: string
  supportingNotes: string | null
  submittedAt: string
  updatedAt: string
  reviewedAt: string | null
  adminReviewNote: string | null
  company: {
    id: string
    slug: string
    name: string
    type: string | null
    website: string | null
    description: string | null
    fleetSummary: string | null
    vesselTypes: string[]
    officeLocations: string[]
    verified: boolean
  }
  applicant: {
    id: string
    fullName: string
    slug: string | null
    headline: string | null
    membershipRole: string | null
    membershipApprovedAt: string | null
  }
}

type AdminQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type AdminTransaction = <T>(work: (query: AdminQuery) => Promise<T>) => Promise<T>

type AdminAuthorizationRow = QueryResultRow & { allowed?: boolean }
type MetricsRow = QueryResultRow & {
  pending_organizations: string | number | null
  changes_requested: string | number | null
  approved_organizations: string | number | null
  suspended_organizations: string | number | null
  pending_access_requests: string | number | null
}
type OrganizationReviewRow = QueryResultRow & {
  application_id: string
  company_id: string
  submitted_by: string
  application_status: string
  official_email: string
  registration_reference: string | null
  applicant_role: string
  supporting_notes: string | null
  submitted_at: string
  updated_at: string
  reviewed_at: string | null
  admin_review_note: string | null
  company_slug: string
  company_name: string
  company_type: string | null
  website: string | null
  company_description: string | null
  fleet_summary: string | null
  vessel_types: string[] | null
  office_locations: string[] | null
  company_verified: boolean | null
  applicant_name: string
  applicant_slug: string | null
  applicant_headline: string | null
  membership_role: string | null
  membership_approved_at: string | null
}
type LockedOrganizationApplicationRow = QueryResultRow & {
  id: string
  company_id: string
  submitted_by: string
  status: string
}

const ORGANIZATION_REVIEW_SELECT = `
  select
    oa.id as application_id,
    oa.company_id,
    oa.submitted_by,
    oa.status as application_status,
    oa.official_email,
    oa.registration_reference,
    oa.applicant_role,
    oa.supporting_notes,
    oa.submitted_at,
    oa.updated_at,
    oa.reviewed_at,
    oa.admin_review_note,
    c.slug as company_slug,
    c.name as company_name,
    c.company_type,
    c.website,
    c.description as company_description,
    c.fleet_summary,
    c.vessel_types,
    c.office_locations,
    coalesce(c.is_verified, false) as company_verified,
    p.full_name as applicant_name,
    p.slug as applicant_slug,
    p.headline as applicant_headline,
    cm.role::text as membership_role,
    cm.approved_at as membership_approved_at
  from public.organization_applications oa
  join public.companies c on c.id = oa.company_id
  join public.profiles p on p.id = oa.submitted_by
  left join public.company_members cm
    on cm.company_id = oa.company_id and cm.user_id = oa.submitted_by
` as const

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function organizationStatus(value: string): AdminOrganizationStatus {
  if (ADMIN_ORGANIZATION_STATUSES.includes(value as AdminOrganizationStatus)) {
    return value as AdminOrganizationStatus
  }
  throw new Error('organization_review_status_invalid')
}

function mapOrganizationReview(row: OrganizationReviewRow): AdminOrganizationReview {
  return {
    applicationId: row.application_id,
    status: organizationStatus(row.application_status),
    officialEmail: row.official_email,
    registrationReference: row.registration_reference ?? null,
    applicantRole: row.applicant_role,
    supportingNotes: row.supporting_notes ?? null,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at ?? null,
    adminReviewNote: row.admin_review_note ?? null,
    company: {
      id: row.company_id,
      slug: row.company_slug,
      name: row.company_name,
      type: row.company_type ?? null,
      website: row.website ?? null,
      description: row.company_description ?? null,
      fleetSummary: row.fleet_summary ?? null,
      vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
      officeLocations: Array.isArray(row.office_locations) ? row.office_locations : [],
      verified: Boolean(row.company_verified),
    },
    applicant: {
      id: row.submitted_by,
      fullName: row.applicant_name,
      slug: row.applicant_slug ?? null,
      headline: row.applicant_headline ?? null,
      membershipRole: row.membership_role ?? null,
      membershipApprovedAt: row.membership_approved_at ?? null,
    },
  }
}

function defaultTransaction<T>(work: (query: AdminQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

export function createAdminRepository(input: { query?: AdminQuery; transaction?: AdminTransaction } = {}) {
  const queryRows: AdminQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? defaultTransaction

  async function isPlatformAdministratorWithQuery(query: AdminQuery, userId: string, lock = false) {
    const rows = await query(
      `select true as allowed
       from public.user_roles ur
       where ur.user_id = $1
         and ur.role::text = 'administrator'
       ${lock ? 'for update' : ''}
       limit 1`,
      [userId],
    ) as AdminAuthorizationRow[]
    const row = rows[0]
    if (!row) return false
    return row.allowed === undefined ? true : Boolean(row.allowed)
  }

  async function requirePlatformAdministrator(query: AdminQuery, userId: string, lock = false) {
    if (!await isPlatformAdministratorWithQuery(query, userId, lock)) throw new Error('admin_forbidden')
  }

  async function isPlatformAdministrator(userId: string) {
    return isPlatformAdministratorWithQuery(queryRows, userId)
  }

  async function getAdminDashboardMetrics(userId: string): Promise<AdminDashboardMetrics> {
    await requirePlatformAdministrator(queryRows, userId)
    const rows = await queryRows(
      `select
         count(*) filter (where oa.status = 'pending') as pending_organizations,
         count(*) filter (where oa.status = 'changes_requested') as changes_requested,
         count(*) filter (where oa.status = 'approved') as approved_organizations,
         count(*) filter (where oa.status = 'suspended') as suspended_organizations,
         (select count(*) from public.company_access_requests car where car.status = 'pending') as pending_access_requests
       from public.organization_applications oa`,
    ) as MetricsRow[]
    const row = rows[0]
    return {
      pendingOrganizations: numberValue(row?.pending_organizations),
      changesRequested: numberValue(row?.changes_requested),
      approvedOrganizations: numberValue(row?.approved_organizations),
      suspendedOrganizations: numberValue(row?.suspended_organizations),
      pendingAccessRequests: numberValue(row?.pending_access_requests),
    }
  }

  async function listOrganizationApplications(userId: string, status: AdminOrganizationStatus): Promise<AdminOrganizationReview[]> {
    await requirePlatformAdministrator(queryRows, userId)
    const rows = await queryRows(
      `${ORGANIZATION_REVIEW_SELECT}
       where oa.status = $1
       order by oa.submitted_at asc, oa.id asc
       limit 100`,
      [status],
    ) as OrganizationReviewRow[]
    return rows.map(mapOrganizationReview)
  }

  async function getOrganizationApplicationReview(userId: string, applicationId: string): Promise<AdminOrganizationReview | null> {
    await requirePlatformAdministrator(queryRows, userId)
    const rows = await queryRows(
      `${ORGANIZATION_REVIEW_SELECT}
       where oa.id = $1
       limit 1`,
      [applicationId],
    ) as OrganizationReviewRow[]
    return rows[0] ? mapOrganizationReview(rows[0]) : null
  }

  async function reviewOrganizationApplication(
    adminId: string,
    applicationId: string,
    decision: AdminOrganizationDecision,
    reviewerNote: string | null,
  ) {
    return transaction(async (txQuery) => {
      await requirePlatformAdministrator(txQuery, adminId, true)

      const lockedRows = await txQuery(
        `select id, company_id, submitted_by, status
         from public.organization_applications
         where id = $1
         for update`,
        [applicationId],
      ) as LockedOrganizationApplicationRow[]
      const application = lockedRows[0]
      if (!application) throw new Error('organization_application_not_found')

      const transitionAllowed = application.status === 'pending'
        ? ['approved', 'changes_requested', 'rejected'].includes(decision)
        : application.status === 'approved' && decision === 'suspended'
      if (!transitionAllowed) throw new Error('organization_review_transition_forbidden')

      if (decision === 'approved') {
        await txQuery(
          `update public.companies
           set is_verified = true,
               verified_at = now(),
               verified_by = $2,
               updated_at = now()
           where id = $1`,
          [application.company_id, adminId],
        )
        await txQuery(
          `update public.company_members
           set approved_at = coalesce(approved_at, now()),
               is_verified = true,
               verified_at = coalesce(verified_at, now()),
               verified_by = $3
           where company_id = $1
             and user_id = $2
             and role::text = 'owner'`,
          [application.company_id, application.submitted_by, adminId],
        )
      } else if (decision === 'suspended') {
        await txQuery(
          `update public.companies
           set is_verified = false,
               verified_at = null,
               verified_by = null,
               updated_at = now()
           where id = $1`,
          [application.company_id],
        )
        await txQuery(
          `update public.company_members
           set is_verified = false,
               verified_at = null,
               verified_by = null
           where company_id = $1`,
          [application.company_id],
        )
      }

      await txQuery(
        `update public.organization_applications
         set status = $2,
             reviewed_by = $3,
             reviewed_at = now(),
             admin_review_note = $4,
             updated_at = now()
         where id = $1`,
        [applicationId, decision, adminId, reviewerNote],
      )

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          adminId,
          `organization.${decision}`,
          'organization_application',
          applicationId,
          JSON.stringify({
            companyId: application.company_id,
            submittedBy: application.submitted_by,
            previousStatus: application.status,
            decision,
            reviewerNote,
          }),
        ],
      )

      return true
    })
  }

  return {
    isPlatformAdministrator,
    getAdminDashboardMetrics,
    listOrganizationApplications,
    getOrganizationApplicationReview,
    reviewOrganizationApplication,
  }
}

export type AdminRepository = ReturnType<typeof createAdminRepository>

export const adminRepository = createAdminRepository()
