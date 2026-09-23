import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { ModerationAction, ModerationReportStatus, ModerationTargetType } from '@/features/moderation/types'

export const ADMIN_ORGANIZATION_STATUSES = ['pending', 'changes_requested', 'approved', 'rejected', 'suspended'] as const
export type AdminOrganizationStatus = (typeof ADMIN_ORGANIZATION_STATUSES)[number]
export type AdminOrganizationDecision = Exclude<AdminOrganizationStatus, 'pending'>

export type AdminDashboardMetrics = {
  pendingOrganizations: number
  changesRequested: number
  approvedOrganizations: number
  suspendedOrganizations: number
  pendingAccessRequests: number
  openReports: number
  reviewingReports: number
  highPriorityReports: number
  reportsLast24h: number
  activePosts: number
  publishedJobs: number
  publishedEvents: number
}

export type AdminModerationCase = {
  targetType: ModerationTargetType
  targetId: string
  title: string
  excerpt: string | null
  owner: {
    id: string | null
    fullName: string
    slug: string | null
  }
  targetState: string
  reportCount: number
  firstReportedAt: string
  latestReportedAt: string
  reasons: string[]
  latestDetails: string | null
}

export type AdminModerationFilter = {
  status: ModerationReportStatus
  targetType: ModerationTargetType | 'all'
  limit: number
}

export type AdminAuditTargetType = ModerationTargetType | 'organization_application' | 'all'

export type AdminAuditEvent = {
  id: string
  actor: {
    id: string | null
    fullName: string
    slug: string | null
  }
  action: string
  targetType: string
  targetId: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type AdminAuditFilter = {
  targetType: AdminAuditTargetType
  limit: number
}

export const ADMIN_USER_STATUSES = ['active', 'restricted', 'suspended', 'deletion_requested'] as const
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number]
export type AdminUserStatusFilter = AdminUserStatus | 'all'

export type AdminUserSummary = {
  id: string
  fullName: string
  slug: string | null
  headline: string | null
  email: string | null
  cognitoSubject: string | null
  status: AdminUserStatus
  isAdministrator: boolean
  createdAt: string
  updatedAt: string
}

export type AdminUserSearch = {
  query: string
  status: AdminUserStatusFilter
  limit: number
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
  open_reports: string | number | null
  reviewing_reports: string | number | null
  high_priority_reports: string | number | null
  reports_last_24h: string | number | null
  active_posts: string | number | null
  published_jobs: string | number | null
  published_events: string | number | null
}
type ModerationCaseRow = QueryResultRow & {
  target_type: ModerationTargetType
  target_id: string
  target_title: string | null
  target_excerpt: string | null
  owner_id: string | null
  owner_name: string | null
  owner_slug: string | null
  target_state: string | null
  report_count: string | number
  first_reported_at: string
  latest_reported_at: string
  reasons: string[] | null
  latest_details: string | null
}
type ModerationReportLockRow = QueryResultRow & {
  id: string
  status: ModerationReportStatus
}
type ModerationTargetStateRow = QueryResultRow & {
  state: string
}
type ModerationActionRow = QueryResultRow & {
  action: ModerationAction
}
type AuditEventRow = QueryResultRow & {
  id: string
  actor_id: string | null
  actor_name: string | null
  actor_slug: string | null
  action: string
  target_type: string
  target_id: string
  metadata: Record<string, unknown> | null
  created_at: string
}
type AdminUserRow = QueryResultRow & {
  profile_id: string
  full_name: string
  slug: string | null
  headline: string | null
  account_status: AdminUserStatus
  email: string | null
  provider_subject: string | null
  is_administrator: boolean | null
  created_at: string
  updated_at: string
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

function adminUserStatus(value: string): AdminUserStatus {
  if (ADMIN_USER_STATUSES.includes(value as AdminUserStatus)) return value as AdminUserStatus
  throw new Error('admin_user_status_invalid')
}

function mapAdminUser(row: AdminUserRow): AdminUserSummary {
  return {
    id: row.profile_id,
    fullName: row.full_name,
    slug: row.slug ?? null,
    headline: row.headline ?? null,
    email: row.email ?? null,
    cognitoSubject: row.provider_subject ?? null,
    status: adminUserStatus(row.account_status),
    isAdministrator: Boolean(row.is_administrator),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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
         (select count(*) from public.company_access_requests car where car.status = 'pending') as pending_access_requests,
         (select count(*) from public.content_reports cr where cr.status = 'open') as open_reports,
         (select count(*) from public.content_reports cr where cr.status = 'reviewing') as reviewing_reports,
         (select count(*) from public.content_reports cr
           where cr.status in ('open', 'reviewing')
             and cr.reason in ('scam', 'unsafe_or_illegal', 'recruitment_fee', 'fake_company', 'suspicious_communication')
         ) as high_priority_reports,
         (select count(*) from public.content_reports cr where cr.created_at >= now() - interval '24 hours') as reports_last_24h,
         (select count(*) from public.posts p where p.deleted_at is null) as active_posts,
         (select count(*) from public.jobs j where j.status = 'published') as published_jobs,
         (select count(*) from public.events e where e.status = 'published') as published_events
       from public.organization_applications oa`,
    ) as MetricsRow[]
    const row = rows[0]
    return {
      pendingOrganizations: numberValue(row?.pending_organizations),
      changesRequested: numberValue(row?.changes_requested),
      approvedOrganizations: numberValue(row?.approved_organizations),
      suspendedOrganizations: numberValue(row?.suspended_organizations),
      pendingAccessRequests: numberValue(row?.pending_access_requests),
      openReports: numberValue(row?.open_reports),
      reviewingReports: numberValue(row?.reviewing_reports),
      highPriorityReports: numberValue(row?.high_priority_reports),
      reportsLast24h: numberValue(row?.reports_last_24h),
      activePosts: numberValue(row?.active_posts),
      publishedJobs: numberValue(row?.published_jobs),
      publishedEvents: numberValue(row?.published_events),
    }
  }

  async function listModerationCases(
    userId: string,
    filter: AdminModerationFilter,
  ): Promise<AdminModerationCase[]> {
    await requirePlatformAdministrator(queryRows, userId)
    const values: unknown[] = [filter.status]
    const where = ['cr.status = $1']
    if (filter.targetType !== 'all') {
      values.push(filter.targetType)
      where.push(`cr.target_type = $${values.length}`)
    }
    values.push(Math.min(Math.max(Math.trunc(filter.limit), 1), 100))
    const limitParameter = values.length

    const rows = await queryRows(
      `select
         cr.target_type,
         cr.target_id,
         case cr.target_type
           when 'post' then 'Post by ' || coalesce(owner.full_name, 'Unknown member')
           when 'comment' then 'Comment by ' || coalesce(owner.full_name, 'Unknown member')
           when 'job' then coalesce(j.title, 'Unavailable job')
           when 'event' then coalesce(e.title, 'Unavailable event')
         end as target_title,
         case cr.target_type
           when 'post' then p.body
           when 'comment' then pc.body
           when 'job' then coalesce(j.summary, j.description)
           when 'event' then e.summary
         end as target_excerpt,
         owner.id as owner_id,
         owner.full_name as owner_name,
         owner.slug as owner_slug,
         case cr.target_type
           when 'post' then case when p.id is null then 'missing' when p.deleted_at is null then 'visible' else 'removed' end
           when 'comment' then case when pc.id is null then 'missing' when pc.deleted_at is null then 'visible' else 'removed' end
           when 'job' then coalesce(j.status::text, 'missing')
           when 'event' then coalesce(e.status, 'missing')
         end as target_state,
         count(*)::int as report_count,
         min(cr.created_at) as first_reported_at,
         max(cr.updated_at) as latest_reported_at,
         array_agg(distinct cr.reason order by cr.reason) as reasons,
         (array_agg(cr.details order by cr.updated_at desc) filter (where cr.details is not null))[1] as latest_details
       from public.content_reports cr
       left join public.posts p on cr.target_type = 'post' and p.id = cr.target_id
       left join public.post_comments pc on cr.target_type = 'comment' and pc.id = cr.target_id
       left join public.jobs j on cr.target_type = 'job' and j.id = cr.target_id
       left join public.events e on cr.target_type = 'event' and e.id = cr.target_id
       left join public.profiles owner on owner.id = case cr.target_type
         when 'post' then p.author_id
         when 'comment' then pc.author_id
         when 'job' then j.created_by_user_id
         when 'event' then e.host_user_id
       end
       where ${where.join(' and ')}
       group by
         cr.target_type,
         cr.target_id,
         p.id, p.body, p.deleted_at,
         pc.id, pc.body, pc.deleted_at,
         j.id, j.title, j.summary, j.description, j.status,
         e.id, e.title, e.summary, e.status,
         owner.id, owner.full_name, owner.slug
       order by
         max(case when cr.reason in ('scam', 'unsafe_or_illegal', 'recruitment_fee', 'fake_company', 'suspicious_communication') then 1 else 0 end) desc,
         max(cr.updated_at) desc,
         cr.target_id desc
       limit $${limitParameter}`,
      values,
    ) as ModerationCaseRow[]

    return rows.map((row) => ({
      targetType: row.target_type,
      targetId: row.target_id,
      title: row.target_title ?? 'Reported content',
      excerpt: row.target_excerpt ?? null,
      owner: {
        id: row.owner_id ?? null,
        fullName: row.owner_name ?? 'Unknown member',
        slug: row.owner_slug ?? null,
      },
      targetState: row.target_state ?? 'unknown',
      reportCount: numberValue(row.report_count),
      firstReportedAt: row.first_reported_at,
      latestReportedAt: row.latest_reported_at,
      reasons: Array.isArray(row.reasons) ? row.reasons : [],
      latestDetails: row.latest_details ?? null,
    }))
  }

  async function listAuditEvents(
    userId: string,
    filter: AdminAuditFilter,
  ): Promise<AdminAuditEvent[]> {
    await requirePlatformAdministrator(queryRows, userId)
    const values: unknown[] = []
    const where: string[] = []
    const bind = (value: unknown) => {
      values.push(value)
      return String.fromCharCode(36) + values.length
    }

    if (filter.targetType !== 'all') {
      where.push('ae.target_type = ' + bind(filter.targetType))
    }
    const limitParameter = bind(Math.min(Math.max(Math.trunc(filter.limit), 1), 100))
    const whereSql = where.length ? 'where ' + where.join(' and ') : ''

    const sql = [
      'select',
      '  ae.id,',
      '  ae.actor_id,',
      '  actor.full_name as actor_name,',
      '  actor.slug as actor_slug,',
      '  ae.action,',
      '  ae.target_type,',
      '  ae.target_id,',
      '  ae.metadata,',
      '  ae.created_at',
      'from public.audit_events ae',
      'left join public.profiles actor on actor.id = ae.actor_id',
      whereSql,
      'order by ae.created_at desc, ae.id desc',
      'limit ' + limitParameter,
    ].filter(Boolean).join('\n')

    const rows = await queryRows(sql, values) as AuditEventRow[]

    return rows.map((row) => ({
      id: row.id,
      actor: {
        id: row.actor_id ?? null,
        fullName: row.actor_name ?? 'System',
        slug: row.actor_slug ?? null,
      },
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      createdAt: row.created_at,
    }))
  }

  function targetStateQuery(targetType: ModerationTargetType) {
    if (targetType === 'post') {
      return `select case when deleted_at is null then 'visible' else 'removed' end as state
        from public.posts where id = $1 for update`
    }
    if (targetType === 'comment') {
      return `select case when deleted_at is null then 'visible' else 'removed' end as state
        from public.post_comments where id = $1 for update`
    }
    if (targetType === 'job') {
      return `select status::text as state from public.jobs where id = $1 for update`
    }
    return `select status as state from public.events where id = $1 for update`
  }

  async function mutateModerationTarget(
    query: AdminQuery,
    targetType: ModerationTargetType,
    targetId: string,
    action: ModerationAction,
  ) {
    if (action !== 'remove' && action !== 'restore') return

    if (targetType === 'post') {
      await query(
        action === 'remove'
          ? 'update public.posts set deleted_at = coalesce(deleted_at, now()), updated_at = now() where id = $1'
          : 'update public.posts set deleted_at = null, updated_at = now() where id = $1',
        [targetId],
      )
      return
    }
    if (targetType === 'comment') {
      await query(
        action === 'remove'
          ? 'update public.post_comments set deleted_at = coalesce(deleted_at, now()), updated_at = now() where id = $1'
          : 'update public.post_comments set deleted_at = null, updated_at = now() where id = $1',
        [targetId],
      )
      return
    }
    if (targetType === 'job') {
      await query(
        action === 'remove'
          ? "update public.jobs set status = 'closed', updated_at = now() where id = $1"
          : "update public.jobs set status = 'published', published_at = coalesce(published_at, now()), updated_at = now() where id = $1",
        [targetId],
      )
      return
    }
    await query(
      action === 'remove'
        ? "update public.events set status = 'cancelled', updated_at = now() where id = $1"
        : "update public.events set status = 'published', updated_at = now() where id = $1",
      [targetId],
    )
  }

  async function moderateContent(
    adminId: string,
    input: {
      targetType: ModerationTargetType
      targetId: string
      action: ModerationAction
      note: string | null
    },
  ) {
    return transaction(async (txQuery) => {
      await requirePlatformAdministrator(txQuery, adminId, true)

      const reportRows = await txQuery(
        `select id, status
         from public.content_reports
         where target_type = $1 and target_id = $2
         for update`,
        [input.targetType, input.targetId],
      ) as ModerationReportLockRow[]
      if (!reportRows.length) throw new Error('moderation_case_not_found')

      const targetRows = await txQuery(targetStateQuery(input.targetType), [input.targetId]) as ModerationTargetStateRow[]
      const target = targetRows[0]
      if (!target) throw new Error('moderation_target_not_found')
      const previousState = target.state

      if (input.action === 'restore') {
        const latestActionRows = await txQuery(
          `select action
           from public.moderation_actions
           where target_type = $1 and target_id = $2
           order by created_at desc, id desc
           limit 1`,
          [input.targetType, input.targetId],
        ) as ModerationActionRow[]
        if (latestActionRows[0]?.action !== 'remove') {
          throw new Error('moderation_restore_forbidden')
        }
      }

      await mutateModerationTarget(txQuery, input.targetType, input.targetId, input.action)

      const nextStatus: ModerationReportStatus = input.action === 'reviewing'
        ? 'reviewing'
        : input.action === 'dismiss'
          ? 'dismissed'
          : 'resolved'
      await txQuery(
        `update public.content_reports
         set status = $3,
             reviewed_by = $4,
             reviewed_at = now(),
             reviewer_note = $5,
             updated_at = now()
         where target_type = $1
           and target_id = $2
           and status in ('open', 'reviewing', 'resolved', 'dismissed')`,
        [input.targetType, input.targetId, nextStatus, adminId, input.note],
      )

      const primaryReportId = reportRows[0]?.id ?? null
      await txQuery(
        `insert into public.moderation_actions (
           actor_id,
           target_type,
           target_id,
           report_id,
           action,
           note,
           metadata
         )
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          adminId,
          input.targetType,
          input.targetId,
          primaryReportId,
          input.action,
          input.note,
          JSON.stringify({
            previousState,
            reportIds: reportRows.map((row) => row.id),
          }),
        ],
      )

      const auditAction = input.action === 'remove'
        ? 'moderation.content_removed'
        : input.action === 'restore'
          ? 'moderation.content_restored'
          : `moderation.${input.action}`
      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          adminId,
          auditAction,
          input.targetType,
          input.targetId,
          JSON.stringify({
            note: input.note,
            previousState,
            reportCount: reportRows.length,
          }),
        ],
      )

      return true
    })
  }

  async function searchUsers(
    adminId: string,
    input: AdminUserSearch,
  ): Promise<AdminUserSummary[]> {
    await requirePlatformAdministrator(queryRows, adminId)
    const values: unknown[] = []
    const where: string[] = []
    const normalizedQuery = input.query.trim().toLowerCase()

    if (normalizedQuery) {
      values.push(`%${normalizedQuery}%`)
      const parameter = String.fromCharCode(36) + values.length
      where.push(`(
        lower(p.full_name) like ${parameter}
        or lower(coalesce(p.slug, '')) like ${parameter}
        or lower(coalesce(p.headline, '')) like ${parameter}
        or lower(coalesce(ia.email, '')) like ${parameter}
      )`)
    }

    if (input.status !== 'all') {
      values.push(input.status)
      const statusParameter = String.fromCharCode(36) + values.length
      where.push(`p.account_status::text = ${statusParameter}`)
    }

    values.push(Math.min(Math.max(Math.trunc(input.limit), 1), 100))
    const limitParameter = String.fromCharCode(36) + values.length
    const whereSql = where.length ? `where ${where.join(' and ')}` : ''

    const rows = await queryRows(
      `select
         p.id as profile_id,
         p.full_name,
         p.slug,
         p.headline,
         p.account_status::text as account_status,
         ia.email,
         ia.provider_subject,
         exists (
           select 1
           from public.user_roles target_admin
           where target_admin.user_id = p.id
             and target_admin.role::text = 'administrator'
         ) as is_administrator,
         p.created_at,
         p.updated_at
       from public.profiles p
       left join public.identity_accounts ia
         on ia.profile_id = p.id and ia.provider = 'cognito'
       ${whereSql}
       order by
         case p.account_status::text
           when 'suspended' then 0
           when 'restricted' then 1
           when 'active' then 2
           else 3
         end,
         p.updated_at desc,
         p.id asc
       limit ${limitParameter}`,
      values,
    ) as AdminUserRow[]

    return rows.map(mapAdminUser)
  }

  async function getAdminUser(adminId: string, profileId: string): Promise<AdminUserSummary | null> {
    await requirePlatformAdministrator(queryRows, adminId)
    const rows = await queryRows(
      `select
         p.id as profile_id,
         p.full_name,
         p.slug,
         p.headline,
         p.account_status::text as account_status,
         ia.email,
         ia.provider_subject,
         exists (
           select 1
           from public.user_roles target_admin
           where target_admin.user_id = p.id
             and target_admin.role::text = 'administrator'
         ) as is_administrator,
         p.created_at,
         p.updated_at
       from public.profiles p
       left join public.identity_accounts ia
         on ia.profile_id = p.id and ia.provider = 'cognito'
       where p.id = $1
       limit 1`,
      [profileId],
    ) as AdminUserRow[]
    return rows[0] ? mapAdminUser(rows[0]) : null
  }

  async function listUserAccountHistory(
    adminId: string,
    profileId: string,
    limit: number,
  ): Promise<AdminAuditEvent[]> {
    await requirePlatformAdministrator(queryRows, adminId)
    const rows = await queryRows(
      `select
         ae.id,
         ae.actor_id,
         actor.full_name as actor_name,
         actor.slug as actor_slug,
         ae.action,
         ae.target_type,
         ae.target_id,
         ae.metadata,
         ae.created_at
       from public.audit_events ae
       left join public.profiles actor on actor.id = ae.actor_id
       where ae.target_type = 'user_account'
         and ae.target_id = $1
       order by ae.created_at desc, ae.id desc
       limit $2`,
      [profileId, Math.min(Math.max(Math.trunc(limit), 1), 100)],
    ) as AuditEventRow[]

    return rows.map((row) => ({
      id: row.id,
      actor: {
        id: row.actor_id ?? null,
        fullName: row.actor_name ?? 'System',
        slug: row.actor_slug ?? null,
      },
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      createdAt: row.created_at,
    }))
  }

  async function setUserAccountStatus(
    adminId: string,
    profileId: string,
    nextStatus: Extract<AdminUserStatus, 'active' | 'suspended'>,
    reason: string,
  ) {
    return transaction(async (txQuery) => {
      await requirePlatformAdministrator(txQuery, adminId, true)
      if (adminId === profileId) throw new Error('admin_user_self_action_forbidden')

      const rows = await txQuery(
        `select
           p.id as profile_id,
           p.full_name,
           p.slug,
           p.headline,
           p.account_status::text as account_status,
           ia.email,
           ia.provider_subject,
           exists (
             select 1
             from public.user_roles target_admin
             where target_admin.user_id = p.id
               and target_admin.role::text = 'administrator'
           ) as is_administrator,
           p.created_at,
           p.updated_at
         from public.profiles p
         left join public.identity_accounts ia
           on ia.profile_id = p.id and ia.provider = 'cognito'
         where p.id = $1
         for update of p`,
        [profileId],
      ) as AdminUserRow[]
      const target = rows[0]
      if (!target) throw new Error('admin_user_not_found')
      if (target.is_administrator) throw new Error('admin_user_target_administrator_forbidden')

      const previousStatus = adminUserStatus(target.account_status)
      if (previousStatus === 'deletion_requested') throw new Error('admin_user_deleted')
      if (nextStatus === 'suspended' && previousStatus === 'suspended') return true
      if (nextStatus === 'active' && previousStatus !== 'suspended') {
        throw new Error('admin_user_restore_forbidden')
      }

      await txQuery(
        `update public.profiles
         set account_status = $2::public.account_status,
             updated_at = now()
         where id = $1`,
        [profileId, nextStatus],
      )

      const action = nextStatus === 'suspended' ? 'account.suspended' : 'account.restored'
      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'user_account', $3, $4::jsonb)`,
        [
          adminId,
          action,
          profileId,
          JSON.stringify({
            reason: reason.trim(),
            previousStatus,
            nextStatus,
          }),
        ],
      )
      return true
    })
  }

  async function recordUserDeletionAudit(adminId: string, profileId: string, reason: string) {
    await requirePlatformAdministrator(queryRows, adminId)
    await queryRows(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, 'account.permanently_deleted', 'user_account', $2, $3::jsonb)`,
      [
        adminId,
        profileId,
        JSON.stringify({
          reason: reason.trim(),
          nextStatus: 'deletion_requested',
        }),
      ],
    )
    return true
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
    listModerationCases,
    listAuditEvents,
    moderateContent,
    searchUsers,
    getAdminUser,
    listUserAccountHistory,
    setUserAccountStatus,
    recordUserDeletionAudit,
    listOrganizationApplications,
    getOrganizationApplicationReview,
    reviewOrganizationApplication,
  }
}

export type AdminRepository = ReturnType<typeof createAdminRepository>

export const adminRepository = createAdminRepository()
