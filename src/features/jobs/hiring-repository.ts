import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { JobApplicationStatus, JobDomain, JobSalaryPeriod } from './types'

export const HIRING_ROLES = ['owner', 'administrator', 'recruiter'] as const
export type HiringRole = (typeof HIRING_ROLES)[number]

export type AuthorizedHiringCompany = {
  id: string
  slug: string
  name: string
  verified: boolean
  role: HiringRole
}

export type HiringDashboardMetrics = {
  activeJobs: number
  applicants: number
  shortlisted: number
  interviews: number
  selected: number
}

export type HiringJobInput = {
  companyId: string
  title: string
  domain: JobDomain
  department: string | null
  rank: string | null
  vesselTypes: string[]
  location: string | null
  regions: string[]
  summary: string
  description: string
  requirements: string | null
  experienceMinYears: number | null
  experienceMaxYears: number | null
  joiningFrom: string | null
  joiningUntil: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: JobSalaryPeriod | null
  urgent: boolean
  easyApply: boolean
  applyUntil: string | null
  status: 'draft' | 'published'
  certificates: string[]
  visas: string[]
}

type HiringQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResultRow[]>

type HiringTransaction = <T>(work: (query: HiringQuery) => Promise<T>) => Promise<T>

type CompanyRow = QueryResultRow & {
  company_id: string
  company_slug: string
  company_name: string
  company_verified: boolean | null
  role: string
}

const AUTHORIZED_COMPANY_SELECT = `
  select
    c.id as company_id,
    c.slug as company_slug,
    c.name as company_name,
    coalesce(c.is_verified, false) as company_verified,
    cm.role::text as role
  from public.companies c
  join public.company_members cm on cm.company_id = c.id
  where cm.user_id = $1
    and cm.approved_at is not null
    and cm.role::text = any($2::text[])
` as const

function mapAuthorizedCompany(row: CompanyRow | undefined): AuthorizedHiringCompany | null {
  if (!row || !HIRING_ROLES.includes(row.role as HiringRole)) return null
  return {
    id: row.company_id,
    slug: row.company_slug,
    name: row.company_name,
    verified: Boolean(row.company_verified),
    role: row.role as HiringRole,
  }
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function defaultTransaction<T>(work: (query: HiringQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

export function createHiringRepository(input: { query?: HiringQuery; transaction?: HiringTransaction } = {}) {
  const queryRows: HiringQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? defaultTransaction

  async function getAuthorizedCompanyWithQuery(query: HiringQuery, userId: string, companyId?: string) {
    const values: readonly unknown[] = companyId
      ? [userId, [...HIRING_ROLES], companyId]
      : [userId, [...HIRING_ROLES]]
    const companyFilter = companyId ? 'and c.id = $3' : ''
    const rows = await query(
      `${AUTHORIZED_COMPANY_SELECT}
       ${companyFilter}
       order by cm.approved_at asc nulls last, c.name asc
       limit 1`,
      values,
    ) as CompanyRow[]
    return mapAuthorizedCompany(rows[0])
  }

  async function getAuthorizedCompany(userId: string, companyId?: string) {
    return getAuthorizedCompanyWithQuery(queryRows, userId, companyId)
  }

  async function getDashboardMetrics(userId: string, companyId: string): Promise<HiringDashboardMetrics> {
    const rows = await queryRows(
      `with authorised_company as (
         select cm.company_id
         from public.company_members cm
         where cm.user_id = $1
           and cm.approved_at is not null
           and cm.role::text = any($2::text[])
           and cm.company_id = $3
       )
       select
         count(distinct j.id) filter (where j.status = 'published' and (j.apply_until is null or j.apply_until >= current_date)) as active_jobs,
         count(a.id) as applicants,
         count(a.id) filter (where a.status = 'shortlisted') as shortlisted,
         count(a.id) filter (where a.status = 'interview') as interviews,
         count(a.id) filter (where a.status = 'selected') as selected
       from authorised_company ac
       left join public.jobs j on j.company_id = ac.company_id
       left join public.job_applications a on a.job_id = j.id
       where j.company_id = $3 or j.company_id is null`,
      [userId, [...HIRING_ROLES], companyId],
    )
    const row = rows[0] ?? {}
    return {
      activeJobs: numberValue(row.active_jobs),
      applicants: numberValue(row.applicants),
      shortlisted: numberValue(row.shortlisted),
      interviews: numberValue(row.interviews),
      selected: numberValue(row.selected),
    }
  }

  async function createJob(userId: string, job: HiringJobInput) {
    return transaction(async (txQuery) => {
      const company = await getAuthorizedCompanyWithQuery(txQuery, userId, job.companyId)
      if (!company) throw new Error('hiring_forbidden')

      const rows = await txQuery(
        `insert into public.jobs (
           title, company_name, company_id, created_by_user_id, location, summary, description, requirements,
           apply_until, status, job_domain, department, rank, vessel_types, experience_min_years, experience_max_years,
           joining_from, joining_until, salary_min, salary_max, salary_currency, salary_period, sailing_regions,
           urgent, easy_apply, published_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13, $14::text[], $15, $16,
           $17, $18, $19, $20, $21, $22, $23::text[],
           $24, $25, case when $10 = 'published' then now() else null end
         ) returning id`,
        [
          job.title, company.name, company.id, userId, job.location, job.summary, job.description, job.requirements,
          job.applyUntil, job.status, job.domain, job.department, job.rank, job.vesselTypes, job.experienceMinYears,
          job.experienceMaxYears, job.joiningFrom, job.joiningUntil, job.salaryMin, job.salaryMax, job.salaryCurrency,
          job.salaryPeriod, job.regions, job.urgent, job.easyApply,
        ],
      )
      const jobId = typeof rows[0]?.id === 'string' ? rows[0].id : null
      if (!jobId) throw new Error('job_create_failed')

      for (const certificate of [...new Set(job.certificates.map((item) => item.trim()).filter(Boolean))]) {
        await txQuery(
          `insert into public.job_certificate_requirements (job_id, certificate_name, required)
           values ($1, $2, true)
           on conflict (job_id, certificate_name) do update set required = excluded.required`,
          [jobId, certificate],
        )
      }
      for (const visa of [...new Set(job.visas.map((item) => item.trim()).filter(Boolean))]) {
        await txQuery(
          `insert into public.job_visa_requirements (job_id, visa_name, required)
           values ($1, $2, true)
           on conflict (job_id, visa_name) do update set required = excluded.required`,
          [jobId, visa],
        )
      }
      return jobId
    })
  }

  async function requireAuthorizedApplication(query: HiringQuery, userId: string, applicationId: string) {
    const rows = await query(
      `select a.id, j.company_id
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       join public.company_members cm on cm.company_id = j.company_id
       where a.id = $1
         and cm.user_id = $2
         and cm.approved_at is not null
         and cm.role::text = any($3::text[])
       limit 1`,
      [applicationId, userId, [...HIRING_ROLES]],
    )
    if (!rows[0]) throw new Error('hiring_forbidden')
    return rows[0]
  }

  async function updateApplicationStatus(
    userId: string,
    applicationId: string,
    status: JobApplicationStatus,
    note: string | null,
  ) {
    return transaction(async (txQuery) => {
      await requireAuthorizedApplication(txQuery, userId, applicationId)
      await txQuery(
        `update public.job_applications
         set status = $2, updated_at = now()
         where id = $1`,
        [applicationId, status],
      )
      await txQuery(
        `insert into public.job_application_events (application_id, status, note, actor_id)
         values ($1, $2, $3, $4)`,
        [applicationId, status, note, userId],
      )
    })
  }

  async function saveRecruiterNote(userId: string, applicationId: string, note: string) {
    return transaction(async (txQuery) => {
      await requireAuthorizedApplication(txQuery, userId, applicationId)
      await txQuery(
        `insert into public.job_recruiter_notes (application_id, author_id, note)
         values ($1, $2, $3)`,
        [applicationId, userId, note],
      )
    })
  }

  return {
    getAuthorizedCompany,
    getDashboardMetrics,
    createJob,
    updateApplicationStatus,
    saveRecruiterNote,
  }
}

export const hiringRepository = createHiringRepository()
