import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { planVisibleSql } from '@/features/billing/plan-visibility'
import { scoreJobMatch } from './matching'
import { PERSONAS, type Persona } from '@/features/profiles/persona'
import { jobDepartmentDisplay, jobRankDisplay, roleDisplayLabel } from '@/features/roles/taxonomy'
import type { JobApplicationCvReference } from './application-media'
import { validateApplicationStatusChange } from './application-status'
import type { JobLifecycleSnapshot } from './job-lifecycle'
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
  publisherType: 'personal' | 'organization'
  companyId: string | null
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
  joiningUntil?: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: JobSalaryPeriod | null
  urgent: boolean
  easyApply: boolean
  applyUntil: string | null
  status: HiringJobStatus
  certificates: string[]
  visas: string[]
  /** Round 12: department and accepted ranks / roles (taxonomy keys), and the minimum match to apply (0 = off). */
  departmentKey?: string | null
  acceptedRoleKeys?: string[]
  roleOtherText?: string | null
  minMatchToApply?: number
}

/** Job details that can be edited. The lifecycle status only changes through job-lifecycle.ts. */
export type HiringJobUpdateInput = Omit<HiringJobInput, 'publisherType' | 'companyId' | 'status'>

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
  companyId: string | null
  status: HiringJobStatus
}

export type HiringPersonalPublisher = {
  profileId: string
  name: string
}

export type ManagedHiringJobSummary = HiringJobSummary & {
  companyId: string | null
  publisherName: string
  companySlug: string | null
  companyLogoPath: string | null
  companyLocation: string | null
  companyVerified: boolean
  joiningUntil: string | null
  createdAt: string | null
  archivedAt: string | null
  newApplicantCount: number
  moderationRemoved: boolean
  canDelete: boolean
  /** Nobody else can see it because the owner's plan ended (kept; back on renewal). */
  hiddenForPlan?: boolean
}

export type HiringJobStateChange = {
  from: HiringJobStatus
  to: HiringJobStatus
  applyUntil: string | null
}

export type HiringApplicantCandidate = {
  id: string
  slug: string | null
  /** False when the member deactivated, was suspended or asked to delete their account. */
  accountActive: boolean
  fullName: string
  avatarPath: string | null
  location: string | null
  headline: string | null
  rank: string | null
  /** Round 12: profile type and structured rank keys, for the same match the candidate sees. */
  persona?: Persona | null
  profileType?: string | null
  roleKey?: string | null
  roleOtherText?: string | null
  cadetStageKey?: string | null
  targetRoleKey?: string | null
  occupationText?: string | null
  experienceTitles?: string[]
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
  coverNote: string | null
  candidate: HiringApplicantCandidate
  cvAttachment: JobApplicationCvReference | null
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
  jobStatus: HiringJobStatus
  events: JobApplicationEvent[]
  recruiterNotes: HiringRecruiterNote[]
}

export type HiringApplicationCvAccess = {
  viewer: 'applicant' | 'hiring'
  cv: JobApplicationCvReference | null
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
  apply_until: string | Date | null
  published_at: string | Date | null
  applicant_count: string | number | null
  company_id?: string | null
  publisher_name?: string | null
}

type ManagedJobRow = HiringJobSummaryRow & {
  company_slug?: string | null
  company_logo_path?: string | null
  company_location?: string | null
  company_verified?: boolean | null
  joining_until?: string | Date | null
  created_at?: string | Date | null
  archived_at?: string | Date | null
  new_applicant_count?: string | number | null
  moderation_removed?: boolean | null
  can_delete?: boolean | null
  hidden_for_plan?: boolean | null
}

type PersonalPublisherRow = QueryResultRow & {
  profile_id: string
  profile_name: string
  recruiter_verified?: boolean | null
}

type EditableJobRow = QueryResultRow & {
  id: string
  company_id: string | null
  title: string
  status: HiringJobStatus
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
  joining_from: string | Date | null
  joining_until: string | Date | null
  salary_min: string | number | null
  salary_max: string | number | null
  salary_currency: string | null
  salary_period: string | null
  urgent: boolean | null
  easy_apply: boolean | null
  apply_until: string | Date | null
  certificates: string[] | null
  visas: string[] | null
  department_key?: string | null
  accepted_role_keys?: string[] | null
  role_other_text?: string | null
  min_match_to_apply?: string | number | null
}

type CredentialRow = { name: string; expires_at: string | null; verified: boolean }
type EventRow = { id: string | number; status: JobApplicationStatus; note: string | null; created_at: string }
type RecruiterNoteRow = { id: string; recruiter_id: string; note: string; created_at: string }
type ApplicationPublisherScopeRow = QueryResultRow & {
  company_id: string | null
  application_status?: JobApplicationStatus | null
}

type ApplicationCvRow = QueryResultRow & {
  cv_storage_path: string | null
  cv_file_name: string | null
  cv_mime_type: string | null
  cv_size_bytes: string | number | null
  is_applicant: boolean | null
}

type ApplicantRow = QueryResultRow & {
  application_id: string
  application_status: JobApplicationStatus
  applied_at: string | Date
  updated_at: string | Date
  cover_note?: string | null
  cv_storage_path: string | null
  cv_file_name: string | null
  cv_mime_type: string | null
  cv_size_bytes: string | number | null
  candidate_id: string
  candidate_slug: string | null
  candidate_account_status?: string | null
  candidate_name: string
  avatar_path: string | null
  candidate_location: string | null
  headline: string | null
  candidate_rank: string | null
  candidate_persona?: string | null
  candidate_profile_type?: string | null
  candidate_role_key?: string | null
  candidate_role_other_text?: string | null
  candidate_cadet_stage_key?: string | null
  candidate_target_role_key?: string | null
  candidate_occupation_text?: string | null
  candidate_experience_titles?: string[] | null
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
  company_logo_path?: string | null
  company_location?: string | null
  company_verified: boolean | null
  recruiter_verified: boolean | null
  job_location: string | null
  job_summary: string
  job_description: string
  job_requirements: string | null
  apply_until: string | Date | null
  job_created_at: string | Date
  job_published_at: string | Date | null
  job_status?: HiringJobStatus | null
  job_domain: string | null
  department: string | null
  job_rank: string | null
  job_department_key?: string | null
  job_accepted_role_keys?: string[] | null
  job_role_other_text?: string | null
  job_min_match_to_apply?: string | number | null
  job_vessel_types: string[] | null
  experience_min_years: string | number | null
  experience_max_years: string | number | null
  joining_from: string | Date | null
  joining_until: string | Date | null
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

/**
 * Who may manage a job: its poster (personal jobs), or an approved owner, administrator or
 * recruiter of the verified organization that owns it. Requires `j`, `cm` (the viewer's
 * membership of j.company_id) and `c` (the owning company) in scope.
 */
function manageAccessSql(userParam: string, rolesParam: string) {
  return `(
           (j.company_id is null and j.created_by_user_id = ${userParam})
           or (
             j.company_id is not null
             and cm.approved_at is not null
             and cm.role::text = any(${rolesParam}::text[])
             and c.is_verified = true
           )
         )`
}

/** Who may delete a job: its poster, or an owner or administrator of the owning organization. */
function deleteAccessSql(userParam: string, rolesParam: string) {
  return `(
           (j.company_id is null and j.created_by_user_id = ${userParam})
           or (
             j.company_id is not null
             and cm.approved_at is not null
             and c.is_verified = true
             and (
               cm.role::text in ('owner', 'administrator')
               or (j.created_by_user_id = ${userParam} and cm.role::text = any(${rolesParam}::text[]))
             )
           )
         )`
}

/** True when the most recent Sea N Shore moderation decision on the job removed it. */
const MODERATION_REMOVED_SQL = `coalesce((
           select ma.action = 'remove'
           from public.moderation_actions ma
           where ma.target_type = 'job'
             and ma.target_id = j.id
             and ma.action in ('remove', 'restore')
           order by ma.created_at desc, ma.id desc
           limit 1
         ), false)` as const

function managedJobSelect(userParam: string, rolesParam: string) {
  return `select
         j.id,
         j.title,
         j.status::text as status,
         j.job_domain,
         j.rank,
         j.vessel_types,
         j.location,
         j.urgent,
         j.apply_until,
         j.joining_until,
         j.published_at,
         j.created_at,
         j.archived_at,
         j.company_id,
         coalesce(c.name, j.company_name) as publisher_name,
         c.slug as company_slug,
         c.logo_path as company_logo_path,
         c.office_locations[1] as company_location,
         coalesce(c.is_verified, false) as company_verified,
         (select count(*) from public.job_applications a where a.job_id = j.id) as applicant_count,
         (select count(*) from public.job_applications a where a.job_id = j.id and a.status = 'applied') as new_applicant_count,
         ${MODERATION_REMOVED_SQL} as moderation_removed,
         not ${planVisibleSql('job', 'j')} as hidden_for_plan,
         ${deleteAccessSql(userParam, rolesParam)} as can_delete
       from public.jobs j
       left join public.companies c on c.id = j.company_id
       left join public.company_members cm
         on cm.company_id = j.company_id and cm.user_id = ${userParam}
       where j.deleted_at is null
         and ${manageAccessSql(userParam, rolesParam)}`
}

const APPLICANT_SELECT = `
  select
    a.id as application_id,
    a.status::text as application_status,
    a.applied_at,
    a.updated_at,
    a.cover_note,
    a.cv_storage_path,
    a.cv_file_name,
    a.cv_mime_type,
    a.cv_size_bytes,
    p.id as candidate_id,
    p.slug as candidate_slug,
    p.account_status::text as candidate_account_status,
    p.full_name as candidate_name,
    p.avatar_path,
    p.location as candidate_location,
    p.headline,
    mp.rank as candidate_rank,
    p.persona as candidate_persona,
    p.profile_type::text as candidate_profile_type,
    p.role_key as candidate_role_key,
    p.role_other_text as candidate_role_other_text,
    p.cadet_stage_key as candidate_cadet_stage_key,
    p.target_role_key as candidate_target_role_key,
    p.occupation_text as candidate_occupation_text,
    coalesce((
      select array_agg(pe.title order by pe.sort_order, pe.title)
      from public.profile_experiences pe
      where pe.profile_id = p.id and pe.track in ('shore_role', 'other_maritime')
    ), '{}'::text[]) as candidate_experience_titles,
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
    j.status::text as job_status,
    coalesce(c.name, j.company_name) as company_name,
    j.company_id,
    c.slug as company_slug,
    c.logo_path as company_logo_path,
    c.office_locations[1] as company_location,
    coalesce(c.is_verified, false) as company_verified,
    case
      when j.company_id is null then exists (
        select 1
        from public.feature_verifications fv
        where fv.profile_id = j.created_by_user_id
          and fv.verification_type = 'recruiter'
          and fv.status = 'approved'
      )
      else coalesce(rcm.is_verified, false)
    end as recruiter_verified,
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
    j.department_key as job_department_key,
    j.accepted_role_keys as job_accepted_role_keys,
    j.role_other_text as job_role_other_text,
    j.min_match_to_apply as job_min_match_to_apply,
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

function dateInputValue(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  const normalized = value.trim()
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? null
}

function timestampValue(value: string | Date): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  return value
}

function nullableTimestampValue(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return timestampValue(value) || null
}

function mapHiringJobSummary(row: HiringJobSummaryRow): HiringJobSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    domain: jobDomain(row.job_domain),
    rank: row.rank ?? null,
    vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
    location: row.location ?? null,
    urgent: Boolean(row.urgent),
    applyUntil: dateInputValue(row.apply_until),
    publishedAt: nullableTimestampValue(row.published_at),
    applicantCount: numberValue(row.applicant_count),
  }
}

function mapManagedJob(row: ManagedJobRow): ManagedHiringJobSummary {
  return {
    ...mapHiringJobSummary(row),
    companyId: row.company_id ?? null,
    publisherName: row.publisher_name ?? 'Personal recruiter',
    companySlug: row.company_slug ?? null,
    companyLogoPath: row.company_logo_path ?? null,
    companyLocation: row.company_location ?? null,
    companyVerified: Boolean(row.company_verified),
    joiningUntil: dateInputValue(row.joining_until),
    createdAt: nullableTimestampValue(row.created_at),
    archivedAt: nullableTimestampValue(row.archived_at),
    newApplicantCount: numberValue(row.new_applicant_count),
    moderationRemoved: Boolean(row.moderation_removed),
    canDelete: Boolean(row.can_delete),
    hiddenForPlan: row.hidden_for_plan === true,
  }
}

/** Lifecycle view of a managed job, for job-lifecycle.ts. */
export function managedJobLifecycle(job: ManagedHiringJobSummary): JobLifecycleSnapshot {
  return {
    status: job.status,
    deleted: false,
    moderationRemoved: job.moderationRemoved,
    applyUntil: job.applyUntil,
    joiningUntil: job.joiningUntil,
    applicantCount: job.applicantCount,
    canDelete: job.canDelete,
  }
}

/** A stored minimum match, 70 when the column is missing (before migration 0062). */
export function minMatchValue(value: string | number | null | undefined): number {
  const parsed = numberOrNull(value ?? null)
  return parsed === null ? 70 : Math.min(100, Math.max(0, Math.round(parsed)))
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
    joiningFrom: dateInputValue(row.joining_from),
    joiningUntil: dateInputValue(row.joining_until),
    salaryMin: numberOrNull(row.salary_min),
    salaryMax: numberOrNull(row.salary_max),
    salaryCurrency: row.salary_currency ?? null,
    salaryPeriod: salaryPeriod(row.salary_period),
    urgent: Boolean(row.urgent),
    easyApply: row.easy_apply !== false,
    applyUntil: dateInputValue(row.apply_until),
    status: row.status,
    certificates: Array.isArray(row.certificates) ? row.certificates : [],
    visas: Array.isArray(row.visas) ? row.visas : [],
    departmentKey: row.department_key ?? null,
    acceptedRoleKeys: Array.isArray(row.accepted_role_keys) ? row.accepted_role_keys : [],
    roleOtherText: row.role_other_text ?? null,
    minMatchToApply: minMatchValue(row.min_match_to_apply),
  }
}

function mapCandidate(row: ApplicantRow): HiringApplicantCandidate {
  const accountActive = (row.candidate_account_status ?? 'active') === 'active'
  return {
    id: row.candidate_id,
    slug: accountActive ? row.candidate_slug ?? null : null,
    accountActive,
    fullName: accountActive ? row.candidate_name : 'Former Sea N Shore member',
    avatarPath: accountActive ? row.avatar_path ?? null : null,
    location: row.candidate_location ?? null,
    headline: row.headline ?? null,
    rank: roleDisplayLabel({ roleKey: row.candidate_role_key, otherText: row.candidate_role_other_text, legacyText: row.candidate_rank }),
    persona: PERSONAS.find((persona) => persona === row.candidate_persona) ?? null,
    profileType: row.candidate_profile_type ?? null,
    roleKey: row.candidate_role_key ?? null,
    roleOtherText: row.candidate_role_other_text ?? null,
    cadetStageKey: row.candidate_cadet_stage_key ?? null,
    targetRoleKey: row.candidate_target_role_key ?? null,
    occupationText: row.candidate_occupation_text ?? null,
    experienceTitles: Array.isArray(row.candidate_experience_titles) ? row.candidate_experience_titles : [],
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
    persona: candidate.persona ?? null,
    profileType: candidate.profileType ?? null,
    roleKey: candidate.roleKey ?? null,
    roleOtherText: candidate.roleOtherText ?? null,
    cadetStageKey: candidate.cadetStageKey ?? null,
    targetRoleKey: candidate.targetRoleKey ?? null,
    headline: candidate.headline,
    occupationText: candidate.occupationText ?? null,
    experienceTitles: candidate.experienceTitles ?? [],
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
    companyLogoPath: row.company_logo_path ?? null,
    companyLocation: row.company_location ?? null,
    companyVerified: Boolean(row.company_verified),
    recruiterVerified: Boolean(row.recruiter_verified),
    location: row.job_location ?? null,
    summary: row.job_summary,
    description: row.job_description,
    requirements: row.job_requirements ?? null,
    applyUntil: dateInputValue(row.apply_until),
    createdAt: timestampValue(row.job_created_at),
    publishedAt: nullableTimestampValue(row.job_published_at),
    domain: jobDomain(row.job_domain),
    department: jobDepartmentDisplay({ departmentKey: row.job_department_key, department: row.department }),
    rank: jobRankDisplay({ acceptedRoleKeys: row.job_accepted_role_keys, roleOtherText: row.job_role_other_text, rank: row.job_rank }),
    departmentKey: row.job_department_key ?? null,
    acceptedRoleKeys: Array.isArray(row.job_accepted_role_keys) ? row.job_accepted_role_keys : [],
    roleOtherText: row.job_role_other_text ?? null,
    minMatchToApply: minMatchValue(row.job_min_match_to_apply),
    vesselTypes: Array.isArray(row.job_vessel_types) ? row.job_vessel_types : [],
    experienceMinYears: numberOrNull(row.experience_min_years),
    experienceMaxYears: numberOrNull(row.experience_max_years),
    joiningFrom: dateInputValue(row.joining_from),
    joiningUntil: dateInputValue(row.joining_until),
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
    appliedAt: timestampValue(row.applied_at),
    updatedAt: timestampValue(row.updated_at),
    coverNote: row.cover_note?.trim() ? row.cover_note : null,
    candidate,
    cvAttachment: cvReference(row),
    match: scoreJobMatch(job, candidateProfile(candidate)),
  }
}

function cvReference(
  row: Pick<ApplicantRow, 'cv_storage_path' | 'cv_file_name' | 'cv_mime_type' | 'cv_size_bytes'>,
): JobApplicationCvReference | null {
  const sizeBytes = numberOrNull(row.cv_size_bytes)
  if (!row.cv_storage_path || !row.cv_file_name || row.cv_mime_type !== 'application/pdf' || sizeBytes === null) return null
  return {
    storagePath: row.cv_storage_path,
    fileName: row.cv_file_name,
    mimeType: 'application/pdf',
    sizeBytes,
  }
}

/** Best match first (no score last), then the most recent application. Dates are ISO strings at this point. */
function compareApplicants(left: HiringApplicant, right: HiringApplicant) {
  return (right.match.score ?? -1) - (left.match.score ?? -1)
    || right.appliedAt.localeCompare(left.appliedAt)
    || left.applicationId.localeCompare(right.applicationId)
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

  async function listAuthorizedCompaniesWithQuery(query: HiringQuery, userId: string) {
    const rows = await query(
      `${AUTHORIZED_COMPANY_SELECT}
       order by cm.approved_at asc nulls last, c.name asc, c.id asc`,
      [userId, [...HIRING_ROLES]],
    ) as CompanyRow[]
    return rows.flatMap((row) => {
      const company = mapAuthorizedCompany(row)
      return company ? [company] : []
    })
  }

  async function getAuthorizedCompanyWithQuery(query: HiringQuery, userId: string, companyId?: string) {
    if (!companyId) {
      return (await listAuthorizedCompaniesWithQuery(query, userId))[0] ?? null
    }
    const rows = await query(
      `${AUTHORIZED_COMPANY_SELECT}
       and c.id = $3
       order by cm.approved_at asc nulls last, c.name asc
       limit 1`,
      [userId, [...HIRING_ROLES], companyId],
    ) as CompanyRow[]
    return mapAuthorizedCompany(rows[0])
  }

  async function getAuthorizedCompany(userId: string, companyId?: string) {
    return getAuthorizedCompanyWithQuery(queryRows, userId, companyId)
  }

  async function listAuthorizedCompanies(userId: string) {
    return listAuthorizedCompaniesWithQuery(queryRows, userId)
  }

  async function getPersonalPublisher(userId: string): Promise<HiringPersonalPublisher | null> {
    const rows = await queryRows(
      `select p.id as profile_id, p.full_name as profile_name
       from public.profiles p
       where p.id = $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
       limit 1`,
      [userId],
    ) as PersonalPublisherRow[]
    const row = rows[0]
    return row ? { profileId: row.profile_id, name: row.profile_name } : null
  }

  async function getPersonalRecruiterPublisherWithQuery(query: HiringQuery, userId: string) {
    const rows = await query(
      `select
         p.id as profile_id,
         p.full_name as profile_name,
         exists (
           select 1
           from public.feature_verifications fv
           where fv.profile_id = p.id
             and fv.verification_type = 'recruiter'
             and fv.status = 'approved'
         ) as recruiter_verified
       from public.profiles p
       where p.id = $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
       limit 1`,
      [userId],
    ) as PersonalPublisherRow[]
    const row = rows[0]
    if (!row || !row.recruiter_verified) return null
    return { profileId: row.profile_id, name: row.profile_name }
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
       join public.jobs j on j.company_id = ac.company_id and j.deleted_at is null
       left join public.job_applications a on a.job_id = j.id
       where j.company_id = $3`,
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
         and j.deleted_at is null
       group by j.id
       order by j.created_at desc, j.id desc`,
      [userId, [...HIRING_ROLES], companyId],
    ) as HiringJobSummaryRow[]

    return rows.map(mapHiringJobSummary)
  }

  async function getManagedDashboardMetrics(userId: string): Promise<HiringDashboardMetrics> {
    const rows = await queryRows(
      `with authorised_jobs as (
         select j.id
         from public.jobs j
         where j.deleted_at is null
           and (
             (j.company_id is null and j.created_by_user_id = $1)
             or exists (
               select 1
               from public.company_members cm
               join public.companies c on c.id = cm.company_id
               where cm.company_id = j.company_id
                 and cm.user_id = $1
                 and cm.approved_at is not null
                 and cm.role::text = any($2::text[])
                 and c.is_verified = true
             )
           )
       )
       select
         count(distinct j.id) filter (where j.status = 'published' and (j.apply_until is null or j.apply_until >= current_date)) as active_jobs,
         count(a.id) as applicants,
         count(a.id) filter (where a.status = 'shortlisted') as shortlisted,
         count(a.id) filter (where a.status = 'interview') as interviews,
         count(a.id) filter (where a.status = 'selected') as selected
       from authorised_jobs aj
       join public.jobs j on j.id = aj.id
       left join public.job_applications a on a.job_id = j.id`,
      [userId, [...HIRING_ROLES]],
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

  /** Every job the viewer may manage (personal and organization), newest first, excluding deleted jobs. */
  async function listManagedJobs(userId: string): Promise<ManagedHiringJobSummary[]> {
    const rows = await queryRows(
      `${managedJobSelect('$1', '$2')}
       order by j.created_at desc, j.id desc`,
      [userId, [...HIRING_ROLES]],
    ) as ManagedJobRow[]
    return rows.map(mapManagedJob)
  }

  async function getManagedJobWithQuery(query: HiringQuery, userId: string, jobId: string) {
    const rows = await query(
      `${managedJobSelect('$1', '$2')}
         and j.id = $3
       limit 1`,
      [userId, [...HIRING_ROLES], jobId],
    ) as ManagedJobRow[]
    return rows[0] ? mapManagedJob(rows[0]) : null
  }

  /** One job the viewer may manage, with its lifecycle facts, or null when not authorized or deleted. */
  async function getManagedJob(userId: string, jobId: string): Promise<ManagedHiringJobSummary | null> {
    return getManagedJobWithQuery(queryRows, userId, jobId)
  }

  const EDITABLE_JOB_FIELDS = `
      select
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
        j.department_key,
        j.accepted_role_keys,
        j.role_other_text,
        j.min_match_to_apply,
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
    `

  async function getManagedEditableJob(userId: string, jobId: string): Promise<HiringEditableJob | null> {
    const rows = await queryRows(
      `${EDITABLE_JOB_FIELDS}
       left join public.company_members cm
         on cm.company_id = j.company_id and cm.user_id = $1
       left join public.companies c on c.id = j.company_id
       where j.id = $2
         and j.deleted_at is null
         and ${manageAccessSql('$1', '$3')}
       limit 1`,
      [userId, jobId, [...HIRING_ROLES]],
    ) as EditableJobRow[]
    return rows[0] ? mapEditableJob(rows[0]) : null
  }

  async function getEditableJob(
    userId: string,
    companyId: string | null,
    jobId: string,
  ): Promise<HiringEditableJob | null> {
    if (companyId === null) {
      const rows = await queryRows(
        `${EDITABLE_JOB_FIELDS}
         where j.created_by_user_id = $1
           and j.id = $2
           and j.company_id is null
           and j.deleted_at is null
         limit 1`,
        [userId, jobId],
      ) as EditableJobRow[]
      return rows[0] ? mapEditableJob(rows[0]) : null
    }

    const rows = await queryRows(
      `${EDITABLE_JOB_FIELDS}
       join public.company_members cm on cm.company_id = j.company_id
       join public.companies c on c.id = j.company_id
       where cm.user_id = $1
         and j.company_id = $2
         and j.id = $3
         and j.deleted_at is null
         and cm.approved_at is not null
         and cm.role::text = any($4::text[])
         and c.is_verified = true
       limit 1`,
      [userId, companyId, jobId, [...HIRING_ROLES]],
    ) as EditableJobRow[]
    return rows[0] ? mapEditableJob(rows[0]) : null
  }

  async function createJob(userId: string, job: HiringJobInput) {
    return transaction(async (txQuery) => {
      let publisherName: string
      let publisherCompanyId: string | null

      if (job.publisherType === 'organization') {
        if (!job.companyId) throw new Error('hiring_forbidden')
        const company = await getAuthorizedCompanyWithQuery(txQuery, userId, job.companyId)
        if (!company) throw new Error('hiring_forbidden')
        publisherName = company.name
        publisherCompanyId = company.id
      } else {
        if (job.companyId !== null) throw new Error('hiring_forbidden')
        const publisher = await getPersonalRecruiterPublisherWithQuery(txQuery, userId)
        if (!publisher) throw new Error('hiring_forbidden')
        publisherName = publisher.name
        publisherCompanyId = null
      }

      const rows = await txQuery(
        `insert into public.jobs (
           title, company_name, company_id, created_by_user_id, location, summary, description, requirements,
           apply_until, status, job_domain, department, rank, vessel_types, experience_min_years, experience_max_years,
           joining_from, joining_until, salary_min, salary_max, salary_currency, salary_period, sailing_regions,
           urgent, easy_apply, published_at, department_key, accepted_role_keys, role_other_text, min_match_to_apply
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10::public.job_listing_status, $11, $12, $13, $14::text[], $15, $16,
           $17, $18, $19, $20, $21, $22, $23::text[],
           $24, $25, case when $10::public.job_listing_status = 'published'::public.job_listing_status then now() else null end,
           $26, $27::text[], $28, $29::smallint
         ) returning id`,
        [
          job.title, publisherName, publisherCompanyId, userId, job.location, job.summary, job.description, job.requirements,
          job.applyUntil, job.status, job.domain, job.department, job.rank, job.vesselTypes, job.experienceMinYears,
          job.experienceMaxYears, job.joiningFrom, job.joiningUntil, job.salaryMin, job.salaryMax, job.salaryCurrency,
          job.salaryPeriod, job.regions, job.urgent, job.easyApply,
          job.departmentKey ?? null, job.acceptedRoleKeys ?? [], job.roleOtherText ?? null, job.minMatchToApply ?? 70,
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
      `select j.id, j.company_id, j.created_by_user_id, j.status::text as status
       from public.jobs j
       left join public.company_members cm
         on cm.company_id = j.company_id and cm.user_id = $2
       left join public.companies c on c.id = j.company_id
       where j.id = $1
         and j.deleted_at is null
         and ${manageAccessSql('$2', '$3')}
       limit 1
       for update of j`,
      [jobId, userId, [...HIRING_ROLES]],
    )
    if (!rows[0]) throw new Error('hiring_forbidden')
    return rows[0]
  }

  /**
   * Saves job details. `change.expectedStatus` guards against a concurrent lifecycle change;
   * `change.nextStatus` is decided by job-lifecycle.ts in the server action (usually unchanged,
   * or 'published' for "Save and publish").
   */
  async function updateJob(
    userId: string,
    jobId: string,
    job: HiringJobUpdateInput,
    change: { expectedStatus: HiringJobStatus; nextStatus: HiringJobStatus },
  ) {
    return transaction(async (txQuery) => {
      await requireAuthorizedJob(txQuery, userId, jobId)
      const updated = await txQuery(
        `update public.jobs
         set title = $2,
             location = $3,
             summary = $4,
             description = $5,
             requirements = $6,
             apply_until = $7::date,
             status = $8::public.job_listing_status,
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
             published_at = case
               when $8::public.job_listing_status = 'published'::public.job_listing_status and (status <> 'published'::public.job_listing_status or published_at is null) then now()
               else published_at
             end,
             archived_at = case
               when $8::public.job_listing_status = 'closed'::public.job_listing_status then coalesce(archived_at, now())
               else null
             end,
             department_key = case when $29::boolean then $25 else department_key end,
             accepted_role_keys = case when $29::boolean then $26::text[] else accepted_role_keys end,
             role_other_text = case when $29::boolean then $27 else role_other_text end,
             min_match_to_apply = coalesce($28::smallint, min_match_to_apply),
             updated_at = now()
         where id = $1
           and status = $24::public.job_listing_status
           and deleted_at is null
         returning id`,
        [
          jobId, job.title, job.location, job.summary, job.description, job.requirements, job.applyUntil, change.nextStatus,
          job.domain, job.department, job.rank, job.vesselTypes, job.experienceMinYears, job.experienceMaxYears,
          job.joiningFrom, job.joiningUntil, job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod,
          job.regions, job.urgent, job.easyApply, change.expectedStatus,
          job.departmentKey ?? null, job.acceptedRoleKeys ?? [], job.roleOtherText ?? null, job.minMatchToApply ?? null,
          job.departmentKey !== undefined || job.acceptedRoleKeys !== undefined,
        ],
      )
      if (!updated[0]) throw new Error('job_state_changed')
      await replaceJobRequirements(txQuery, jobId, job.certificates, job.visas)
    })
  }

  /** Moves a job along the lifecycle. The caller validates the transition with job-lifecycle.ts. */
  async function changeJobStatus(userId: string, jobId: string, change: HiringJobStateChange) {
    return transaction(async (txQuery) => {
      await requireAuthorizedJob(txQuery, userId, jobId)
      const updated = await txQuery(
        `update public.jobs
         set status = $3::public.job_listing_status,
             apply_until = $4::date,
             published_at = case
               when $3::public.job_listing_status = 'published'::public.job_listing_status then now()
               else published_at
             end,
             archived_at = case
               when $3::public.job_listing_status = 'closed'::public.job_listing_status then now()
               else null
             end,
             updated_at = now()
         where id = $1
           and status = $2::public.job_listing_status
           and deleted_at is null
         returning id`,
        [jobId, change.from, change.to, change.applyUntil],
      )
      if (!updated[0]) throw new Error('job_state_changed')
    })
  }

  /**
   * Soft-deletes a draft or archived job. Applications, their history and moderation evidence stay,
   * so applicants keep a record; the job disappears from search and from the hiring workspace.
   */
  async function deleteJob(userId: string, jobId: string, expectedStatus: HiringJobStatus) {
    return transaction(async (txQuery) => {
      const allowed = await txQuery(
        `select j.id
         from public.jobs j
         left join public.company_members cm
           on cm.company_id = j.company_id and cm.user_id = $2
         left join public.companies c on c.id = j.company_id
         where j.id = $1
           and j.deleted_at is null
           and ${deleteAccessSql('$2', '$3')}
         limit 1
         for update of j`,
        [jobId, userId, [...HIRING_ROLES]],
      )
      if (!allowed[0]) throw new Error('hiring_forbidden')

      const deleted = await txQuery(
        `update public.jobs
         set status = 'closed'::public.job_listing_status,
             archived_at = coalesce(archived_at, now()),
             deleted_at = now(),
             deleted_by = $2,
             updated_at = now()
         where id = $1
           and status = $3::public.job_listing_status
           and status <> 'published'::public.job_listing_status
           and deleted_at is null
         returning id`,
        [jobId, userId, expectedStatus],
      )
      if (!deleted[0]) throw new Error('job_state_changed')
      await txQuery('delete from public.job_saves where job_id = $1', [jobId])
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
       left join public.company_members cm
         on cm.company_id = j.company_id and cm.user_id = $1
       join public.profiles p on p.id = a.applicant_id
       left join public.maritime_profiles mp on mp.user_id = p.id
       left join public.companies c on c.id = j.company_id
       left join public.company_members rcm on rcm.company_id = j.company_id and rcm.user_id = j.created_by_user_id
       where j.id = $2
         and j.deleted_at is null
         and ${manageAccessSql('$1', '$3')}
         ${statusFilter}
       order by a.applied_at desc, a.id desc`,
      values,
    ) as ApplicantRow[]

    return rows.map(mapHiringApplicant).sort(compareApplicants)
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
       left join public.company_members cm
         on cm.company_id = j.company_id and cm.user_id = $1
       join public.profiles p on p.id = a.applicant_id
       left join public.maritime_profiles mp on mp.user_id = p.id
       left join public.companies c on c.id = j.company_id
       left join public.company_members rcm on rcm.company_id = j.company_id and rcm.user_id = j.created_by_user_id
       where a.id = $2
         and j.deleted_at is null
         and (
           (j.company_id is null and j.created_by_user_id = $1)
           or (
             j.company_id is not null
             and cm.role::text = any($3::text[])
             and cm.approved_at is not null
             and c.is_verified = true
           )
         )
       limit 1`,
      [userId, applicationId, [...HIRING_ROLES]],
    ) as ApplicantRow[]
    const row = rows[0]
    if (!row) return null
    const applicant = mapHiringApplicant(row)
    return {
      ...applicant,
      job: mapApplicantJob(row),
      jobStatus: row.job_status ?? 'published',
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

  async function getApplicationPublisherScopeWithQuery(
    query: HiringQuery,
    userId: string,
    applicationId: string,
  ) {
    const rows = await query(
      `select j.company_id, a.status::text as application_status
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       left join public.company_members cm
         on cm.company_id = j.company_id and cm.user_id = $2
       left join public.companies c on c.id = j.company_id
       where a.id = $1
         and j.deleted_at is null
         and ${manageAccessSql('$2', '$3')}
       limit 1`,
      [applicationId, userId, [...HIRING_ROLES]],
    ) as ApplicationPublisherScopeRow[]
    const row = rows[0]
    return row
      ? { companyId: row.company_id ?? null, status: (row.application_status ?? 'applied') as JobApplicationStatus }
      : null
  }

  async function getApplicationPublisherScope(userId: string, applicationId: string) {
    return getApplicationPublisherScopeWithQuery(queryRows, userId, applicationId)
  }

  async function requireAuthorizedApplication(query: HiringQuery, userId: string, applicationId: string) {
    const scope = await getApplicationPublisherScopeWithQuery(query, userId, applicationId)
    if (!scope) throw new Error('hiring_forbidden')
    return scope
  }

  async function updateApplicationStatus(
    userId: string,
    applicationId: string,
    status: JobApplicationStatus,
    note: string | null,
  ) {
    return transaction(async (txQuery) => {
      const scope = await requireAuthorizedApplication(txQuery, userId, applicationId)
      const allowed = validateApplicationStatusChange(scope.status, status)
      if (!allowed.ok) throw new Error('application_status_not_allowed')
      const updated = await txQuery(
        `update public.job_applications
         set status = $2, updated_at = now()
         where id = $1
           and status = $3
           and status <> 'withdrawn'
         returning id`,
        [applicationId, status, scope.status],
      )
      if (!updated[0]) throw new Error('application_state_changed')
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

  /**
   * CV access for the download route: the applicant themselves, or someone who may manage the
   * job (while it is not deleted). Returns null when the viewer has no access.
   */
  async function getApplicationCvAccess(userId: string, applicationId: string): Promise<HiringApplicationCvAccess | null> {
    const rows = await queryRows(
      `select
         a.cv_storage_path,
         a.cv_file_name,
         a.cv_mime_type,
         a.cv_size_bytes,
         (a.applicant_id = $2) as is_applicant
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       left join public.company_members cm
         on cm.company_id = j.company_id and cm.user_id = $2
       left join public.companies c on c.id = j.company_id
       where a.id = $1
         and (
           a.applicant_id = $2
           or (j.deleted_at is null and ${manageAccessSql('$2', '$3')})
         )
       limit 1`,
      [applicationId, userId, [...HIRING_ROLES]],
    ) as ApplicationCvRow[]
    const row = rows[0]
    if (!row) return null
    return {
      viewer: row.is_applicant ? 'applicant' : 'hiring',
      cv: cvReference(row),
    }
  }

  return {
    getAuthorizedCompany,
    listAuthorizedCompanies,
    getPersonalPublisher,
    getManagedDashboardMetrics,
    getDashboardMetrics,
    listCompanyJobs,
    listManagedJobs,
    getManagedJob,
    getEditableJob,
    getManagedEditableJob,
    createJob,
    updateJob,
    changeJobStatus,
    deleteJob,
    listApplicants,
    getApplicationReview,
    getApplicationPublisherScope,
    updateApplicationStatus,
    saveRecruiterNote,
    getApplicationCvAccess,
  }
}

export const hiringRepository = createHiringRepository()
