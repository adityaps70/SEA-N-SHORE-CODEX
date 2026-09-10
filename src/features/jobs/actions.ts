'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { jobsRepository } from './repository'
import { parseJobSearchParams } from './search'

export type ApplyToJobResult =
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; error: string }

export type JobMutationResult = { ok: true } | { ok: false; error: string }

const jobIdSchema = z.string().uuid()
const alertIdSchema = z.string().uuid()
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

function revalidateCandidateJobs(jobId?: string) {
  revalidatePath('/jobs')
  revalidatePath('/jobs/saved')
  revalidatePath('/jobs/applications')
  if (jobId) revalidatePath(`/jobs/${jobId}`)
}

export async function applyToJob(jobId: string): Promise<ApplyToJobResult> {
  const parsed = jobIdSchema.safeParse(jobId)
  if (!parsed.success) return { ok: false, error: 'Invalid job.' }

  const user = await requireAwsUser()
  if (!await jobsRepository.isMemberReady(user.id)) {
    return { ok: false, error: 'Complete your professional profile before applying.' }
  }

  const job = await jobsRepository.getPublishedJob(parsed.data)
  if (!job) return { ok: false, error: 'This job is no longer accepting applications.' }

  if (await jobsRepository.hasApplied(parsed.data, user.id)) {
    return { ok: true, alreadyApplied: true }
  }

  try {
    await jobsRepository.createApplication(parsed.data, user.id)
  } catch (error) {
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
