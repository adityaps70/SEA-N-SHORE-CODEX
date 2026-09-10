import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import type {
  JobAlert,
  JobApplication,
  JobApplicationEvent,
  JobApplicationStatus,
  JobCandidateProfile,
  JobListing,
  JobSalaryPeriod,
  JobSearchFilters,
} from './types'

type JobsQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type JobRow = QueryResultRow & {
  id: string
  title: string
  company_name: string
  company_id: string | null
  company_slug: string | null
  company_verified: boolean | null
  recruiter_verified: boolean | null
  location: string | null
  summary: string
  description: string
  requirements: string | null
  apply_until: string | null
  created_at: string
  published_at: string | null
  job_domain: string | null
  department: string | null
  rank: string | null
  vessel_types: string[] | null
  experience_min_years: string | number | null
  experience_max_years: string | number | null
  joining_from: string | null
  joining_until: string | null
  salary_min: string | number | null
  salary_max: string | number | null
  salary_currency: string | null
  salary_period: string | null
  sailing_regions: string[] | null
  urgent: boolean | null
  easy_apply: boolean | null
  certificate_requirements: string[] | null
  visa_requirements: string[] | null
}

type ApplicationEventRow = {
  id: string | number
  status: JobApplicationStatus
  note: string | null
  created_at: string
}

type ApplicationRow = QueryResultRow & {
  id: string
  status: JobApplicationStatus
  applied_at: string
  updated_at: string
  job_id: string
  title: string
  company_name: string
  location: string | null
  events: ApplicationEventRow[] | null
}

type CandidateRow = QueryResultRow & {
  rank: string | null
  sailing_experience_years: string | number | null
  vessel_types: string[] | null
  trading_areas: string[] | null
  availability: string | null
  shore_career_preference: boolean | null
  skills: string[] | null
  credentials: Array<{ name: string; expires_at: string | null; verified: boolean }> | null
  visas: string[] | null
}

type AlertRow = QueryResultRow & {
  id: string
  name: string
  filters: JobSearchFilters
  frequency: 'instant' | 'daily' | 'weekly'
  enabled: boolean
  created_at: string
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function salaryPeriod(value: string | null): JobSalaryPeriod | null {
  return value === 'day' || value === 'month' || value === 'year' ? value : null
}

function mapJob(row: JobRow): JobListing {
  return {
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    companyId: row.company_id ?? null,
    companySlug: row.company_slug ?? null,
    companyVerified: Boolean(row.company_verified),
    recruiterVerified: Boolean(row.recruiter_verified),
    location: row.location,
    summary: row.summary,
    description: row.description,
    requirements: row.requirements,
    applyUntil: row.apply_until,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? null,
    domain: row.job_domain === 'shore' ? 'shore' : 'sea',
    department: row.department ?? null,
    rank: row.rank ?? null,
    vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
    experienceMinYears: numberOrNull(row.experience_min_years),
    experienceMaxYears: numberOrNull(row.experience_max_years),
    joiningFrom: row.joining_from ?? null,
    joiningUntil: row.joining_until ?? null,
    salaryMin: numberOrNull(row.salary_min),
    salaryMax: numberOrNull(row.salary_max),
    salaryCurrency: row.salary_currency ?? null,
    salaryPeriod: salaryPeriod(row.salary_period),
    regions: Array.isArray(row.sailing_regions) ? row.sailing_regions : [],
    certificateRequirements: Array.isArray(row.certificate_requirements) ? row.certificate_requirements : [],
    visaRequirements: Array.isArray(row.visa_requirements) ? row.visa_requirements : [],
    urgent: Boolean(row.urgent),
    easyApply: row.easy_apply !== false,
  }
}

function mapEvent(row: ApplicationEventRow): JobApplicationEvent {
  return {
    id: String(row.id),
    status: row.status,
    note: row.note ?? null,
    createdAt: row.created_at,
  }
}

function mapApplication(row: ApplicationRow): JobApplication {
  return {
    id: row.id,
    status: row.status,
    appliedAt: row.applied_at,
    updatedAt: row.updated_at,
    events: Array.isArray(row.events) ? row.events.map(mapEvent) : [],
    job: {
      id: row.job_id,
      title: row.title,
      companyName: row.company_name,
      location: row.location,
    },
  }
}

const JOB_COLUMNS = `
    j.id,
    j.title,
    j.company_name,
    j.company_id,
    c.slug as company_slug,
    coalesce(c.is_verified, false) as company_verified,
    coalesce(cm.is_verified, false) as recruiter_verified,
    j.location,
    j.summary,
    j.description,
    j.requirements,
    j.apply_until,
    j.created_at,
    j.published_at,
    j.job_domain,
    j.department,
    j.rank,
    j.vessel_types,
    j.experience_min_years,
    j.experience_max_years,
    j.joining_from,
    j.joining_until,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.salary_period,
    j.sailing_regions,
    j.urgent,
    j.easy_apply,
    coalesce((
      select array_agg(r.certificate_name order by r.certificate_name)
      from public.job_certificate_requirements r
      where r.job_id = j.id and r.required = true
    ), '{}'::text[]) as certificate_requirements,
    coalesce((
      select array_agg(v.visa_name order by v.visa_name)
      from public.job_visa_requirements v
      where v.job_id = j.id and v.required = true
    ), '{}'::text[]) as visa_requirements
` as const

const JOB_FROM = `
  from public.jobs j
  left join public.companies c on c.id = j.company_id
  left join public.company_members cm
    on cm.company_id = j.company_id and cm.user_id = j.created_by_user_id
` as const

const JOB_SELECT = `select ${JOB_COLUMNS} ${JOB_FROM}` as const

function normalizeLower(values: readonly string[]) {
  return values.map((value) => value.toLocaleLowerCase())
}

export function createJobsRepository(input: { query?: JobsQuery } = {}) {
  const queryRows: JobsQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function listPublishedJobs(limit: number): Promise<JobListing[]> {
    const rows = await queryRows(
      `${JOB_SELECT}
       where j.status = 'published'
         and (j.apply_until is null or j.apply_until >= current_date)
       order by j.created_at desc, j.id desc
       limit $1`,
      [limit],
    ) as JobRow[]
    return rows.map(mapJob)
  }

  async function searchJobs(filters: JobSearchFilters, limit = 60, offset = 0): Promise<JobListing[]> {
    const values: unknown[] = []
    const where = [
      "j.status = 'published'",
      '(j.apply_until is null or j.apply_until >= current_date)',
    ]
    const bind = (value: unknown) => {
      values.push(value)
      return `$${values.length}`
    }

    if (filters.mode === 'sea' || filters.mode === 'shore') {
      where.push(`j.job_domain = ${bind(filters.mode)}`)
    }
    if (filters.query) {
      const queryParam = bind(filters.query)
      where.push(`to_tsvector(
        'simple'::regconfig,
        coalesce(j.title, '') || ' ' || coalesce(j.company_name, '') || ' ' || coalesce(j.location, '') || ' ' ||
        coalesce(j.summary, '') || ' ' || coalesce(j.description, '') || ' ' || coalesce(j.requirements, '') || ' ' ||
        coalesce(j.rank, '') || ' ' || coalesce(j.department, '')
      ) @@ websearch_to_tsquery('simple'::regconfig, ${queryParam})`)
    }
    if (filters.ranks.length) where.push(`lower(j.rank) = any(${bind(normalizeLower(filters.ranks))}::text[])`)
    if (filters.vesselTypes.length) where.push(`j.vessel_types && ${bind(filters.vesselTypes)}::text[]`)
    if (filters.minExperienceYears !== null) {
      where.push(`(j.experience_min_years is null or j.experience_min_years <= ${bind(filters.minExperienceYears)})`)
    }
    if (filters.joiningWithinDays !== null) {
      where.push(`(j.joining_from is null or j.joining_from <= current_date + (${bind(filters.joiningWithinDays)}::int * interval '1 day'))`)
    }
    if (filters.salaryMin !== null) where.push(`(j.salary_max is null or j.salary_max >= ${bind(filters.salaryMin)})`)
    if (filters.salaryMax !== null) where.push(`(j.salary_min is null or j.salary_min <= ${bind(filters.salaryMax)})`)
    if (filters.regions.length) {
      const regionParam = bind(filters.regions)
      where.push(`(j.sailing_regions && ${regionParam}::text[] or 'Worldwide' = any(j.sailing_regions))`)
    }
    if (filters.certificates.length) {
      const certParam = bind(normalizeLower(filters.certificates))
      where.push(`exists (
        select 1 from public.job_certificate_requirements cr
        where cr.job_id = j.id and cr.required = true and lower(cr.certificate_name) = any(${certParam}::text[])
      )`)
    }
    if (filters.visas.length) {
      const visaParam = bind(normalizeLower(filters.visas))
      where.push(`exists (
        select 1 from public.job_visa_requirements vr
        where vr.job_id = j.id and vr.required = true and lower(vr.visa_name) = any(${visaParam}::text[])
      )`)
    }
    if (filters.verifiedOnly) where.push('coalesce(c.is_verified, false) = true')
    if (filters.urgentOnly) where.push('j.urgent = true')
    if (filters.easyApplyOnly) where.push('j.easy_apply = true')
    if (filters.postedWithinDays !== null) {
      where.push(`coalesce(j.published_at, j.created_at) >= now() - (${bind(filters.postedWithinDays)}::int * interval '1 day')`)
    }

    const orderBy = filters.sort === 'joining'
      ? 'j.joining_from asc nulls last, coalesce(j.published_at, j.created_at) desc, j.id desc'
      : filters.sort === 'salary'
        ? 'coalesce(j.salary_max, j.salary_min) desc nulls last, coalesce(j.published_at, j.created_at) desc, j.id desc'
        : filters.sort === 'recent'
          ? 'coalesce(j.published_at, j.created_at) desc, j.id desc'
          : 'j.urgent desc, coalesce(c.is_verified, false) desc, coalesce(j.published_at, j.created_at) desc, j.id desc'

    const limitParam = bind(Math.min(Math.max(Math.trunc(limit), 1), 100))
    const offsetParam = bind(Math.max(Math.trunc(offset), 0))
    const rows = await queryRows(
      `${JOB_SELECT}
       where ${where.join('\n         and ')}
       order by ${orderBy}
       limit ${limitParam} offset ${offsetParam}`,
      values,
    ) as JobRow[]
    return rows.map(mapJob)
  }

  async function getPublishedJob(jobId: string): Promise<JobListing | null> {
    const rows = await queryRows(
      `${JOB_SELECT}
       where j.id = $1
         and j.status = 'published'
         and (j.apply_until is null or j.apply_until >= current_date)
       limit 1`,
      [jobId],
    ) as JobRow[]
    return rows[0] ? mapJob(rows[0]) : null
  }

  async function getCandidateProfile(profileId: string): Promise<JobCandidateProfile | null> {
    const rows = await queryRows(
      `select
         mp.rank,
         mp.sailing_experience_years,
         mp.vessel_types,
         mp.trading_areas,
         mp.availability,
         mp.shore_career_preference,
         coalesce((
           select array_agg(ps.skill order by ps.skill)
           from public.profile_skills ps
           where ps.user_id = p.id
         ), '{}'::text[]) as skills,
         coalesce((
           select json_agg(json_build_object(
             'name', pc.name,
             'expires_at', pc.expires_on,
             'verified', pc.verification_state = 'verified'
           ) order by pc.sort_order asc, pc.issued_on desc nulls last, pc.name asc)
           from public.profile_credentials pc
           where pc.profile_id = p.id and pc.verification_state <> 'rejected'
         ), '[]'::json) as credentials,
         coalesce((
           select array_agg(pv.visa_type order by pv.visa_type)
           from public.profile_visas pv
           where pv.profile_id = p.id
             and pv.verification_state <> 'rejected'
             and (pv.expires_on is null or pv.expires_on >= current_date)
         ), '{}'::text[]) as visas
       from public.profiles p
       left join public.maritime_profiles mp on mp.user_id = p.id
       where p.id = $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
       limit 1`,
      [profileId],
    ) as CandidateRow[]
    const row = rows[0]
    if (!row) return null
    return {
      rank: row.rank ?? null,
      sailingExperienceYears: numberOrNull(row.sailing_experience_years),
      vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
      tradingAreas: Array.isArray(row.trading_areas) ? row.trading_areas : [],
      availability: row.availability ?? null,
      shoreCareerPreference: Boolean(row.shore_career_preference),
      skills: Array.isArray(row.skills) ? row.skills : [],
      certificates: Array.isArray(row.credentials)
        ? row.credentials.map((credential) => ({
            name: credential.name,
            expiresAt: credential.expires_at ?? null,
            verified: Boolean(credential.verified),
          }))
        : [],
      visas: Array.isArray(row.visas) ? row.visas : [],
    }
  }

  async function listApplications(applicantId: string, limit?: number): Promise<JobApplication[]> {
    const values: unknown[] = [applicantId]
    const limitSql = limit === undefined ? '' : ' limit $2'
    if (limit !== undefined) values.push(limit)

    const rows = await queryRows(
      `select
         a.id,
         a.status::text as status,
         a.applied_at,
         a.updated_at,
         j.id as job_id,
         j.title,
         j.company_name,
         j.location,
         coalesce((
           select json_agg(json_build_object(
             'id', e.id::text,
             'status', e.status::text,
             'note', e.note,
             'created_at', e.created_at
           ) order by e.created_at asc, e.id asc)
           from public.job_application_events e
           where e.application_id = a.id
         ), '[]'::json) as events
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       where a.applicant_id = $1
       order by a.applied_at desc, a.id desc${limitSql}`,
      values,
    ) as ApplicationRow[]
    return rows.map(mapApplication)
  }

  async function hasApplied(jobId: string, applicantId: string): Promise<boolean> {
    const rows = await queryRows(
      `select exists (
         select 1
         from public.job_applications a
         where a.job_id = $1 and a.applicant_id = $2
       ) as applied`,
      [jobId, applicantId],
    ) as Array<QueryResultRow & { applied: boolean }>
    return Boolean(rows[0]?.applied)
  }

  async function isMemberReady(applicantId: string): Promise<boolean> {
    const rows = await queryRows(
      `select exists (
         select 1
         from public.profiles p
         where p.id = $1
           and p.account_status = 'active'
           and p.onboarding_completed_at is not null
       ) as ready`,
      [applicantId],
    ) as Array<QueryResultRow & { ready: boolean }>
    return Boolean(rows[0]?.ready)
  }

  async function createApplication(jobId: string, applicantId: string): Promise<void> {
    await queryRows(
      `with inserted as (
         insert into public.job_applications (job_id, applicant_id, status)
         values ($1, $2, 'applied')
         returning id, status, applicant_id, applied_at
       )
       insert into public.job_application_events (application_id, status, actor_id, created_at)
       select id, status, applicant_id, applied_at from inserted`,
      [jobId, applicantId],
    )
  }

  async function getSavedJobIds(userId: string, jobIds: string[]): Promise<string[]> {
    if (!jobIds.length) return []
    const rows = await queryRows(
      `select s.job_id
       from public.job_saves s
       where s.user_id = $1 and s.job_id = any($2::uuid[])`,
      [userId, jobIds],
    ) as Array<QueryResultRow & { job_id: string }>
    return rows.map((row) => row.job_id)
  }

  async function isJobSaved(jobId: string, userId: string): Promise<boolean> {
    const rows = await queryRows(
      `select exists (
         select 1 from public.job_saves s where s.job_id = $1 and s.user_id = $2
       ) as saved`,
      [jobId, userId],
    ) as Array<QueryResultRow & { saved: boolean }>
    return Boolean(rows[0]?.saved)
  }

  async function saveJob(jobId: string, userId: string): Promise<void> {
    await queryRows(
      `insert into public.job_saves (job_id, user_id)
       values ($1, $2)
       on conflict (job_id, user_id) do nothing`,
      [jobId, userId],
    )
  }

  async function unsaveJob(jobId: string, userId: string): Promise<void> {
    await queryRows(
      `delete from public.job_saves
       where job_id = $1 and user_id = $2`,
      [jobId, userId],
    )
  }

  async function listSavedJobs(userId: string, limit = 100): Promise<JobListing[]> {
    const rows = await queryRows(
      `select ${JOB_COLUMNS}
       ${JOB_FROM}
       join public.job_saves s on s.job_id = j.id and s.user_id = $1
       where j.status = 'published'
         and (j.apply_until is null or j.apply_until >= current_date)
       order by s.saved_at desc, j.id desc
       limit $2`,
      [userId, Math.min(Math.max(Math.trunc(limit), 1), 100)],
    ) as JobRow[]
    return rows.map(mapJob)
  }

  async function listJobAlerts(userId: string): Promise<JobAlert[]> {
    const rows = await queryRows(
      `select id, name, filters, frequency, enabled, created_at
       from public.job_alerts
       where user_id = $1
       order by created_at desc, id desc`,
      [userId],
    ) as AlertRow[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      filters: row.filters,
      frequency: row.frequency,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
    }))
  }

  async function createJobAlert(
    userId: string,
    name: string,
    filters: JobSearchFilters,
    frequency: JobAlert['frequency'],
  ): Promise<void> {
    await queryRows(
      `insert into public.job_alerts (user_id, name, filters, frequency)
       values ($1, $2, $3::jsonb, $4)`,
      [userId, name, JSON.stringify(filters), frequency],
    )
  }

  async function deleteJobAlert(alertId: string, userId: string): Promise<void> {
    await queryRows(
      `delete from public.job_alerts
       where id = $1 and user_id = $2`,
      [alertId, userId],
    )
  }

  async function reportJob(jobId: string, reporterId: string, reason: string, details: string | null): Promise<void> {
    await queryRows(
      `insert into public.job_reports (job_id, reporter_id, reason, details)
       values ($1, $2, $3, $4)`,
      [jobId, reporterId, reason, details],
    )
  }

  return {
    listPublishedJobs,
    searchJobs,
    getPublishedJob,
    getCandidateProfile,
    listApplications,
    hasApplied,
    isMemberReady,
    createApplication,
    getSavedJobIds,
    isJobSaved,
    saveJob,
    unsaveJob,
    listSavedJobs,
    listJobAlerts,
    createJobAlert,
    deleteJobAlert,
    reportJob,
  }
}

export type JobsRepository = ReturnType<typeof createJobsRepository>

export const jobsRepository = createJobsRepository()
