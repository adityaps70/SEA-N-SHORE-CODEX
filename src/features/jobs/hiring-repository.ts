import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { scoreJobMatch } from './matching'
import type {
  JobApplicationEvent,
  JobApplicationStatus,
  JobCandidateProfile,
  JobCredential,
  JobDomain,
  JobListing,
  JobMatchResult,
  JobSalaryPeriod,
} from './types'

export const HIRING_ROLES = ['owner', 'administrator', 'recruiter'] as const
export type HiringRole = (typeof HIRING_ROLES)[number]
export type HiringJobStatus = 'draft' | 'published' | 'closed'

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

export type HiringJobUpdateInput = Omit<HiringJobInput, 'companyId'>

export type HiringJobSummary = {
  id: string
  title: string
  status: HiringJobStatus
  domain: JobDomain
  rank: string | null
  vesselTypes: string[]
  location: string | null
  urgent: boolean
  applyUntil: string | null
  publishedAt: string | null
  applicantCount: number
}

export type HiringEditableJob = HiringJobUpdateInput & {
  id: string
  companyId: string
}

export type HiringApplicantCandidate = {
  id: string
  slug: string | null
  fullName: string
  avatarPath: string | null
  location: string | null
  headline: string | null
  rank: string | null
  sailingExperienceYears: number | null
  vesselTypes: string[]
  tradingAreas: string[]
  availability: string | null
  shoreCareerPreference: boolean
  skills: string[]
  certificates: JobCredential[]
  visas: string[]
}

export type HiringApplicant = {
  applicationId: string
  status: JobApplicationStatus
  appliedAt: string
  updatedAt: string
  candidate: HiringApplicantCandidate
  match: JobMatchResult
}

export type HiringRecruiterNote = {
  id: string
  recruiterId: string
  note: string
  createdAt: string
}

export type HiringApplicationReview = HiringApplicant & {
  job: JobListing
  events: JobApplicationEvent[]
  recruiterNotes: HiringRecruiterNote[]
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

type HiringJobSummaryRow = QueryResultRow & {
  id: string
  title: string
  status: HiringJobStatus
  job_domain: string | null
  rank: string | null
  vessel_types: string[] | null
  location: string | null
  urgent: boolean | null
  apply_until: string | null
  published_at: string | null
  applicant_count: string | number | null
}

type EditableJobRow = QueryResultRow & {
  id: string
  company_id: string
  title: string
  status: 'draft' | 'published'
  job_domain: string | null
  department: string | null
  rank: string | null
  vessel_types: string[] | null
  location: string | null
  sailing_regions: string[] | null
  summary: string
  description: string
  requirements: string | null
  experience_min_years: string | number | null
  experience_max_years: string | number | null
  joining_from: string | null
  joining_until: string | null
  salary_min: string | number | null
  salary_max: string | number | null
  salary_currency: string | null
  salary_period: string | null
  urgent: boolean | null
  easy_apply: boolean | null
  apply_until: string | null
  certificates: string[] | null
  visas: string[] | null
}

type CredentialRow = { name: string; expires_at: string | null; verified: boolean }
type EventRow = { id: string | number; status: JobApplicationStatus; note: string | null; created_at: string }
type RecruiterNoteRow = { id: string; recruiter_id: string; note: string; created_at: string }

type ApplicantRow = QueryResultRow & {
  application_id: string
  application_status: JobApplicationStatus
  applied_at: string
  updated_at: string
  candidate_id: string
  candidate_slug: string | null
  candidate_name: string
  avatar_path: string | null
  candidate_location: string | null
  headline: string | null
  candidate_rank: string | null
  sailing_experience_years: string | number | null
  candidate_vessel_types: string[] | null
  trading_areas: string[] | null
  availability: string | null
  shore_career_preference: boolean | null
  skills: string[] | null
  credentials: CredentialRow[] | null
  visas: string[] | null
  job_id: string
  job_title: string
  company_name: string
  company_id: string | null
  company_slug: string | null
  company_verified: boolean | null
  recruiter_verified: boolean | null
  job_location: string | null
  job_summary: string
  job_description: string
  job_requirements: string | null
  apply_until: string | null
  job_created_at: string
  job_published_at: string | null
  job_domain: string | null
  department: string | null
  job_rank: string | null
  job_vessel_types: string[] | null
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
  events?: EventRow[] | null
  recruiter_notes?: RecruiterNoteRow[] | null
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
    and c.is_verified = true
` as const

const APPLICANT_SELECT = `
  select
    a.id as application_id,
    a.status::text as application_status,
    a.applied_at,
    a.updated_at,
    p.id as candidate_id,
    p.slug as candidate_slug,
    p.full_name as candidate_name,
    p.avatar_path,
    p.location as candidate_location,
    p.headline,
    mp.rank as candidate_rank,
    mp.sailing_experience_years,
    mp.vessel_types as candidate_vessel_types,
    mp.trading_areas,
    mp.availability,
    coalesce(mp.shore_career_preference, false) as shore_career_preference,
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
    ), '{}'::text[]) as visas,
    j.id as job_id,
    j.title as job_title,
    j.company_name,
    j.company_id,
    c.slug as company_slug,
    coalesce(c.is_verified, false) as company_verified,
    coalesce(rcm.is_verified, false) as recruiter_verified,
    j.location as job_location,
    j.summary as job_summary,
    j.description as job_description,
    j.requirements as job_requirements,
    j.apply_until,
    j.created_at as job_created_at,
    j.published_at as job_published_at,
    j.job_domain,
    j.department,
    j.rank as job_rank,
    j.vessel_types as job_vessel_types,
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
      select array_agg(cr.certificate_name order by cr.certificate_name)
      from public.job_certificate_requirements cr
      where cr.job_id = j.id and cr.required = true
    ), '{}'::text[]) as certificate_requirements,
    coalesce((
      select array_agg(vr.visa_name order by vr.visa_name)
      from public.job_visa_requirements vr
      where vr.job_id = j.id and vr.required = true
    ), '{}'::text[]) as visa_requirements
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

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function salaryPeriod(value: string | null | undefined): JobSalaryPeriod | null {
  return value === 'day' || value === 'month' || value === 'year' ? value : null
}

function jobDomain(value: string | null | undefined): JobDomain {
  return value === 'shore' ? 'shore' : 'sea'
}

function cleanRequirements(values: readonly string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function mapEditableJob(row: EditableJobRow): HiringEditableJob {
  return {
    id: row.id,
    companyId: row.company_id,
    title: row.title,
    domain: jobDomain(row.job_domain),
    department: row.department ?? null,
    rank: row.rank ?? null,
    vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
    location: row.location ?? null,
    regions: Array.isArray(row.sailing_regions) ? row.sailing_regions : [],
    summary: row.summary,
    description: row.description,
    requirements: row.requirements ?? null,
    experienceMinYears: numberOrNull(row.experience_min_years),
    experienceMaxYears: numberOrNull(row.experience_max_years),
    joiningFrom: row.joining_from ?? null,
    joiningUntil: row.joining_until ?? null,
    salaryMin: numberOrNull(row.salary_min),
    salaryMax: numberOrNull(row.salary_max),
    salaryCurrency: row.salary_currency ?? null,
    salaryPeriod: salaryPeriod(row.salary_period),
    urgent: Boolean(row.urgent),
    easyApply: row.easy_apply !== false,
    applyUntil: row.apply_until ?? null,
    status: row.status,
    certificates: Array.isArray(row.certificates) ? row.certificates : [],
    visas: Array.isArray(row.visas) ? row.visas : [],
  }
}

function mapCandidate(row: ApplicantRow): HiringApplicantCandidate {
  return {
    id: row.candidate_id,
    slug: row.candidate_slug ?? null,
    fullName: row.candidate_name,
    avatarPath: row.avatar_path ?? null,
    location: row.candidate_location ?? null,
    headline: row.headline ?? null,
    rank: row.candidate_rank ?? null,
    sailingExperienceYears: numberOrNull(row.sailing_experience_years),
    vesselTypes: Array.isArray(row.candidate_vessel_types) ? row.candidate_vessel_types : [],
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

function candidateProfile(candidate: HiringApplicantCandidate): JobCandidateProfile {
  return {
    rank: candidate.rank,
    sailingExperienceYears: candidate.sailingExperienceYears,
    vesselTypes: candidate.vesselTypes,
    tradingAreas: candidate.tradingAreas,
    availability: candidate.availability,
    shoreCareerPreference: candidate.shoreCareerPreference,
    skills: candidate.skills,
    certificates: candidate.certificates,
    visas: candidate.visas,
  }
}

function mapApplicantJob(row: ApplicantRow): JobListing {
  return {
    id: row.job_id,
    title: row.job_title,
    companyName: row.company_name,
    companyId: row.company_id ?? null,
    companySlug: row.company_slug ?? null,
    companyVerified: Boolean(row.company_verified),
    recruiterVerified: Boolean(row.recruiter_verified),
    location: row.job_location ?? null,
    summary: row.job_summary,
    description: row.job_description,
    requirements: row.job_requirements ?? null,
    applyUntil: row.apply_until ?? null,
    createdAt: row.job_created_at,
    publishedAt: row.job_published_at ?? null,
    domain: jobDomain(row.job_domain),
    department: row.department ?? null,
    rank: row.job_rank ?? null,
    vesselTypes: Array.isArray(row.job_vessel_types) ? row.job_vessel_types : [],
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

function mapHiringApplicant(row: ApplicantRow): HiringApplicant {
  const candidate = mapCandidate(row)
  const job = mapApplicantJob(row)
  return {
    applicationId: row.application_id,
    status: row.application_status,
    appliedAt: row.applied_at,
    updatedAt: row.updated_at,
    candidate,
    match: scoreJobMatch(job, candidateProfile(candidate)),
  }
}

function defaultTransaction<T>(work: (query: HiringQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

async function replaceJobRequirements(query: HiringQuery, jobId: string, certificates: string[], visas: string[]) {
  await query('delete from public.job_certificate_requirements where job_id = $1', [jobId])
  for (const certificate of cleanRequirements(certificates)) {
    await query(
      `insert into public.job_certificate_requirements (job_id, certificate_name, required)
       values ($1, $2, true)`,
      [jobId, certificate],
    )
  }

  await query('delete from public.job_visa_requirements where job_id = $1', [jobId])
  for (const visa of cleanRequirements(visas)) {
    await query(
      `insert into public.job_visa_requirements (job_id, visa_name, required)
       values ($1, $2, true)`,
      [jobId, visa],
    )
  }
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
         join public.companies c on c.id = cm.company_id
         where cm.user_id = $1
           and cm.approved_at is not null
           and cm.role::text = any($2::text[])
           and cm.company_id = $3
           and c.is_verified = true
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

  async function listCompanyJobs(userId: string, companyId: string): Promise<HiringJobSummary[]> {
    const rows = await queryRows(
      `with authorised_company as (
         select cm.company_id
         from public.company_members cm
         join public.companies c on c.id = cm.company_id
         where cm.user_id = $1
           and cm.approved_at is not null
           and cm.role::text = any($2::text[])
           and cm.company_id = $3
           and c.is_verified = true
       )
       select
         j.id,
         j.title,
         j.status::text as status,
         j.job_domain,
         j.rank,
         j.vessel_types,
         j.location,
         j.urgent,
         j.apply_until,
         j.published_at,
         count(a.id) as applicant_count
       from public.jobs j
       join authorised_company ac on ac.company_id = j.company_id
       left join public.job_applications a on a.job_id = j.id
       where j.company_id = $3
       group by j.id
       order by j.created_at desc, j.id desc`,
      [userId, [...HIRING_ROLES], companyId],
    ) as HiringJobSummaryRow[]

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      domain: jobDomain(row.job_domain),
      rank: row.rank ?? null,
      vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
      location: row.location ?? null,
      urgent: Boolean(row.urgent),
      applyUntil: row.apply_until ?? null,
      publishedAt: row.published_at ?? null,
      applicantCount: numberValue(row.applicant_count),
    }))
  }

  async function getEditableJob(userId: string, companyId: string, jobId: string): Promise<HiringEditableJob | null> {
    const rows = await queryRows(
      `select
         j.id,
         j.company_id,
         j.title,
         j.status::text as status,
         j.job_domain,
         j.department,
         j.rank,
         j.vessel_types,
         j.location,
         j.sailing_regions,
         j.summary,
         j.description,
         j.requirements,
         j.experience_min_years,
         j.experience_max_years,
         j.joining_from,
         j.joining_until,
         j.salary_min,
         j.salary_max,
         j.salary_currency,
         j.salary_period,
         j.urgent,
         j.easy_apply,
         j.apply_until,
         coalesce((
           select array_agg(cr.certificate_name order by cr.certificate_name)
           from public.job_certificate_requirements cr
           where cr.job_id = j.id and cr.required = true
         ), '{}'::text[]) as certificates,
         coalesce((
           select array_agg(vr.visa_name order by vr.visa_name)
           from public.job_visa_requirements vr
           where vr.job_id = j.id and vr.required = true
         ), '{}'::text[]) as visas
       from public.jobs j
       join public.company_members cm on cm.company_id = j.company_id
       join public.companies c on c.id = j.company_id
       where cm.user_id = $1
         and j.company_id = $2
         and j.id = $3
         and cm.approved_at is not null
         and cm.role::text = any($4::text[])
         and c.is_verified = true
         and j.status <> 'closed'
       limit 1`,
      [userId, companyId, jobId, [...HIRING_ROLES]],
    ) as EditableJobRow[]
    return rows[0] ? mapEditableJob(rows[0]) : null
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

      for (const certificate of cleanRequirements(job.certificates)) {
        await txQuery(
          `insert into public.job_certificate_requirements (job_id, certificate_name, required)
           values ($1, $2, true)
           on conflict (job_id, certificate_name) do update set required = excluded.required`,
          [jobId, certificate],
        )
      }
      for (const visa of cleanRequirements(job.visas)) {
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

  async function requireAuthorizedJob(query: HiringQuery, userId: string, jobId: string) {
    const rows = await query(
      `select j.id, j.company_id
       from public.jobs j
       join public.company_members cm on cm.company_id = j.company_id
       join public.companies c on c.id = j.company_id
       where j.id = $1
         and cm.user_id = $2
         and cm.approved_at is not null
         and cm.role::text = any($3::text[])
         and c.is_verified = true
       limit 1`,
      [jobId, userId, [...HIRING_ROLES]],
    )
    if (!rows[0]) throw new Error('hiring_forbidden')
    return rows[0]
  }

  async function updateJob(userId: string, jobId: string, job: HiringJobUpdateInput) {
    return transaction(async (txQuery) => {
      await requireAuthorizedJob(txQuery, userId, jobId)
      await txQuery(
        `update public.jobs
         set title = $2,
             location = $3,
             summary = $4,
             description = $5,
             requirements = $6,
             apply_until = $7,
             status = $8,
             job_domain = $9,
             department = $10,
             rank = $11,
             vessel_types = $12::text[],
             experience_min_years = $13,
             experience_max_years = $14,
             joining_from = $15,
             joining_until = $16,
             salary_min = $17,
             salary_max = $18,
             salary_currency = $19,
             salary_period = $20,
             sailing_regions = $21::text[],
             urgent = $22,
             easy_apply = $23,
             published_at = case when $8 = 'published' then coalesce(published_at, now()) else published_at end,
             updated_at = now()
         where id = $1`,
        [
          jobId, job.title, job.location, job.summary, job.description, job.requirements, job.applyUntil, job.status,
          job.domain, job.department, job.rank, job.vesselTypes, job.experienceMinYears, job.experienceMaxYears,
          job.joiningFrom, job.joiningUntil, job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod,
          job.regions, job.urgent, job.easyApply,
        ],
      )
      await replaceJobRequirements(txQuery, jobId, job.certificates, job.visas)
    })
  }

  async function listApplicants(userId: string, jobId: string, status?: JobApplicationStatus): Promise<HiringApplicant[]> {
    const values: unknown[] = [userId, jobId, [...HIRING_ROLES]]
    const statusFilter = status ? 'and a.status = $4' : ''
    if (status) values.push(status)
    const rows = await queryRows(
      `${APPLICANT_SELECT}
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       join public.company_members cm on cm.company_id = j.company_id
       join public.profiles p on p.id = a.applicant_id
       left join public.maritime_profiles mp on mp.user_id = p.id
       join public.companies c on c.id = j.company_id
       left join public.company_members rcm on rcm.company_id = j.company_id and rcm.user_id = j.created_by_user_id
       where cm.user_id = $1
         and j.id = $2
         and cm.role::text = any($3::text[])
         and cm.approved_at is not null
         and c.is_verified = true
         ${statusFilter}
       order by a.applied_at desc, a.id desc`,
      values,
    ) as ApplicantRow[]

    return rows.map(mapHiringApplicant).sort((left, right) => right.match.score - left.match.score || right.appliedAt.localeCompare(left.appliedAt))
  }

  async function getApplicationReview(userId: string, applicationId: string): Promise<HiringApplicationReview | null> {
    const rows = await queryRows(
      `${APPLICANT_SELECT},
       coalesce((
         select json_agg(json_build_object(
           'id', e.id::text,
           'status', e.status::text,
           'note', e.note,
           'created_at', e.created_at
         ) order by e.created_at asc, e.id asc)
         from public.job_application_events e
         where e.application_id = a.id
       ), '[]'::json) as events,
       coalesce((
         select json_agg(json_build_object(
           'id', rn.id,
           'recruiter_id', rn.recruiter_id,
           'note', rn.note,
           'created_at', rn.created_at
         ) order by rn.created_at desc, rn.id desc)
         from public.job_recruiter_notes rn
         where rn.application_id = a.id
       ), '[]'::json) as recruiter_notes
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       join public.company_members cm on cm.company_id = j.company_id
       join public.profiles p on p.id = a.applicant_id
       left join public.maritime_profiles mp on mp.user_id = p.id
       join public.companies c on c.id = j.company_id
       left join public.company_members rcm on rcm.company_id = j.company_id and rcm.user_id = j.created_by_user_id
       where cm.user_id = $1
         and a.id = $2
         and cm.role::text = any($3::text[])
         and cm.approved_at is not null
         and c.is_verified = true
       limit 1`,
      [userId, applicationId, [...HIRING_ROLES]],
    ) as ApplicantRow[]
    const row = rows[0]
    if (!row) return null
    const applicant = mapHiringApplicant(row)
    return {
      ...applicant,
      job: mapApplicantJob(row),
      events: Array.isArray(row.events)
        ? row.events.map((event) => ({
            id: String(event.id),
            status: event.status,
            note: event.note ?? null,
            createdAt: event.created_at,
          }))
        : [],
      recruiterNotes: Array.isArray(row.recruiter_notes)
        ? row.recruiter_notes.map((note) => ({
            id: note.id,
            recruiterId: note.recruiter_id,
            note: note.note,
            createdAt: note.created_at,
          }))
        : [],
    }
  }

  async function requireAuthorizedApplication(query: HiringQuery, userId: string, applicationId: string) {
    const rows = await query(
      `select a.id, j.company_id
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       join public.company_members cm on cm.company_id = j.company_id
       join public.companies c on c.id = j.company_id
       where a.id = $1
         and cm.user_id = $2
         and cm.approved_at is not null
         and cm.role::text = any($3::text[])
         and c.is_verified = true
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
        `insert into public.job_recruiter_notes (application_id, recruiter_id, note)
         values ($1, $2, $3)`,
        [applicationId, userId, note],
      )
    })
  }

  return {
    getAuthorizedCompany,
    getDashboardMetrics,
    listCompanyJobs,
    getEditableJob,
    createJob,
    updateJob,
    listApplicants,
    getApplicationReview,
    updateApplicationStatus,
    saveRecruiterNote,
  }
}

export const hiringRepository = createHiringRepository()