import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import type { JobApplication, JobApplicationStatus, JobListing } from './types'

type JobsQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type JobRow = QueryResultRow & {
  id: string
  title: string
  company_name: string
  location: string | null
  summary: string
  description: string
  requirements: string | null
  apply_until: string | null
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
}

function mapJob(row: JobRow): JobListing {
  return {
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    location: row.location,
    summary: row.summary,
    description: row.description,
    requirements: row.requirements,
    applyUntil: row.apply_until,
    createdAt: row.created_at,
  }
}

function mapApplication(row: ApplicationRow): JobApplication {
  return {
    id: row.id,
    status: row.status,
    appliedAt: row.applied_at,
    updatedAt: row.updated_at,
    job: {
      id: row.job_id,
      title: row.title,
      companyName: row.company_name,
      location: row.location,
    },
  }
}

const JOB_SELECT = `
  select
    j.id,
    j.title,
    j.company_name,
    j.location,
    j.summary,
    j.description,
    j.requirements,
    j.apply_until,
    j.created_at
  from public.jobs j
` as const

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

  async function listApplications(applicantId: string, limit = 50): Promise<JobApplication[]> {
    const rows = await queryRows(
      `select
         a.id,
         a.status::text as status,
         a.applied_at,
         a.updated_at,
         j.id as job_id,
         j.title,
         j.company_name,
         j.location
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       where a.applicant_id = $1
       order by a.applied_at desc, a.id desc
       limit $2`,
      [applicantId, limit],
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

  async function createApplication(jobId: string, applicantId: string): Promise<void> {
    await queryRows(
      `insert into public.job_applications (job_id, applicant_id, status)
       values ($1, $2, 'applied')`,
      [jobId, applicantId],
    )
  }

  return {
    listPublishedJobs,
    getPublishedJob,
    listApplications,
    hasApplied,
    createApplication,
  }
}

export type JobsRepository = ReturnType<typeof createJobsRepository>

export const jobsRepository = createJobsRepository()
