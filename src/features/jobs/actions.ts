'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { userCan } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  createPendingJobApplicationCvUpload,
  removeJobApplicationCv,
  verifyPendingJobApplicationCv,
  type JobApplicationCvReference,
} from './application-media'
import { applyGateError, evaluateApplyGate, type ApplyGate } from './apply-gate'
import { scoreJobMatch } from './matching'
import { jobsRepository } from './repository'
import { parseJobSearchParams } from './search'
import type { JobListing } from './types'

export type ApplyToJobResult =
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; error: string; gate?: ApplyGate }

export type PrepareJobApplicationCvResult =
  | ({ ok: true; uploadUrl: string } & JobApplicationCvReference)
  | { ok: false; error: string; gate?: ApplyGate }

export type JobMutationResult = { ok: true } | { ok: false; error: string }

const jobIdSchema = z.string().uuid()
const cvMetadataSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive(),
})
const cvReferenceSchema = cvMetadataSchema.extend({
  storagePath: z.string().trim().min(1).max(1024),
  mimeType: z.literal('application/pdf'),
})
const coverNoteSchema = z.string().trim().max(2000, 'Keep your message to the employer under 2,000 characters.').nullable().optional()
const alertIdSchema = z.string().uuid()
const applicationIdSchema = z.string().uuid()
const alertSchema = z.object({
  name: z.string().trim().min(2).max(120),
  queryString: z.string().max(3000),
  frequency: z.enum(['instant', 'daily', 'weekly']),
})
const reportSchema = z.object({
  jobId: z.string().uuid(),
  reason: z.enum([
    'recruitment_fee',
    'fake_company',
    'misleading_salary',
    'false_vacancy',
    'suspicious_communication',
    'inappropriate_content',
    'other',
  ]),
  details: z.string().trim().max(4000).optional().default(''),
})

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

/** Round 12: the minimum match to apply, checked on the server with the same match the member sees. */
async function applyGateFor(job: JobListing, applicantId: string): Promise<ApplyGate> {
  const profile = await jobsRepository.getCandidateProfile(applicantId)
  return evaluateApplyGate(job, profile ? scoreJobMatch(job, profile) : null)
}

function revalidateCandidateJobs(jobId?: string) {
  revalidatePath('/jobs')
  revalidatePath('/jobs/saved')
  revalidatePath('/jobs/applications')
  if (jobId) revalidatePath(`/jobs/${jobId}`)
}

export async function prepareJobApplicationCvUpload(
  jobId: string,
  input: unknown,
): Promise<PrepareJobApplicationCvResult> {
  const parsedJobId = jobIdSchema.safeParse(jobId)
  const parsedMetadata = cvMetadataSchema.safeParse(input)
  if (!parsedJobId.success || !parsedMetadata.success) {
    return { ok: false, error: 'Attach a PDF CV up to 10 MB.' }
  }

  const user = await requireAwsUser()
  if (!await userCan(user.id, 'job.apply')) {
    return { ok: false, error: 'Your account cannot apply for jobs right now.' }
  }
  if (!await jobsRepository.isMemberReady(user.id)) {
    return { ok: false, error: 'Complete your Sea N Shore profile before applying.' }
  }
  const job = await jobsRepository.getPublishedJob(parsedJobId.data)
  if (!job || !await jobsRepository.isAcceptingApplications(parsedJobId.data)) {
    return { ok: false, error: 'This job is no longer accepting applications.' }
  }
  const gate = await applyGateFor(job, user.id)
  const refusal = applyGateError(gate)
  if (refusal) return { ok: false, error: refusal, gate }

  try {
    const upload = await createPendingJobApplicationCvUpload({
      profileId: user.id,
      jobId: parsedJobId.data,
      fileName: parsedMetadata.data.fileName,
      mimeType: parsedMetadata.data.mimeType,
      sizeBytes: parsedMetadata.data.sizeBytes,
    })
    return { ok: true, ...upload }
  } catch {
    return { ok: false, error: 'Attach a PDF CV up to 10 MB.' }
  }
}

export async function applyToJob(
  jobId: string,
  cvInput?: JobApplicationCvReference | null,
  coverNoteInput?: string | null,
): Promise<ApplyToJobResult> {
  const parsed = jobIdSchema.safeParse(jobId)
  if (!parsed.success) return { ok: false, error: 'Invalid job.' }
  const parsedCoverNote = coverNoteSchema.safeParse(coverNoteInput ?? null)
  if (!parsedCoverNote.success) {
    return { ok: false, error: parsedCoverNote.error.issues[0]?.message ?? 'Check your message to the employer.' }
  }
  const coverNote = parsedCoverNote.data ? parsedCoverNote.data : null

  const user = await requireAwsUser()
  if (!await userCan(user.id, 'job.apply')) {
    return { ok: false, error: 'Your account cannot apply for jobs right now.' }
  }
  if (!await jobsRepository.isMemberReady(user.id)) {
    return { ok: false, error: 'Complete your Sea N Shore profile before applying.' }
  }

  const job = await jobsRepository.getPublishedJob(parsed.data)
  if (!job) return { ok: false, error: 'This job is no longer accepting applications.' }

  if (!await jobsRepository.isAcceptingApplications(parsed.data)) {
    return { ok: false, error: 'This job is no longer accepting applications.' }
  }

  if (await jobsRepository.hasApplied(parsed.data, user.id)) {
    return { ok: true, alreadyApplied: true }
  }

  const gate = await applyGateFor(job, user.id)
  const refusal = applyGateError(gate)
  if (refusal) return { ok: false, error: refusal, gate }

  let cv: JobApplicationCvReference | null = null
  if (cvInput) {
    const parsedCv = cvReferenceSchema.safeParse(cvInput)
    if (!parsedCv.success) {
      return { ok: false, error: 'We could not verify your CV. Please attach the PDF again.' }
    }
    try {
      cv = await verifyPendingJobApplicationCv({
        profileId: user.id,
        jobId: parsed.data,
        storagePath: parsedCv.data.storagePath,
        fileName: parsedCv.data.fileName,
        mimeType: parsedCv.data.mimeType,
        sizeBytes: parsedCv.data.sizeBytes,
      })
    } catch {
      return { ok: false, error: 'We could not verify your CV. Please attach the PDF again.' }
    }
  }

  try {
    await jobsRepository.createApplication(parsed.data, user.id, cv, coverNote)
  } catch (error) {
    if (cv) {
      await removeJobApplicationCv(cv.storagePath).catch(() => undefined)
    }
    if (isUniqueViolation(error)) return { ok: true, alreadyApplied: true }
    return { ok: false, error: 'We could not submit your application. Please try again.' }
  }

  revalidateCandidateJobs(parsed.data)
  revalidatePath('/activities')
  return { ok: true, alreadyApplied: false }
}

export async function saveJob(jobId: string): Promise<JobMutationResult> {
  const parsed = jobIdSchema.safeParse(jobId)
  if (!parsed.success) return { ok: false, error: 'Invalid job.' }
  const user = await requireAwsUser()
  await jobsRepository.saveJob(parsed.data, user.id)
  revalidateCandidateJobs(parsed.data)
  return { ok: true }
}

export async function unsaveJob(jobId: string): Promise<JobMutationResult> {
  const parsed = jobIdSchema.safeParse(jobId)
  if (!parsed.success) return { ok: false, error: 'Invalid job.' }
  const user = await requireAwsUser()
  await jobsRepository.unsaveJob(parsed.data, user.id)
  revalidateCandidateJobs(parsed.data)
  return { ok: true }
}

/**
 * Lets a candidate withdraw their own application while it is still open (New, Reviewed,
 * Shortlisted or Interview). The repository scopes the change to the signed-in applicant.
 */
export async function withdrawJobApplication(applicationId: string): Promise<JobMutationResult> {
  const parsed = applicationIdSchema.safeParse(applicationId)
  if (!parsed.success) return { ok: false, error: 'Invalid application.' }
  const user = await requireAwsUser()

  let withdrawn: { jobId: string } | null
  try {
    withdrawn = await jobsRepository.withdrawApplication(parsed.data, user.id)
  } catch {
    return { ok: false, error: 'We could not withdraw your application. Please try again.' }
  }
  if (!withdrawn) {
    return { ok: false, error: 'This application can no longer be withdrawn.' }
  }

  revalidateCandidateJobs(withdrawn.jobId)
  revalidatePath('/activities')
  revalidatePath(`/hiring/jobs/${withdrawn.jobId}/applicants`)
  revalidatePath(`/hiring/applicants/${parsed.data}`)
  return { ok: true }
}

export async function createJobAlert(input: unknown): Promise<JobMutationResult> {
  const parsed = alertSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Check the alert name and frequency.' }
  const user = await requireAwsUser()
  const searchParams = new URLSearchParams(parsed.data.queryString)
  const filters = parseJobSearchParams(Object.fromEntries(searchParams.entries()))
  await jobsRepository.createJobAlert(user.id, parsed.data.name, filters, parsed.data.frequency)
  revalidatePath('/jobs/alerts')
  return { ok: true }
}

export async function deleteJobAlert(alertId: string): Promise<JobMutationResult> {
  const parsed = alertIdSchema.safeParse(alertId)
  if (!parsed.success) return { ok: false, error: 'Invalid job alert.' }
  const user = await requireAwsUser()
  await jobsRepository.deleteJobAlert(parsed.data, user.id)
  revalidatePath('/jobs/alerts')
  return { ok: true }
}

export async function reportJob(input: unknown): Promise<JobMutationResult> {
  const parsed = reportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Please choose a valid report reason.' }
  const user = await requireAwsUser()
  await jobsRepository.reportJob(
    parsed.data.jobId,
    user.id,
    parsed.data.reason,
    parsed.data.details || null,
  )
  revalidatePath(`/jobs/${parsed.data.jobId}`)
  return { ok: true }
}
