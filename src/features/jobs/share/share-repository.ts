import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { LIVE_JOB_SQL } from '@/features/jobs/repository'
import type { ShareJob } from './share-content'

/**
 * Round I (I1): the database side of job sharing: the job's fields for the image, who may share it, the feed-share
 * reservations (public.job_shares, migration 0094) and the applications that came from shares.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

/** The hiring roles that manage an organization's jobs (HIRING_ROLES in hiring-repository). */
export const SHARE_HIRING_ROLES = ['owner', 'administrator', 'recruiter'] as const

export type ShareJobRecord = ShareJob & {
  /** Published, not deleted or plan-hidden, and still taking applications (LIVE_JOB_SQL). */
  live: boolean
  companyVerified: boolean
  createdByUserId: string | null
  rank: string | null
  domain: 'sea' | 'shore'
}

export type ShareGrants = {
  /** A personal job the viewer posted, while a verified recruiter. */
  ownPersonalJob: boolean
  /** An organization job, the viewer an approved owner, administrator or recruiter of the verified organization. */
  organizationHiringRole: boolean
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function isoDate(value: unknown) {
  const text = iso(value)
  return text ? text.slice(0, 10) : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function createJobShareRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getJob(jobId: string): Promise<ShareJobRecord | null> {
    const rows = await queryRows(
      `select j.id, j.title, j.rank, j.company_name, j.company_id, c.logo_path, coalesce(c.is_verified, false) as company_verified,
              j.created_by_user_id, j.location, j.salary_min, j.salary_max, j.salary_currency, j.salary_period,
              j.published_at, j.created_at, j.updated_at, j.urgent, j.vessel_types, j.experience_min_years, j.experience_max_years,
              j.joining_from, j.joining_until, j.apply_until, j.job_domain,
              (${LIVE_JOB_SQL}) as live,
              exists (
                select 1 from public.user_roles ur
                where ur.user_id = j.created_by_user_id and ur.role::text = 'administrator'
              ) as posted_by_platform_admin
       from public.jobs j
       left join public.companies c on c.id = j.company_id
       where j.id = $1`,
      [jobId],
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: String(row.id),
      title: String(row.title),
      rank: (row.rank as string | null) ?? null,
      companyName: String(row.company_name),
      companyId: (row.company_id as string | null) ?? null,
      companyLogoPath: (row.logo_path as string | null) ?? null,
      companyVerified: row.company_verified === true,
      createdByUserId: (row.created_by_user_id as string | null) ?? null,
      location: (row.location as string | null) ?? null,
      salaryMin: numberOrNull(row.salary_min),
      salaryMax: numberOrNull(row.salary_max),
      salaryCurrency: (row.salary_currency as string | null) ?? null,
      salaryPeriod: (row.salary_period as ShareJob['salaryPeriod']) ?? null,
      publishedAt: iso(row.published_at),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
      urgent: row.urgent === true,
      vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types.map(String) : [],
      experienceMinYears: numberOrNull(row.experience_min_years),
      experienceMaxYears: numberOrNull(row.experience_max_years),
      joiningFrom: isoDate(row.joining_from),
      joiningUntil: isoDate(row.joining_until),
      applyUntil: isoDate(row.apply_until),
      domain: row.job_domain === 'shore' ? 'shore' : 'sea',
      live: row.live === true,
      postedByPlatformAdmin: row.posted_by_platform_admin === true,
    }
  }

  /** What the viewer holds on this job, apart from platform administration (checked with admin MFA elsewhere). */
  async function grants(viewerId: string, jobId: string): Promise<ShareGrants> {
    const rows = await queryRows(
      `select
         (j.company_id is null and j.created_by_user_id = $1 and (
           exists (select 1 from public.feature_verifications fv where fv.profile_id = $1 and fv.verification_type = 'recruiter' and fv.status = 'approved')
           or exists (
             select 1 from public.company_members cm join public.companies vc on vc.id = cm.company_id
             where cm.user_id = $1 and cm.approved_at is not null and cm.role::text = any($3::text[]) and vc.is_verified = true
           )
         )) as own_personal_job,
         (j.company_id is not null and exists (
           select 1 from public.company_members cm join public.companies c on c.id = cm.company_id
           where cm.company_id = j.company_id and cm.user_id = $1 and cm.approved_at is not null
             and cm.role::text = any($3::text[]) and c.is_verified = true
         )) as organization_hiring_role
       from public.jobs j
       where j.id = $2`,
      [viewerId, jobId, [...SHARE_HIRING_ROLES]],
    )
    return { ownPersonalJob: rows[0]?.own_personal_job === true, organizationHiringRole: rows[0]?.organization_hiring_role === true }
  }

  /** The jobs in the list the viewer may share as their poster (the same rules as grants), for the hiring list. */
  async function shareableJobIds(viewerId: string, jobIds: readonly string[]): Promise<Set<string>> {
    if (!jobIds.length) return new Set()
    const rows = await queryRows(
      `select j.id
       from public.jobs j
       where j.id = any($2::uuid[]) and (${LIVE_JOB_SQL}) and (
         (j.company_id is null and j.created_by_user_id = $1 and (
           exists (select 1 from public.feature_verifications fv where fv.profile_id = $1 and fv.verification_type = 'recruiter' and fv.status = 'approved')
           or exists (
             select 1 from public.company_members cm join public.companies vc on vc.id = cm.company_id
             where cm.user_id = $1 and cm.approved_at is not null and cm.role::text = any($3::text[]) and vc.is_verified = true
           )
         ))
         or (j.company_id is not null and exists (
           select 1 from public.company_members cm join public.companies c on c.id = cm.company_id
           where cm.company_id = j.company_id and cm.user_id = $1 and cm.approved_at is not null
             and cm.role::text = any($3::text[]) and c.is_verified = true
         ))
       )`,
      [viewerId, [...jobIds], [...SHARE_HIRING_ROLES]],
    )
    return new Set(rows.map((row) => String(row.id)))
  }

  /** The job cards of feed posts made with "Share to feed", by post id. */
  async function listFeedJobCards(postIds: readonly string[]) {
    const cards = new Map<string, { jobId: string; title: string; companyName: string; location: string | null; open: boolean }>()
    if (!postIds.length) return cards
    const rows = await queryRows(
      `select s.post_id, j.id, j.title, j.company_name, j.location, (${LIVE_JOB_SQL}) as live
       from public.job_shares s
       join public.jobs j on j.id = s.job_id
       where s.channel = 'feed' and s.post_id = any($1::uuid[])`,
      [[...postIds]],
    )
    for (const row of rows) {
      cards.set(String(row.post_id), {
        jobId: String(row.id),
        title: String(row.title),
        companyName: String(row.company_name),
        location: (row.location as string | null) ?? null,
        open: row.live === true,
      })
    }
    return cards
  }

  /** The newest feed share of the job (a reservation counts too), or null. */
  async function lastFeedShare(jobId: string) {
    const rows = await queryRows(
      `select created_at, post_id from public.job_shares where job_id = $1 and channel = 'feed' order by created_at desc limit 1`,
      [jobId],
    )
    return rows[0] ? { createdAt: iso(rows[0].created_at)!, postId: (rows[0].post_id as string | null) ?? null } : null
  }

  /**
   * Reserves the job's feed share: locks the job row, refuses when a feed share is younger than `days` days, and
   * records the reservation in the same transaction, so two requests can never both share.
   */
  async function reserveFeedShare(input: { jobId: string; sharedBy: string; asOrg: boolean; days: number }) {
    return transaction(async (query) => {
      await query(`select id from public.jobs where id = $1 for update`, [input.jobId])
      const recent = await query(
        `select created_at from public.job_shares
         where job_id = $1 and channel = 'feed' and created_at > now() - make_interval(days => $2::int)
         order by created_at desc limit 1`,
        [input.jobId, input.days],
      )
      if (recent[0]) return { reserved: false as const, lastAt: iso(recent[0].created_at)! }
      const rows = await query(
        `insert into public.job_shares (job_id, shared_by, as_org, channel) values ($1, $2, $3, 'feed') returning id`,
        [input.jobId, input.sharedBy, input.asOrg],
      )
      return { reserved: true as const, shareId: String(rows[0]!.id) }
    })
  }

  async function attachPost(shareId: string, postId: string) {
    await queryRows(`update public.job_shares set post_id = $2 where id = $1`, [shareId, postId])
  }

  /** A reservation whose post could not be made (rate limit, error) is taken back, so it does not block 7 days. */
  async function cancelReservation(shareId: string) {
    await queryRows(`delete from public.job_shares where id = $1 and post_id is null and channel = 'feed'`, [shareId])
  }

  /** A downloaded, copied or shared image (for the share counts). */
  async function recordImageShare(input: { jobId: string; sharedBy: string; asOrg: boolean }) {
    await queryRows(`insert into public.job_shares (job_id, shared_by, as_org, channel) values ($1, $2, $3, 'image')`, [input.jobId, input.sharedBy, input.asOrg])
  }

  async function shareCounts(jobId: string) {
    const rows = await queryRows(
      `select
         (select count(*)::int from public.job_shares where job_id = $1 and channel = 'image') as images,
         (select count(*)::int from public.job_shares where job_id = $1 and channel = 'feed' and post_id is not null) as feed_posts,
         (select count(*)::int from public.job_applications where job_id = $1 and source = 'share_image') as applies_share_image,
         (select count(*)::int from public.job_applications where job_id = $1 and source = 'feed_share') as applies_feed_share`,
      [jobId],
    )
    const row = rows[0] ?? {}
    return {
      images: Number(row.images ?? 0),
      feedPosts: Number(row.feed_posts ?? 0),
      appliesFromImage: Number(row.applies_share_image ?? 0),
      appliesFromFeed: Number(row.applies_feed_share ?? 0),
    }
  }

  return { getJob, grants, shareableJobIds, listFeedJobCards, lastFeedShare, reserveFeedShare, attachPost, cancelReservation, recordImageShare, shareCounts }
}

export type JobShareRepository = ReturnType<typeof createJobShareRepository>

export const jobShareRepository = createJobShareRepository()
